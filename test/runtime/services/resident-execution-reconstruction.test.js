// @ts-nocheck -- intentionally loose full-history and authority-bound ledger test doubles.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
} from '../../../src/core/lib/ledger/execution-ledger-contract.js';
import {
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../../src/core/lib/db/tables/coordinator-authority.js';
import { createExecutionLedger } from '../../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import {
  EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
  createReplicatedExecutionPayloadStore,
} from '../../../src/core/lib/payload-store/replicated.js';
import {
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
} from '../../../src/core/lib/ledger/ready-work.js';
import { WorkflowCursorDisposition } from '../../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  ResidentExecutionReconstructionClassification as Classification,
  ResidentExecutionReconstructionPolicy as Policy,
  classifyResidentExecutionView,
  reconstructResidentExecutionHistory,
} from '../../../src/core/runtime/services/resident-execution-reconstruction.js';
import { createVanillaDB } from '../../helpers/db-adapters.js';

const APP_ID = 'replacement-reconstruction';
const fixtureDigest = (value) =>
  createHash('sha256').update(value).digest('base64url');
const REVISION_ID = `wrv1_${fixtureDigest('current-revision')}`;
const OLD_REVISION_ID = `wrv1_${fixtureDigest('old-revision')}`;
const AUTHORITY = Object.freeze({
  schemaVersion: 1,
  appId: APP_ID,
  coordinatorId: 'replacement-coordinator',
  authorityId: `wca1_${fixtureDigest('replacement-authority')}`,
  epoch: 2,
});
const DISTRIBUTION_ID = `wepd1_${fixtureDigest('replacement-reconstruction-distribution')}`;

const cleanups = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  const settled = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = settled
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'reconstruction test cleanup failed');
  }
});

function scoped(run, value = {}) {
  return {
    runId: run.runId,
    appId: run.appId,
    revisionId: run.revisionId,
    ...value,
  };
}

function localDistribution(store, counters) {
  return Object.freeze({
    identity: Object.freeze({
      kind: EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
      distributionId: DISTRIBUTION_ID,
      storeId: store.storage.storeId,
    }),
    async publishImmutable(input) {
      counters.publishes += 1;
      await store.importBytes(input);
    },
    async readBytes(reference) {
      counters.reads += 1;
      return await store.readBytes(reference);
    },
  });
}

function baseView(
  runId,
  {
    kind = 'manual',
    revisionId = REVISION_ID,
    status = RunStatus.RUNNING,
    version = 1,
    lastSequence = 1,
  } = {},
) {
  const run = {
    runId,
    appId: APP_ID,
    revisionId,
    trigger:
      kind === 'workflow'
        ? { kind, workflowId: 'workflow', planId: 'plan' }
        : kind === 'effect-successor'
          ? { kind, contract: {} }
          : { kind },
    status,
    version,
    lastSequence,
  };
  return {
    head: { version, sequence: lastSequence },
    run,
    invocations: [],
    timers: [],
    signalWaits: [],
    signalDeliveries: [],
    attempts: [],
    effects: [],
    events: [],
  };
}

function manualView(
  runId,
  {
    revisionId = REVISION_ID,
    runStatus = RunStatus.RUNNING,
    invocationStatus = InvocationStatus.RUNNABLE,
    attemptStatus,
    version = 1,
    lastSequence = 1,
  } = {},
) {
  const view = baseView(runId, {
    revisionId,
    status: runStatus,
    version,
    lastSequence,
  });
  const generation = attemptStatus === undefined ? 0 : 1;
  view.invocations = [
    scoped(view.run, {
      invocationId: 'main',
      activityId: 'activity',
      status: invocationStatus,
      generation,
    }),
  ];
  if (attemptStatus !== undefined) {
    view.attempts = [
      scoped(view.run, {
        invocationId: 'main',
        attemptId: `${runId}-attempt`,
        generation,
        status: attemptStatus,
      }),
    ];
  }
  return view;
}

