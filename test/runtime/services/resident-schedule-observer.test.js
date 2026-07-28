/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import { createExecutionLedger } from '../../../src/core/lib/db/tables/execution-ledger.js';
import {
  LocalApplicationActivationAction,
  LocalApplicationActivationDestination,
  LocalApplicationAdmissionClosedError,
  createLocalApplicationActivation,
} from '../../../src/core/lib/db/tables/local-application-activation.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createScheduleControl } from '../../../src/core/lib/db/tables/schedule-control.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import { createScheduleRunCause } from '../../../src/core/lib/ledger/schedule-occurrence.js';
import { createWorkflowRunId } from '../../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../../src/core/runtime/application-revision.js';
import { resolveManifestScheduleBindings } from '../../../src/core/runtime/manifest-schedule-binding.js';
import {
  ResidentScheduleOwnershipLostError,
  createResidentScheduleObserver,
  runResidentScheduleObserver,
} from '../../../src/core/runtime/services/resident-schedule-observer.js';
import { runResidentActivityWorker } from '../../../src/core/runtime/services/resident-activity-worker.js';

/** @typedef {import('../../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} ManifestActivityExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'embedded'}>} EmbeddedExecution */

const TABLE_NAME = 'resident-schedule-observer-test';
const APP_ID = 'resident-schedule-app';
const SCHEDULE_ID = 'minute-work';
const WORKFLOW_ID = 'scheduled-work';
const MINUTE = 60_000;
const ACTIVATION_AT = 2 * MINUTE + 123;
const ARTIFACT_A = `waf1_${'A'.repeat(43)}`;
const ARTIFACT_B = `waf1_${'B'.repeat(42)}A`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const WORKFLOW_DEFINITION = Object.freeze({
  steps: Object.freeze([
    Object.freeze({
      id: 'work',
      kind: 'activity',
      activity: 'work',
      input: Object.freeze({ kind: 'workflow-input' }),
    }),
  ]),
});

/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    // eslint-disable-next-line no-await-in-loop
    await cleanups.pop()?.();
  }
});

function createHarness() {
  const dbRoot = mkdtempSync(
    join(tmpdir(), 'wharfie-resident-schedule-observer-db-'),
  );
  const payloadRoot = mkdtempSync(
    join(tmpdir(), 'wharfie-resident-schedule-observer-payload-'),
  );
  const db = createVanillaDB({ path: dbRoot });
  const payloadStore = createLocalExecutionPayloadStore({
    path: payloadRoot,
    storeId: 'resident-schedule-observer-test',
  });
  const ledger = createExecutionLedger({
    db,
    tableName: TABLE_NAME,
    payloadStore,
  });
  const ownershipStore = createLedgerServiceOwnership({
    db,
    tableName: TABLE_NAME,
  });
  const scheduleControl = createScheduleControl({
    db,
    tableName: TABLE_NAME,
  });
  const activation = createLocalApplicationActivation({
    db,
    tableName: TABLE_NAME,
  });
  cleanups.push(async () => {
    await db.close();
    rmSync(dbRoot, { recursive: true, force: true });
    rmSync(payloadRoot, { recursive: true, force: true });
  });
  return {
    db,
    ledger,
    ownershipStore,
    scheduleControl,
    activation,
    controlContext: { db, tableName: TABLE_NAME },
  };
}

/** @param {ReturnType<typeof createLedgerServiceOwnership>} ownershipStore */
async function claimResident(ownershipStore) {
  return (
    await ownershipStore.claimOwnership({
      serviceId: createLedgerServiceId({ appId: APP_ID }),
      appId: APP_ID,
      scopeId: 'local-root',
      principalId: 'developer',
      sessionId: createLedgerServiceSessionId(),
      ownerKind: LedgerServiceOwnerKind.RESIDENT,
      expected: null,
      claimedAt: 10,
    })
  ).ownership;
}

/**
 * @param {ReturnType<typeof createLedgerServiceOwnership>} ownershipStore
 * @param {Readonly<Record<string, any>>} ownership
 */
async function releaseResident(ownershipStore, ownership) {
  await ownershipStore.releaseOwnership({
    serviceId: ownership.serviceId,
    scopeId: ownership.scopeId,
    principalId: ownership.principalId,
    sessionId: ownership.sessionId,
    generation: ownership.generation,
  });
}

/**
 * @param {ReturnType<typeof createLocalApplicationActivation>} activation
 * @param {string} revisionId
 */