function workflowActivityView(
  runId,
  {
    invocationStatus = InvocationStatus.RUNNABLE,
    attemptStatus,
    revisionId = REVISION_ID,
  } = {},
) {
  const view = baseView(runId, { kind: 'workflow', revisionId });
  const generation = attemptStatus === undefined ? 0 : 1;
  view.invocations = [
    scoped(view.run, {
      invocationId: 'workflow-invocation',
      activityId: 'workflow-activity',
      status: invocationStatus,
      generation,
    }),
  ];
  view.workflowCursor = scoped(view.run, {
    invocationId: 'workflow-invocation',
    disposition:
      invocationStatus === InvocationStatus.RUNNABLE
        ? WorkflowCursorDisposition.ACTIVITY_RUNNABLE
        : WorkflowCursorDisposition.ACTIVITY_RUNNING,
  });
  if (attemptStatus !== undefined) {
    view.attempts = [
      scoped(view.run, {
        invocationId: 'workflow-invocation',
        attemptId: `${runId}-attempt`,
        generation,
        status: attemptStatus,
      }),
    ];
  }
  return view;
}

function workflowTimerView(runId) {
  const view = baseView(runId, { kind: 'workflow' });
  view.workflowCursor = scoped(view.run, {
    timerId: 'timer',
    disposition: WorkflowCursorDisposition.TIMER_WAITING,
  });
  view.timers = [
    scoped(view.run, { timerId: 'timer', status: 'WAITING', dueAt: 500 }),
  ];
  return view;
}

function workflowSignalView(runId) {
  const view = baseView(runId, { kind: 'workflow' });
  view.workflowCursor = scoped(view.run, {
    signalWaitId: 'signal-wait',
    disposition: WorkflowCursorDisposition.SIGNAL_WAITING,
  });
  view.signalWaits = [
    scoped(view.run, {
      signalWaitId: 'signal-wait',
      status: 'WAITING',
    }),
  ];
  return view;
}

function successorView(runId, started = false) {
  const view = baseView(runId, { kind: 'effect-successor' });
  view.invocations = [
    scoped(view.run, {
      invocationId: 'successor-invocation',
      activityId: 'managed-effect-successor',
      status: started ? InvocationStatus.RUNNING : InvocationStatus.RUNNABLE,
      generation: started ? 1 : 0,
    }),
  ];
  if (started) {
    view.attempts = [
      scoped(view.run, {
        invocationId: 'successor-invocation',
        attemptId: 'successor-attempt',
        generation: 1,
        status: AttemptStatus.STARTED,
      }),
    ];
    view.effects = [
      scoped(view.run, {
        invocationId: 'successor-invocation',
        effectId: 'effect',
        status: EffectStatus.STARTED,
      }),
    ];
  }
  return view;
}

function directory(view) {
  return {
    runId: view.run.runId,
    appId: view.run.appId,
    revisionId: view.run.revisionId,
    kind: view.run.trigger.kind,
    status: view.run.status,
    version: view.run.version,
    lastSequence: view.run.lastSequence,
    createdAt: 1,
    updatedAt: 1,
  };
}

function classify(view) {
  return classifyResidentExecutionView(view, {
    appId: APP_ID,
    currentRevisionId: REVISION_ID,
  });
}

describe('resident execution reconstruction classification', () => {
  test.each([
    [
      'manual runnable',
      () => manualView('manual-runnable'),
      Classification.MANUAL_RUNNABLE,
      Policy.DISPATCHABLE_AFTER_FRESH_CLAIM,
      'ACTIVITY',
    ],
    [
      'manual claimed',
      () =>
        manualView('manual-claimed', {
          invocationStatus: InvocationStatus.RUNNING,
          attemptStatus: AttemptStatus.CLAIMED,
        }),
      Classification.MANUAL_CLAIMED,
      Policy.RECOVER_PRE_START_CLAIM,
      'RECOVERY',
    ],
    [
      'manual started',
      () =>
        manualView('manual-started', {
          invocationStatus: InvocationStatus.RUNNING,
          attemptStatus: AttemptStatus.STARTED,
        }),
      Classification.MANUAL_STARTED,
      Policy.STARTED_OUTCOME_UNKNOWN,
      'RECOVERY',
    ],
    [
      'workflow runnable',
      () => workflowActivityView('workflow-runnable'),
      Classification.WORKFLOW_ACTIVITY_RUNNABLE,
      Policy.DISPATCHABLE_AFTER_FRESH_CLAIM,
      'ACTIVITY',
    ],
    [
      'workflow claimed',
      () =>
        workflowActivityView('workflow-claimed', {
          invocationStatus: InvocationStatus.RUNNING,
          attemptStatus: AttemptStatus.CLAIMED,
        }),
      Classification.WORKFLOW_ACTIVITY_CLAIMED,
      Policy.RECOVER_PRE_START_CLAIM,
      'RECOVERY',
    ],
    [
      'workflow started',
      () =>
        workflowActivityView('workflow-started', {
          invocationStatus: InvocationStatus.RUNNING,
          attemptStatus: AttemptStatus.STARTED,
        }),
      Classification.WORKFLOW_ACTIVITY_STARTED,
      Policy.STARTED_OUTCOME_UNKNOWN,
      'RECOVERY',
    ],
    [
      'workflow timer',
      () => workflowTimerView('workflow-timer'),
      Classification.WORKFLOW_TIMER_WAITING,
      Policy.FRAMEWORK_TIMER_CAS,
      'TIMER',
    ],
    [
      'workflow signal',
      () => workflowSignalView('workflow-signal'),
      Classification.WORKFLOW_SIGNAL_WAITING,
      Policy.WAIT_SIGNAL,
      undefined,
    ],
    [
      'effect successor runnable',
      () => successorView('successor-runnable'),
      Classification.SUCCESSOR_RUNNABLE,
      Policy.EFFECT_SUCCESSOR_OPERATOR_ONLY,
      undefined,
    ],
    [
      'effect successor started',
      () => successorView('successor-started', true),
      Classification.SUCCESSOR_STARTED,
      Policy.EFFECT_SUCCESSOR_OPERATOR_ONLY,
      undefined,
    ],
    [
      'blocked',
      () =>
        manualView('blocked', {
          runStatus: RunStatus.BLOCKED,
          invocationStatus: InvocationStatus.UNCERTAIN,
        }),
      Classification.BLOCKED,
      Policy.BLOCKED_RECONCILIATION,
      undefined,
    ],
    [
      'blocked effect successor',
      () => {
        const view = successorView('blocked-successor', true);
        view.run.status = RunStatus.BLOCKED;
        view.invocations[0].status = InvocationStatus.UNCERTAIN;
        view.attempts[0].status = AttemptStatus.ABANDONED;
        view.effects[0].status = EffectStatus.UNCERTAIN;
        return view;
      },
      Classification.BLOCKED,
      Policy.BLOCKED_RECONCILIATION,
      undefined,
    ],
    [
      'terminal',
      () =>
        manualView('terminal', {
          runStatus: RunStatus.COMPLETED,
          invocationStatus: InvocationStatus.COMPLETED,
        }),
      Classification.TERMINAL,
      Policy.TERMINAL,
      undefined,
    ],
    [
      'old revision',
      () => manualView('old-revision', { revisionId: OLD_REVISION_ID }),
      Classification.MANUAL_RUNNABLE,
      Policy.PARKED_REVISION,
      'ACTIVITY',
    ],
  ])(
    'classifies %s without executing work',
    (_label, createView, classification, policy, expectedReadyWorkKind) => {
      expect(classify(createView())).toEqual({
        classification,
        policy,
        revisionCompatible: policy !== Policy.PARKED_REVISION,
        ...(expectedReadyWorkKind === undefined
          ? {}
          : { expectedReadyWorkKind }),
      });
    },
  );

  test('fails closed when a running invocation and its current attempt disagree', () => {
    const view = manualView('bad-attempt', {
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.COMPLETED,
    });
    expect(() => classify(view)).toThrow(/recoverable attempt/u);
  });

  test('fails closed on a cross-run child projection', () => {
    const view = manualView('cross-run');
    view.invocations[0].runId = 'another-run';
    expect(() => classify(view)).toThrow(/crossed/u);
  });
});