async function activateManagedRevision(activation, revisionId) {
  const begun = await activation.beginInstall({
    appId: APP_ID,
    target: { artifactId: ARTIFACT_A, revisionId },
    observedAt: 1,
  });
  const transitionId = begun.activation.transition.transitionId;
  await activation.markQuiescent({
    appId: APP_ID,
    transitionId,
    observedAt: 2,
  });
  await activation.markSelected({
    appId: APP_ID,
    transitionId,
    destination: LocalApplicationActivationDestination.TARGET,
    observedAt: 3,
  });
  await activation.markActivating({
    appId: APP_ID,
    transitionId,
    observedAt: 4,
  });
  await activation.completeActivation({
    appId: APP_ID,
    transitionId,
    observedAt: 5,
  });
}

/** @param {string} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @param {string} [cron]
 * @returns {{binding: Readonly<Record<string, any>>, execution: EmbeddedExecution}}
 */
function createExecutionContext(cron = '* * * * *') {
  const scheduleDefinition = Object.freeze({
    cron,
    workflow: WORKFLOW_ID,
    input: Object.freeze({ requestedBy: 'schedule' }),
    missed: 'latest',
    overlap: 'allow',
  });
  const contract = {
    schemaVersion: 4,
    app: { id: APP_ID },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
    activities: {
      work: {
        entrypoint: {
          kind: 'node',
          path: 'activities/work.js',
          export: 'work',
        },
      },
    },
    workflows: {
      [WORKFLOW_ID]: WORKFLOW_DEFINITION,
    },
    schedules: {
      [SCHEDULE_ID]: scheduleDefinition,
    },
  };
  const revision = createApplicationRevision({
    contract,
    inputs: {
      source: { format: SOURCE_TREE_INPUT_FORMAT, digest: digest('source') },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
  const execution = /** @type {EmbeddedExecution} */ ({
    kind: /** @type {const} */ ('embedded'),
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: APP_ID,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  });
  const binding = resolveManifestScheduleBindings(execution)[0];
  return { binding, execution };
}

/** @returns {EmbeddedExecution} */
function createUnscheduledExecution() {
  const contract = {
    schemaVersion: 4,
    app: { id: APP_ID },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
  };
  const revision = createApplicationRevision({
    contract,
    inputs: {
      source: {
        format: SOURCE_TREE_INPUT_FORMAT,
        digest: digest('unscheduled-source'),
      },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
  return /** @type {EmbeddedExecution} */ ({
    kind: 'embedded',
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: APP_ID,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  });
}

/**
 * @param {EmbeddedExecution} embedded
 * @param {() => Promise<void>} verifyRuntime
 */
function createPreparedExecution(embedded, verifyRuntime) {
  return {
    kind: /** @type {const} */ ('prepared-source'),
    prepared: {
      revision: embedded.embeddedRevision.revision,
      appDir: process.cwd(),
      manifest: structuredClone(embedded.manifest),
      assets: {},
      dependencyLock: {
        path: join(tmpdir(), 'resident-schedule-observer-package-lock.json'),
        input: embedded.embeddedRevision.revision.inputs.dependencies,
      },
      verifyRuntime,
      cleanup: async () => undefined,
    },
  };
}

/** @param {Readonly<Record<string, any>>} binding @param {number} scheduledAt */
function expectedOccurrence(binding, scheduledAt) {
  const cause = createScheduleRunCause({
    appId: APP_ID,
    scheduleId: SCHEDULE_ID,
    definitionId: binding.definitionId,
    scheduledAt,
  });
  return {
    cause,
    runId: createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: cause.occurrenceId,
    }),
  };
}

describe('resident schedule observer', () => {
  test('becomes ready without inventing work for an unscheduled application', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const execution = createUnscheduledExecution();
    const controller = new AbortController();
    let readyCount = 0;

    await expect(
      runResidentScheduleObserver({
        ledger: harness.ledger,
        execution,
        controlContext: harness.controlContext,
        ownership,
        signal: controller.signal,
        now: () => ACTIVATION_AT,
        wait: () => controller.abort(),
        onReady: () => {
          readyCount += 1;
        },
      }),
    ).resolves.toEqual({
      observations: 1,
      admitted: 0,
      replayed: 0,
      advanced: 0,
    });
    expect(readyCount).toBe(1);
  });

  test('uses its first observation as an exclusive activation horizon', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { binding, execution } = createExecutionContext();
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
    });

    await expect(
      observer.observe({ observedAt: ACTIVATION_AT }),
    ).resolves.toEqual({
      observedAt: ACTIVATION_AT,
      throughInclusive: 2 * MINUTE,
      scheduleCount: 1,
      admitted: 0,
      replayed: 0,
      advanced: 0,
    });
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      activationBoundary: 2 * MINUTE,
      horizon: 2 * MINUTE,
      version: 1,
    });

    const activationOccurrence = expectedOccurrence(binding, 2 * MINUTE);
    await expect(
      harness.scheduleControl.getOccurrence({
        occurrenceId: activationOccurrence.cause.occurrenceId,
      }),
    ).resolves.toBeNull();
    await expect(
      harness.ledger.rebuildRun(activationOccurrence.runId),
    ).resolves.toBeNull();
  });

  test('rejects overlapping calls against its stateful cursor snapshot', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { execution } = createExecutionContext();
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
    });

    const first = observer.observe({ observedAt: ACTIVATION_AT });
    await expect(
      observer.observe({ observedAt: ACTIVATION_AT }),
    ).rejects.toThrow(/does not permit concurrent observations/i);
    await expect(first).resolves.toMatchObject({
      throughInclusive: 2 * MINUTE,
    });
  });

  test('atomically admits the next due occurrence and wakes ready work', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { binding, execution } = createExecutionContext();
    let wakeCount = 0;
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
      onWorkflowReady: () => {
        wakeCount += 1;
      },
    });
    await observer.observe({ observedAt: ACTIVATION_AT });

    await expect(
      observer.observe({ observedAt: 3 * MINUTE + 999 }),
    ).resolves.toMatchObject({
      throughInclusive: 3 * MINUTE,
      admitted: 1,
      replayed: 0,
      advanced: 0,
    });

    const occurrence = expectedOccurrence(binding, 3 * MINUTE);
    await expect(
      harness.scheduleControl.getOccurrence({
        occurrenceId: occurrence.cause.occurrenceId,
      }),
    ).resolves.toMatchObject({
      runId: occurrence.runId,
      planId: binding.planId,
      cause: occurrence.cause,
    });
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      horizon: 3 * MINUTE,
      version: 2,
    });
    await expect(
      harness.ledger.rebuildRun(occurrence.runId),
    ).resolves.toMatchObject({
      run: {
        runId: occurrence.runId,
        revisionId: binding.revisionId,
        trigger: {
          kind: 'workflow',
          workflowId: WORKFLOW_ID,
          planId: binding.planId,
          cause: occurrence.cause,
        },
        status: 'RUNNING',
      },
      invocations: [
        {
          activityId: 'work',
          status: 'RUNNABLE',
        },
      ],
      events: [{ type: 'workflow-run-created' }],
    });
    expect(wakeCount).toBe(1);
  });

  test('rejects a post-admission cursor replaced by another revision', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const first = createExecutionContext();
    const replacement = createExecutionContext('0 * * * *');
    expect(replacement.binding.revisionId).not.toBe(first.binding.revisionId);
    expect(replacement.binding.definitionId).not.toBe(
      first.binding.definitionId,
    );

    const replacementObserver = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution: replacement.execution,
      controlContext: harness.controlContext,
      ownership,
    });
    const observedAt = 3 * MINUTE + 999;
    const interleavingLedger = {
      ...harness.ledger,
      createWorkflowRun: async (
        /** @type {Parameters<typeof harness.ledger.createWorkflowRun>[0]} */ request,
      ) => {
        const outcome = await harness.ledger.createWorkflowRun(request);
        await replacementObserver.observe({ observedAt });
        return outcome;
      },
    };
    const firstObserver = createResidentScheduleObserver({
      ledger: interleavingLedger,
      execution: first.execution,
      controlContext: harness.controlContext,
      ownership,
    });
    await firstObserver.observe({ observedAt: ACTIVATION_AT });

    await expect(firstObserver.observe({ observedAt })).rejects.toThrow(
      /does not match its exact binding/i,
    );
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      revisionId: replacement.binding.revisionId,
      definitionId: replacement.binding.definitionId,
      activationBoundary: 3 * MINUTE,
      horizon: 3 * MINUTE,
    });
  });

  test('advances a no-due cursor without inventing workflow work', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { binding, execution } = createExecutionContext('0 * * * *');
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
    });
    await observer.observe({ observedAt: ACTIVATION_AT });

    await expect(
      observer.observe({ observedAt: 3 * MINUTE + 999 }),
    ).resolves.toMatchObject({
      throughInclusive: 3 * MINUTE,
      admitted: 0,
      replayed: 0,
      advanced: 1,
    });
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      activationBoundary: 2 * MINUTE,
      horizon: 3 * MINUTE,
      version: 2,
    });
    const nonexistent = expectedOccurrence(binding, 3 * MINUTE);
    await expect(
      harness.scheduleControl.getOccurrence({
        occurrenceId: nonexistent.cause.occurrenceId,
      }),
    ).resolves.toBeNull();
    await expect(
      harness.ledger.rebuildRun(nonexistent.runId),
    ).resolves.toBeNull();
  });

  test('replays a stale same-owner observation and lets a replacement owner resume', async () => {
    const harness = createHarness();
    const firstOwnership = await claimResident(harness.ownershipStore);
    const { binding, execution } = createExecutionContext();
    const options = {
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership: firstOwnership,
    };
    const winningObserver = createResidentScheduleObserver(options);
    const replayingObserver = createResidentScheduleObserver(options);
    await winningObserver.observe({ observedAt: ACTIVATION_AT });
    await replayingObserver.observe({ observedAt: ACTIVATION_AT });

    await expect(
      winningObserver.observe({ observedAt: 3 * MINUTE + 999 }),
    ).resolves.toMatchObject({ admitted: 1, replayed: 0 });
    await expect(
      replayingObserver.observe({ observedAt: 3 * MINUTE + 999 }),
    ).resolves.toMatchObject({ admitted: 0, replayed: 1 });

    await releaseResident(harness.ownershipStore, firstOwnership);
    const replacementOwnership = await claimResident(harness.ownershipStore);
    const replacementObserver = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership: replacementOwnership,
    });
    await expect(
      replacementObserver.observe({ observedAt: 4 * MINUTE + 999 }),
    ).resolves.toMatchObject({
      admitted: 1,
      replayed: 0,
      advanced: 0,
    });

    for (const scheduledAt of [3 * MINUTE, 4 * MINUTE]) {
      const occurrence = expectedOccurrence(binding, scheduledAt);
      // eslint-disable-next-line no-await-in-loop
      await expect(
        harness.scheduleControl.getOccurrence({
          occurrenceId: occurrence.cause.occurrenceId,
        }),
      ).resolves.toMatchObject({
        runId: occurrence.runId,
        cause: occurrence.cause,
      });
      // eslint-disable-next-line no-await-in-loop
      await expect(
        harness.ledger.getEvents(occurrence.runId),
      ).resolves.toHaveLength(1);
    }
  });

  test('fails promptly when the held owner changes within one schedule minute', async () => {
    const harness = createHarness();
    const firstOwnership = await claimResident(harness.ownershipStore);
    const { execution } = createExecutionContext();
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership: firstOwnership,
    });
    await observer.observe({ observedAt: ACTIVATION_AT });

    await releaseResident(harness.ownershipStore, firstOwnership);
    await claimResident(harness.ownershipStore);

    await expect(
      observer.observe({ observedAt: ACTIVATION_AT + 100 }),
    ).rejects.toBeInstanceOf(ResidentScheduleOwnershipLostError);
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      horizon: 2 * MINUTE,
      version: 1,
    });
  });

  test('fails promptly when managed activation closes within one schedule minute', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { execution } = createExecutionContext();
    const revisionId = execution.embeddedRevision.revision.revisionId;
    await activateManagedRevision(harness.activation, revisionId);
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
    });
    await observer.observe({ observedAt: ACTIVATION_AT });

    await harness.activation.beginChange({
      appId: APP_ID,
      action: LocalApplicationActivationAction.UPDATE,
      source: { artifactId: ARTIFACT_A, revisionId },
      target: { artifactId: ARTIFACT_B, revisionId: REVISION_B },
      observedAt: ACTIVATION_AT + 1,
    });

    await expect(
      observer.observe({ observedAt: ACTIVATION_AT + 100 }),
    ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      horizon: 2 * MINUTE,
      version: 1,
    });
  });

  test('preserves cursor authority across a backward wall-clock correction and restart', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { execution } = createExecutionContext();
    const firstObserver = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
    });
    await firstObserver.observe({ observedAt: ACTIVATION_AT });

    const restartedObserver = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution,
      controlContext: harness.controlContext,
      ownership,
    });
    await expect(
      restartedObserver.observe({ observedAt: ACTIVATION_AT - 30_000 }),
    ).resolves.toMatchObject({
      throughInclusive: MINUTE,
      admitted: 0,
      replayed: 0,
      advanced: 0,
    });
    await expect(
      restartedObserver.observe({ observedAt: 3 * MINUTE + 999 }),
    ).resolves.toMatchObject({
      throughInclusive: 3 * MINUTE,
      admitted: 1,
    });
  });

  test('notifies runner readiness once after the initial successful observation', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { execution } = createExecutionContext();
    const controller = new AbortController();
    let readyCount = 0;
    let waitCount = 0;
    let nowCount = 0;

    await expect(
      runResidentScheduleObserver({
        ledger: harness.ledger,
        execution,
        controlContext: harness.controlContext,
        ownership,
        signal: controller.signal,
        pollIntervalMs: 7,
        now: () => ACTIVATION_AT + nowCount++,
        wait: (signal, pollIntervalMs) => {
          expect(signal).toBe(controller.signal);
          expect(pollIntervalMs).toBe(7);
          waitCount += 1;
          if (waitCount === 2) controller.abort();
        },
        onReady: () => {
          readyCount += 1;
        },
      }),
    ).resolves.toEqual({
      observations: 2,
      admitted: 0,
      replayed: 0,
      advanced: 0,
    });
    expect(readyCount).toBe(1);
  });

  test('verifies a prepared source before activation and every changing minute', async () => {
    const harness = createHarness();
    const ownership = await claimResident(harness.ownershipStore);
    const { execution } = createExecutionContext();
    const sourceChanged = new Error('prepared source changed');
    let verificationCount = 0;
    const verifyRuntime = async () => {
      verificationCount += 1;
      if (verificationCount === 2) throw sourceChanged;
    };
    const observer = createResidentScheduleObserver({
      ledger: harness.ledger,
      execution: createPreparedExecution(execution, verifyRuntime),
      controlContext: harness.controlContext,
      ownership,
    });

    await observer.observe({ observedAt: ACTIVATION_AT });
    await observer.observe({ observedAt: ACTIVATION_AT + 100 });
    expect(verificationCount).toBe(1);

    await expect(
      observer.observe({ observedAt: 3 * MINUTE + 999 }),
    ).rejects.toBe(sourceChanged);
    expect(verificationCount).toBe(2);
    await expect(
      harness.scheduleControl.getCursor({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
      }),
    ).resolves.toMatchObject({
      horizon: 2 * MINUTE,
      version: 1,
    });
  });

  test.each(['embedded', 'prepared-source'])(
    'composes the real observer and worker over one vanilla control store with %s execution',
    async (executionKind) => {
      const harness = createHarness();
      const ownership = await claimResident(harness.ownershipStore);
      const { binding, execution: embeddedExecution } =
        createExecutionContext();
      let sourceVerifications = 0;
      const execution =
        executionKind === 'prepared-source'
          ? createPreparedExecution(embeddedExecution, async () => {
              sourceVerifications += 1;
            })
          : embeddedExecution;
      const currentMinute = Math.floor(Date.now() / MINUTE) * MINUTE;
      await harness.scheduleControl.activate({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
        revisionId: binding.revisionId,
        definitionId: binding.definitionId,
        owner: ownership,
        observedAt: currentMinute - 2 * MINUTE,
      });
      const controller = new AbortController();
      let workflowDispatches = 0;
      let commandServerClosed = false;

      await expect(
        runResidentActivityWorker({
          ledger: harness.ledger,
          execution,
          controlContext: {
            ...harness.controlContext,
            adapterName: 'vanilla',
            controlPath: '/private/tmp/wharfie-v92-observer-integration',
          },
          owner: {
            serviceId: ownership.serviceId,
            commandSession: { serviceId: ownership.serviceId },
            ownership,
          },
          signal: controller.signal,
          runActivity: async () => {
            throw new Error(
              'Scheduled workflow must not dispatch manual work.',
            );
          },
          runWorkflowActivity: async (request) => {
            workflowDispatches += 1;
            expect(request).toMatchObject({
              workflowId: WORKFLOW_ID,
              planId: binding.planId,
            });
            controller.abort();
            return {
              appId: APP_ID,
              revisionId: binding.revisionId,
              workflowId: WORKFLOW_ID,
              planId: binding.planId,
              activityName: request.activityId,
              runId: request.runId,
              outcome: {},
            };
          },
          createCommandServer: async () => ({
            endpoint: '/private/tmp/wharfie-v92-observer-integration-command',
            session: {
              serviceId: ownership.serviceId,
              sessionId: ownership.sessionId,
              sessionRoot:
                '/private/tmp/wharfie-v92-observer-integration-session',
              endpoint: '/private/tmp/wharfie-v92-observer-integration-live',
              ownerCommandEndpoint:
                '/private/tmp/wharfie-v92-observer-integration-command',
            },
            close: async () => {
              commandServerClosed = true;
            },
          }),
        }),
      ).resolves.toEqual({ processed: 1 });

      expect(workflowDispatches).toBe(1);
      expect(commandServerClosed).toBe(true);
      expect(sourceVerifications).toBe(
        executionKind === 'prepared-source' ? 1 : 0,
      );
    },
  );
});