function historyLedger(views, { appliedRuns = [] } = {}) {
  const entries = Object.values(views).map(directory);
  const viewsByRunId = Object.fromEntries(
    Object.values(views).map((view) => [view.run.runId, view]),
  );
  let scan = -1;
  const listRuns = jest.fn(async (options) => {
    if (options.cursor === undefined) {
      scan += 1;
      return {
        items: entries.slice(0, 2),
        ...(entries.length > 2 ? { nextCursor: 'next-page' } : {}),
      };
    }
    return { items: entries.slice(2) };
  });
  const repairReadyWork = jest.fn(async ({ appId, revisionId, runId }) => {
    const decision = classifyResidentExecutionView(viewsByRunId[runId], {
      appId,
      currentRevisionId: REVISION_ID,
    });
    return {
      applied: appliedRuns.includes(runId),
      runId,
      ...(decision.expectedReadyWorkKind === undefined
        ? {}
        : {
            expected: {
              appId,
              revisionId,
              runId,
              kind: decision.expectedReadyWorkKind,
              runVersion: viewsByRunId[runId].run.version,
              lastSequence: viewsByRunId[runId].run.lastSequence,
            },
          }),
    };
  });
  return {
    listRuns,
    rebuildRun: jest.fn(async (runId) => viewsByRunId[runId]),
    repairReadyWork,
    getCoordinatorAuthority: jest.fn(() => AUTHORITY),
    assertCurrentCoordinatorAuthority: jest.fn(async () => undefined),
    get completedScans() {
      return scan + 1;
    },
  };
}

describe('resident execution history reconstruction', () => {
  test('repairs a missing real ready-work locator under the replacement authority', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-reconstruction-'));
    const db = await createVanillaDB(join(root, 'control'));
    cleanups.push(async () => {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    });
    const tableName = 'resident-reconstruction-integration';
    const payloadStore = createLocalExecutionPayloadStore({
      path: join(root, 'payloads'),
      storeId: 'resident-reconstruction-test',
    });
    const unbound = createExecutionLedger({ db, tableName, payloadStore });
    await unbound.createManualRun({
      runId: 'real-runnable',
      appId: APP_ID,
      revisionId: REVISION_ID,
      invocationId: 'main',
      activityId: 'activity',
      input: { value: true },
      callerMetadata: {},
      transitionId: 'create-real-runnable',
    });
    const before = await unbound.listReadyWork({
      appId: APP_ID,
      revisionId: REVISION_ID,
      observedAt: Date.now() + 60_000,
    });
    expect(before.items).toHaveLength(1);
    const locator = before.items[0];
    const scope = createExecutionLedgerReadyWorkScope({
      appId: APP_ID,
      revisionId: REVISION_ID,
    });
    await db.batchWrite({
      tableName,
      deleteRequests: [
        {
          keyName: 'run_id',
          keyValue: scope.readyWorkId,
          sortKeyName: 'sort_key',
          sortKeyValue: getExecutionLedgerReadyWorkSortKey({
            availableAt: locator.availableAt,
            runId: locator.runId,
          }),
        },
      ],
    });
    await expect(
      unbound.listReadyWork({
        appId: APP_ID,
        revisionId: REVISION_ID,
        observedAt: Date.now() + 60_000,
      }),
    ).resolves.toMatchObject({ items: [] });

    const authority = createCoordinatorAuthority({ db, tableName });
    const acquired = await authority.acquire({
      appId: APP_ID,
      coordinatorId: 'replacement-integration',
      requestId: 'acquire-replacement-integration',
    });
    const token = createCoordinatorAuthorityToken(acquired.authority);
    const bound = unbound.bindCoordinatorAuthority(token);
    const report = await reconstructResidentExecutionHistory({
      ledger: bound,
      appId: APP_ID,
      currentRevisionId: REVISION_ID,
      coordinatorAuthority: token,
      observedAt: Date.now(),
    });

    expect(report).toMatchObject({
      inspectedRuns: 1,
      readyWork: { checks: 1, applied: 1, unchanged: 0 },
      policyCounts: { [Policy.DISPATCHABLE_AFTER_FRESH_CLAIM]: 1 },
    });
    await expect(
      bound.listReadyWork({
        appId: APP_ID,
        revisionId: REVISION_ID,
        observedAt: Date.now() + 60_000,
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          runId: 'real-runnable',
          kind: 'ACTIVITY',
        }),
      ],
    });
  });

  test('hydrates an empty replacement replica from distributed payloads during reconstruction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-reconstruction-'));
    const db = await createVanillaDB(join(root, 'control'));
    cleanups.push(async () => {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    });
    const tableName = 'resident-reconstruction-replicated';
    const storeId = 'resident-reconstruction-replicated';
    const counters = { publishes: 0, reads: 0 };
    const distributionPath = join(root, 'distribution');
    const distributionStore = createLocalExecutionPayloadStore({
      path: distributionPath,
      storeId,
    });
    const distribution = localDistribution(distributionStore, counters);
    const sourcePayloadStore = createReplicatedExecutionPayloadStore({
      localStore: createLocalExecutionPayloadStore({
        path: join(root, 'source-payloads'),
        storeId,
      }),
      distribution,
    });
    const sourceLedger = createExecutionLedger({
      db,
      tableName,
      payloadStore: sourcePayloadStore,
    });
    await sourceLedger.createManualRun({
      runId: 'replicated-runnable',
      appId: APP_ID,
      revisionId: REVISION_ID,
      invocationId: 'main',
      activityId: 'activity',
      input: { from: 'distributed-source' },
      callerMetadata: { request: 'replacement' },
      transitionId: 'create-replicated-runnable',
    });
    expect(counters.publishes).toBeGreaterThan(0);

    const before = await sourceLedger.listReadyWork({
      appId: APP_ID,
      revisionId: REVISION_ID,
      observedAt: Date.now() + 60_000,
    });
    expect(before.items).toHaveLength(1);
    const locator = before.items[0];
    const scope = createExecutionLedgerReadyWorkScope({
      appId: APP_ID,
      revisionId: REVISION_ID,
    });
    await db.batchWrite({
      tableName,
      deleteRequests: [
        {
          keyName: 'run_id',
          keyValue: scope.readyWorkId,
          sortKeyName: 'sort_key',
          sortKeyValue: getExecutionLedgerReadyWorkSortKey({
            availableAt: locator.availableAt,
            runId: locator.runId,
          }),
        },
      ],
    });

    const replacementLocalStore = createLocalExecutionPayloadStore({
      path: join(root, 'replacement-payloads'),
      storeId,
    });
    const replacementPayloadStore = createReplicatedExecutionPayloadStore({
      localStore: replacementLocalStore,
      distribution,
    });
    const replacementLedger = createExecutionLedger({
      db,
      tableName,
      payloadStore: replacementPayloadStore,
    });
    const authority = createCoordinatorAuthority({ db, tableName });
    const acquired = await authority.acquire({
      appId: APP_ID,
      coordinatorId: 'replacement-replicated',
      requestId: 'acquire-replacement-replicated',
    });
    const token = createCoordinatorAuthorityToken(acquired.authority);
    const bound = replacementLedger.bindCoordinatorAuthority(token);
    const remoteReadsBefore = counters.reads;

    const report = await reconstructResidentExecutionHistory({
      ledger: bound,
      appId: APP_ID,
      currentRevisionId: REVISION_ID,
      coordinatorAuthority: token,
      observedAt: Date.now(),
    });

    expect(report).toMatchObject({
      inspectedRuns: 1,
      readyWork: { checks: 1, applied: 1, unchanged: 0 },
    });
    expect(counters.reads).toBeGreaterThan(remoteReadsBefore);
    const remoteReadsAfterHydration = counters.reads;
    rmSync(distributionPath, { recursive: true, force: true });
    await expect(
      bound.rebuildRun('replicated-runnable'),
    ).resolves.toMatchObject({
      run: { runId: 'replicated-runnable' },
    });
    expect(counters.reads).toBe(remoteReadsAfterHydration);
  });

  test('validates the full history before converging locators and returns a bounded frozen report', async () => {
    const views = {
      runnable: manualView('runnable'),
      claimed: manualView('claimed', {
        invocationStatus: InvocationStatus.RUNNING,
        attemptStatus: AttemptStatus.CLAIMED,
      }),
      timer: workflowTimerView('timer'),
      signal: workflowSignalView('signal'),
      terminal: manualView('terminal-run', {
        runStatus: RunStatus.COMPLETED,
        invocationStatus: InvocationStatus.COMPLETED,
      }),
      successor: successorView('successor'),
    };
    const ledger = historyLedger(views, { appliedRuns: ['runnable', 'timer'] });

    const report = await reconstructResidentExecutionHistory({
      ledger,
      appId: APP_ID,
      currentRevisionId: REVISION_ID,
      coordinatorAuthority: AUTHORITY,
      observedAt: 1_000,
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      appId: APP_ID,
      currentRevisionId: REVISION_ID,
      observedAt: 1_000,
      inventoryDigest: expect.stringMatching(/^sha256:/u),
      inspectedRuns: 6,
      readyWork: { checks: 5, applied: 2, unchanged: 3 },
      classificationCounts: {
        [Classification.MANUAL_RUNNABLE]: 1,
        [Classification.MANUAL_CLAIMED]: 1,
        [Classification.WORKFLOW_TIMER_WAITING]: 1,
        [Classification.WORKFLOW_SIGNAL_WAITING]: 1,
        [Classification.SUCCESSOR_RUNNABLE]: 1,
        [Classification.TERMINAL]: 1,
      },
      policyCounts: {
        [Policy.DISPATCHABLE_AFTER_FRESH_CLAIM]: 1,
        [Policy.RECOVER_PRE_START_CLAIM]: 1,
        [Policy.FRAMEWORK_TIMER_CAS]: 1,
        [Policy.WAIT_SIGNAL]: 1,
        [Policy.EFFECT_SUCCESSOR_OPERATOR_ONLY]: 1,
        [Policy.TERMINAL]: 1,
      },
      samplesTruncated: false,
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.samples)).toBe(true);
    expect(ledger.completedScans).toBe(2);
    expect(ledger.listRuns).toHaveBeenCalledTimes(4);
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(14);
    expect(ledger.repairReadyWork).toHaveBeenCalledTimes(5);
    expect(ledger.assertCurrentCoordinatorAuthority).toHaveBeenCalledTimes(1);
  });

  test('performs no repair when the validation pass finds malformed late history', async () => {
    const valid = manualView('valid');
    const invalid = manualView('invalid');
    const ledger = historyLedger({ valid, invalid });
    invalid.run.version = 2;

    await expect(
      reconstructResidentExecutionHistory({
        ledger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
      }),
    ).rejects.toThrow(/directory disagrees/u);
    expect(ledger.repairReadyWork).not.toHaveBeenCalled();
    expect(ledger.assertCurrentCoordinatorAuthority).not.toHaveBeenCalled();
  });

  test('fails closed when history changes between validation and convergence', async () => {
    const first = manualView('drifting');
    const second = manualView('drifting', { version: 2, lastSequence: 2 });
    let rebuilds = 0;
    let scans = -1;
    const ledger = {
      listRuns: jest.fn(async () => {
        scans += 1;
        return { items: [directory(scans === 0 ? first : second)] };
      }),
      rebuildRun: jest.fn(async () => (rebuilds++ === 0 ? first : second)),
      repairReadyWork: jest.fn(async () => ({
        applied: false,
        runId: 'drifting',
        expected: {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId: 'drifting',
          kind: 'ACTIVITY',
          runVersion: 2,
          lastSequence: 2,
        },
      })),
      getCoordinatorAuthority: () => AUTHORITY,
      assertCurrentCoordinatorAuthority: jest.fn(),
    };

    await expect(
      reconstructResidentExecutionHistory({
        ledger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
      }),
    ).rejects.toThrow(/changed during reconstruction/u);
    expect(ledger.assertCurrentCoordinatorAuthority).not.toHaveBeenCalled();
  });

  test('rejects a newer same-kind locator returned by a raced repair', async () => {
    const ledger = historyLedger({ run: manualView('same-kind-race') });
    ledger.repairReadyWork.mockResolvedValue({
      applied: true,
      runId: 'same-kind-race',
      expected: {
        appId: APP_ID,
        revisionId: REVISION_ID,
        runId: 'same-kind-race',
        kind: 'ACTIVITY',
        runVersion: 2,
        lastSequence: 2,
      },
    });

    await expect(
      reconstructResidentExecutionHistory({
        ledger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
      }),
    ).rejects.toThrow(/repair disagrees with the inventory/u);
    expect(ledger.assertCurrentCoordinatorAuthority).not.toHaveBeenCalled();
  });

  test('rereads an absent-locator state and rejects a transition during repair', async () => {
    const blocked = manualView('absent-race', {
      runStatus: RunStatus.BLOCKED,
      invocationStatus: InvocationStatus.UNCERTAIN,
    });
    const ledger = historyLedger({ blocked });
    ledger.repairReadyWork.mockImplementation(async () => {
      blocked.run.version += 1;
      blocked.run.lastSequence += 1;
      return { applied: false, runId: 'absent-race' };
    });

    await expect(
      reconstructResidentExecutionHistory({
        ledger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
      }),
    ).rejects.toThrow(/directory disagrees/u);
    expect(ledger.assertCurrentCoordinatorAuthority).not.toHaveBeenCalled();
  });

  test('honors authority loss before any repair and after the final strong check', async () => {
    const before = new AbortController();
    const firstLedger = historyLedger({ run: manualView('run') });
    before.abort(new Error('authority lost before inventory'));
    await expect(
      reconstructResidentExecutionHistory({
        ledger: firstLedger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
        signal: before.signal,
      }),
    ).rejects.toThrow(/authority lost before inventory/u);
    expect(firstLedger.listRuns).not.toHaveBeenCalled();

    const after = new AbortController();
    const secondLedger = historyLedger({ run: manualView('run') });
    secondLedger.assertCurrentCoordinatorAuthority.mockImplementation(
      async () => {
        after.abort(new Error('authority lost at handoff'));
      },
    );
    await expect(
      reconstructResidentExecutionHistory({
        ledger: secondLedger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
        signal: after.signal,
      }),
    ).rejects.toThrow(/authority lost at handoff/u);
  });

  test('rejects a ledger bound to any other authority before reading history', async () => {
    const ledger = historyLedger({ run: manualView('run') });
    ledger.getCoordinatorAuthority.mockReturnValue({
      ...AUTHORITY,
      epoch: 3,
    });
    await expect(
      reconstructResidentExecutionHistory({
        ledger,
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorAuthority: AUTHORITY,
      }),
    ).rejects.toThrow(/exact session authority-bound ledger/u);
    expect(ledger.listRuns).not.toHaveBeenCalled();
  });
});
