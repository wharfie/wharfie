/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  WorkflowCursorDisposition,
  createWorkflowPlanId,
  createWorkflowRunId,
  normalizeWorkflowPlanPayload,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
} from '../../src/core/runtime/activity-protocol.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';

const DURABLE_WORKFLOW_HOST_IMPORT =
  '../../src/core/runtime/durable-workflow-host.js';
const FUNCTION_IMPORT = '../../src/core/resources/builds/function.js';
const APP_ID = 'durable-workflow-host';
const WORKFLOW_ID = 'main';
const ACTIVITY_ID = 'greet';
const OTHER_ACTIVITY_ID = 'other';
const STEP_ID = 'greet-step';
const OBSERVED_AT = 1_700_000_000_000;
const ACTOR = Object.freeze({ kind: 'resident', id: 'workflow-host-test' });
const CURSOR = Object.freeze({
  version: 1,
  continuationId: 'continuation-1',
  stepId: STEP_ID,
  stepIndex: 0,
});
const ACTIVITY_STEP = Object.freeze({
  id: STEP_ID,
  kind: 'activity',
  activity: ACTIVITY_ID,
  input: { kind: 'workflow-input' },
});

/** @type {{activityName: string, start: Readonly<Record<string, any>>, options: Record<string, any>}[]} */
const physicalAttempts = [];

class MockWharfieFunction {
  /**
   * @param {string} activityName - Manifest activity identity.
   * @param {Readonly<Record<string, any>>} start - Durable host start frame.
   * @param {Record<string, any>} [options] - Physical attempt controls.
   * @returns {Promise<Record<string, any>>} Completed attempt evidence.
   */
  static async runActivityAttempt(activityName, start, options = {}) {
    physicalAttempts.push({ activityName, start, options });
    const transcript = new ActivityProtocolTranscriptValidator();
    const acceptedStart = transcript.acceptHostFrame(start);
    const terminal = transcript.acceptComponentFrame({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'completed',
      attemptId: acceptedStart.attemptId,
      sequence: 1,
      result: { greeting: `Hello ${String(acceptedStart.input.name)}` },
    });
    return {
      status: terminal.type,
      start: acceptedStart,
      terminal,
      frames: [acceptedStart, terminal],
      transcript: transcript.snapshot(),
    };
  }
}

jest.unstable_mockModule(FUNCTION_IMPORT, () => ({
  default: MockWharfieFunction,
}));

beforeEach(() => {
  physicalAttempts.length = 0;
});

/** @param {string} value - Stable fixture input. */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @param {Record<string, any>} [continuation] - Optional successor step.
 * @returns {Record<string, any>} Workflow definition.
 */
function activityDefinition(continuation) {
  return {
    steps: [ACTIVITY_STEP, ...(continuation ? [continuation] : [])],
  };
}

function makeEmbeddedExecution(definition = activityDefinition()) {
  const target = {
    nodeVersion: '24.13.1',
    platform: /** @type {const} */ ('linux'),
    architecture: /** @type {const} */ ('x64'),
    libc: /** @type {const} */ ('glibc'),
  };
  const contract = {
    schemaVersion: 4,
    app: { id: APP_ID },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
    activities: {
      [ACTIVITY_ID]: {
        entrypoint: {
          kind: 'node',
          path: 'activities/greet.js',
          export: ACTIVITY_ID,
        },
      },
      [OTHER_ACTIVITY_ID]: {
        entrypoint: {
          kind: 'node',
          path: 'activities/other.js',
          export: OTHER_ACTIVITY_ID,
        },
      },
    },
    workflows: { [WORKFLOW_ID]: definition },
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
  return {
    kind: /** @type {const} */ ('embedded'),
    manifest: { ...contract, targets: [target] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: /** @type {1} */ (ARTIFACT_RUNTIME_SCHEMA_VERSION),
        kind: /** @type {'artifactRuntime'} */ (ARTIFACT_RUNTIME_KIND),
        appId: APP_ID,
        revisionId: revision.revisionId,
        target,
      },
    },
  };
}

/**
 * @param {ReturnType<typeof makeEmbeddedExecution>} embedded - Matching revision fixture.
 * @param {() => Promise<void>} verifyRuntime - Async verification seam.
 * @returns {Record<string, any>} Prepared-source execution fixture.
 */
function makePreparedExecution(embedded, verifyRuntime) {
  return {
    kind: 'prepared-source',
    prepared: {
      revision: embedded.embeddedRevision.revision,
      appDir: process.cwd(),
      manifest: structuredClone(embedded.manifest),
      assets: {},
      dependencyLock: {
        path: join(tmpdir(), 'durable-workflow-host-package-lock.json'),
        input: embedded.embeddedRevision.revision.inputs.dependencies,
      },
      verifyRuntime,
      cleanup: async () => {},
    },
  };
}

/**
 * @param {ReturnType<typeof makeEmbeddedExecution>} [execution] - Embedded manifest fixture.
 * @returns {{execution: ReturnType<typeof makeEmbeddedExecution>, identity: {appId: string, revisionId: string, manifest: Record<string, any>}, planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, planId: string}} Exact binding fixture.
 */
function bindingFixture(execution = makeEmbeddedExecution()) {
  const identity = {
    appId: APP_ID,
    revisionId: execution.embeddedRevision.revision.revisionId,
    manifest: execution.manifest,
  };
  const planPayload = normalizeWorkflowPlanPayload({
    schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId: identity.appId,
    revisionId: identity.revisionId,
    workflowId: WORKFLOW_ID,
    definition: identity.manifest.workflows[WORKFLOW_ID],
  });
  return {
    execution,
    identity,
    planPayload,
    planId: createWorkflowPlanId(planPayload),
  };
}

/** @typedef {ReturnType<typeof bindingFixture>} BindingFixture */

/**
 * @param {BindingFixture} fixture - Exact manifest binding.
 * @param {unknown} ledger - Ledger stub that preflight must not access.
 * @param {Record<string, any>} [overrides] - Invalid binding mutation.
 * @returns {Parameters<typeof import('../../src/core/runtime/durable-workflow-host.js').runPersistedDurableManifestWorkflowActivity>[0]} Host options.
 */
function hostOptions(fixture, ledger, overrides = {}) {
  const ledgerStore =
    /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */ (
      ledger
    );
  return {
    ledger: ledgerStore,
    execution: fixture.execution,
    runId: createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'binding-preflight',
    }),
    workflowId: WORKFLOW_ID,
    planId: fixture.planId,
    invocationId: 'invocation-1',
    activityId: ACTIVITY_ID,
    generation: 0,
    cursor: CURSOR,
    ...overrides,
  };
}

async function loadHost() {
  return await import(DURABLE_WORKFLOW_HOST_IMPORT);
}

describe('durable workflow manifest binding', () => {
  it('resolves one fully dispatchable manifest workflow start', async () => {
    const { resolveManifestWorkflowStartBinding } = await loadHost();
    const fixture = bindingFixture();

    expect(
      resolveManifestWorkflowStartBinding({
        identity: fixture.identity,
        workflowId: WORKFLOW_ID,
      }),
    ).toEqual({
      planId: fixture.planId,
      planPayload: fixture.planPayload,
    });
  });

  it('resolves the exact manifest workflow plan and activity step', async () => {
    const { resolveManifestWorkflowActivityBinding } = await loadHost();
    const fixture = bindingFixture();

    const binding = resolveManifestWorkflowActivityBinding({
      identity: fixture.identity,
      workflowId: WORKFLOW_ID,
      planId: fixture.planId,
      activityId: ACTIVITY_ID,
      cursor: CURSOR,
    });

    expect(binding).toEqual({
      planPayload: fixture.planPayload,
      step: ACTIVITY_STEP,
    });
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it.each([
    {
      label: 'plan ID',
      override: (/** @type {{planId: string}} */ { planId }) => ({
        planId: `${planId.slice(0, -1)}${planId.endsWith('A') ? 'B' : 'A'}`,
      }),
      expected: /persisted workflow plan .* does not match/i,
    },
    {
      label: 'workflow ID',
      override: () => ({ workflowId: 'missing-workflow' }),
      expected: /workflow 'missing-workflow' is unavailable/i,
    },
    {
      label: 'cursor step ID',
      override: () => ({ cursor: { ...CURSOR, stepId: 'other-step' } }),
      expected: /does not match its exact manifest activity step/i,
    },
    {
      label: 'cursor step index',
      override: () => ({ cursor: { ...CURSOR, stepIndex: 1 } }),
      expected: /does not match its exact manifest activity step/i,
    },
    {
      label: 'activity ID',
      override: () => ({ activityId: OTHER_ACTIVITY_ID }),
      expected: /does not match its exact manifest activity step/i,
    },
  ])('rejects a mismatched $label', async ({ override, expected }) => {
    const { resolveManifestWorkflowActivityBinding } = await loadHost();
    const fixture = bindingFixture();
    expect(() =>
      resolveManifestWorkflowActivityBinding({
        identity: fixture.identity,
        workflowId: WORKFLOW_ID,
        planId: fixture.planId,
        activityId: ACTIVITY_ID,
        cursor: CURSOR,
        ...override(fixture),
      }),
    ).toThrow(expected);
  });

  it('rejects a workflow step whose activity is not declared by the manifest', async () => {
    const { resolveManifestWorkflowActivityBinding } = await loadHost();
    const fixture = bindingFixture();
    const identity = structuredClone(fixture.identity);
    identity.manifest.workflows[WORKFLOW_ID].steps[0].activity =
      'undeclared-activity';
    const planPayload = normalizeWorkflowPlanPayload({
      schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
      kind: WORKFLOW_PLAN_PAYLOAD_KIND,
      appId: identity.appId,
      revisionId: identity.revisionId,
      workflowId: WORKFLOW_ID,
      definition: identity.manifest.workflows[WORKFLOW_ID],
    });

    expect(() =>
      resolveManifestWorkflowActivityBinding({
        identity,
        workflowId: WORKFLOW_ID,
        planId: createWorkflowPlanId(planPayload),
        activityId: 'undeclared-activity',
        cursor: CURSOR,
      }),
    ).toThrow(/does not match its exact manifest activity step/i);
  });

  it('binds an activity whose persisted successor is a framework timer', async () => {
    const { resolveManifestWorkflowActivityBinding } = await loadHost();
    const fixture = bindingFixture(
      makeEmbeddedExecution({
        steps: [ACTIVITY_STEP, { id: 'pause', kind: 'timer', delayMs: 1_000 }],
      }),
    );
    const ledger = { rebuildRun: jest.fn() };
    expect(
      resolveManifestWorkflowActivityBinding({
        identity: fixture.identity,
        workflowId: WORKFLOW_ID,
        planId: fixture.planId,
        activityId: ACTIVITY_ID,
        cursor: CURSOR,
      }),
    ).toEqual({
      planPayload: fixture.planPayload,
      step: ACTIVITY_STEP,
    });
    expect(ledger.rebuildRun).not.toHaveBeenCalled();
    expect(physicalAttempts).toEqual([]);
  });
});

describe('durable workflow start host', () => {
  it('creates and exactly replays one manifest-bound workflow start', async () => {
    const { startDurableManifestWorkflow } = await loadHost();
    const root = mkdtempSync(join(tmpdir(), 'wharfie-workflow-start-host-'));
    const fixture = bindingFixture();
    const db = createVanillaDB({ path: join(root, 'db') });
    const payloadStore = createLocalExecutionPayloadStore({
      path: join(root, 'payloads'),
      storeId: 'durable-workflow-start-host-test',
    });
    const ledger = createExecutionLedger({
      db,
      tableName: 'durable-workflow-start-host-test',
      payloadStore,
    });
    const idempotencyKey = 'public-workflow-start';
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey,
    });
    const request = {
      ledger,
      execution: fixture.execution,
      workflowId: WORKFLOW_ID,
      idempotencyKey,
      input: { name: 'Ada' },
      callerMetadata: { source: 'workflow-start-host-test' },
      actor: { kind: 'workflow-operator', id: fixture.identity.revisionId },
    };

    try {
      const created = await startDurableManifestWorkflow(request);
      const replayed = await startDurableManifestWorkflow(request);

      expect(created).toMatchObject({
        appId: APP_ID,
        revisionId: fixture.identity.revisionId,
        workflowId: WORKFLOW_ID,
        planId: fixture.planId,
        idempotencyKey,
        runId,
        outcome: {
          applied: true,
          run: {
            runId,
            trigger: {
              kind: 'workflow',
              workflowId: WORKFLOW_ID,
              planId: fixture.planId,
            },
            status: RunStatus.RUNNING,
          },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: STEP_ID,
            stepIndex: 0,
          },
          invocation: {
            activityId: ACTIVITY_ID,
            status: InvocationStatus.RUNNABLE,
          },
        },
      });
      expect(replayed).toMatchObject({
        runId,
        planId: fixture.planId,
        outcome: { applied: false },
      });
      await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
      await expect(
        ledger.listReadyWork({
          appId: APP_ID,
          revisionId: fixture.identity.revisionId,
          observedAt: Number.MAX_SAFE_INTEGER,
          limit: 10,
        }),
      ).resolves.toMatchObject({
        items: [
          expect.objectContaining({
            runId,
            stepId: STEP_ID,
          }),
        ],
      });
    } finally {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('starts a plan whose first persisted continuation is a timer', async () => {
    const { startDurableManifestWorkflow } = await loadHost();
    const fixture = bindingFixture(
      makeEmbeddedExecution({
        steps: [ACTIVITY_STEP, { id: 'pause', kind: 'timer', delayMs: 1_000 }],
      }),
    );
    const outcome = {
      applied: true,
      run: { status: RunStatus.RUNNING },
      workflowCursor: {
        disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
      },
      invocation: { status: InvocationStatus.RUNNABLE },
    };
    const ledger = {
      createWorkflowRun: jest.fn(
        async (/** @type {Record<string, any>} */ _request) => outcome,
      ),
    };
    const ledgerStore = /** @type {any} */ (ledger);

    await expect(
      startDurableManifestWorkflow({
        ledger: ledgerStore,
        execution: fixture.execution,
        workflowId: WORKFLOW_ID,
        idempotencyKey: 'unsupported-public-start',
      }),
    ).resolves.toMatchObject({ outcome });
    expect(ledger.createWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: fixture.planPayload.definition,
      }),
    );
  });

  it('snapshots caller-owned start fields before async source verification', async () => {
    const { startDurableManifestWorkflow } = await loadHost();
    const fixture = bindingFixture();
    const originalLedger = {
      createWorkflowRun: jest.fn(
        async (/** @type {Record<string, any>} */ request) => ({
          applied: true,
          run: { runId: request.runId },
          workflowCursor: { planId: fixture.planId },
          invocation: {},
        }),
      ),
    };
    const replacementLedger = { createWorkflowRun: jest.fn() };
    const execution = makePreparedExecution(fixture.execution, async () => {
      request.ledger = replacementLedger;
      request.workflowId = 'mutated-workflow';
      request.idempotencyKey = 'mutated-key';
      request.input.name = 'Mutated';
      request.callerMetadata.source = 'mutated';
      request.actor.id = 'mutated-actor';
    });
    const request = /** @type {Record<string, any>} */ ({
      ledger: originalLedger,
      execution,
      workflowId: WORKFLOW_ID,
      idempotencyKey: 'snapshotted-start',
      input: { name: 'Ada' },
      callerMetadata: { source: 'original' },
      actor: { kind: 'workflow-operator', id: 'original-actor' },
    });

    await startDurableManifestWorkflow(/** @type {any} */ (request));

    expect(originalLedger.createWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: createWorkflowRunId({
          appId: APP_ID,
          idempotencyKey: 'snapshotted-start',
        }),
        workflowId: WORKFLOW_ID,
        input: { name: 'Ada' },
        callerMetadata: { source: 'original' },
        actor: { kind: 'workflow-operator', id: 'original-actor' },
      }),
    );
    expect(replacementLedger.createWorkflowRun).not.toHaveBeenCalled();
  });
});

describe('durable workflow host', () => {
  it('snapshots caller-owned activation fields before async source verification', async () => {
    const { runPersistedDurableManifestWorkflowActivity } = await loadHost();
    const fixture = bindingFixture();
    const originalRunId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'snapshotted-activation',
    });
    const replacementRunId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'mutated-activation',
    });
    const originalLedger = {
      rebuildRun: jest.fn(async (/** @type {string} */ _runId) => null),
    };
    const replacementLedger = {
      rebuildRun: jest.fn(async (/** @type {string} */ _runId) => null),
    };
    const execution = makePreparedExecution(fixture.execution, async () => {
      request.ledger = replacementLedger;
      request.runId = replacementRunId;
      request.activityId = OTHER_ACTIVITY_ID;
      request.cursor.stepId = 'mutated-step';
      request.actor.id = 'mutated-actor';
    });
    const request = /** @type {Record<string, any>} */ (
      hostOptions(fixture, originalLedger, {
        execution,
        runId: originalRunId,
        actor: { kind: 'resident', id: 'original-actor' },
        cursor: { ...CURSOR },
      })
    );

    await expect(
      runPersistedDurableManifestWorkflowActivity(/** @type {any} */ (request)),
    ).rejects.toThrow(`Workflow run disappeared: ${originalRunId}`);
    expect(originalLedger.rebuildRun).toHaveBeenCalledWith(originalRunId);
    expect(replacementLedger.rebuildRun).not.toHaveBeenCalled();
    expect(physicalAttempts).toEqual([]);
  });

  it.each([
    {
      label: 'plan ID',
      override: (/** @type {BindingFixture} */ fixture) => ({
        planId: `${fixture.planId.slice(0, -1)}${
          fixture.planId.endsWith('A') ? 'B' : 'A'
        }`,
      }),
      expected: /persisted workflow plan .* does not match/i,
    },
    {
      label: 'workflow ID',
      override: () => ({ workflowId: 'missing-workflow' }),
      expected: /workflow 'missing-workflow' is unavailable/i,
    },
    {
      label: 'cursor step',
      override: () => ({ cursor: { ...CURSOR, stepId: 'other-step' } }),
      expected: /does not match its exact manifest activity step/i,
    },
    {
      label: 'activity',
      override: () => ({ activityId: OTHER_ACTIVITY_ID }),
      expected: /does not match its exact manifest activity step/i,
    },
  ])(
    'rejects a mismatched $label before ledger or physical activity access',
    async ({ override, expected }) => {
      const { runPersistedDurableManifestWorkflowActivity } = await loadHost();
      const fixture = bindingFixture();
      const ledger = { rebuildRun: jest.fn() };

      await expect(
        runPersistedDurableManifestWorkflowActivity(
          hostOptions(fixture, ledger, override(fixture)),
        ),
      ).rejects.toThrow(expected);
      expect(ledger.rebuildRun).not.toHaveBeenCalled();
      expect(physicalAttempts).toEqual([]);
    },
  );

  it('rejects an undeclared manifest activity before ledger or physical activity access', async () => {
    const { runPersistedDurableManifestWorkflowActivity } = await loadHost();
    const fixture = bindingFixture();
    const invalidManifest = structuredClone(fixture.execution.manifest);
    invalidManifest.workflows[WORKFLOW_ID].steps[0].activity =
      'undeclared-activity';
    fixture.execution.manifest = invalidManifest;
    const ledger = { rebuildRun: jest.fn() };

    await expect(
      runPersistedDurableManifestWorkflowActivity(
        hostOptions(fixture, ledger, {
          activityId: 'undeclared-activity',
        }),
      ),
    ).rejects.toThrow(/must reference an activity declared by this manifest/i);
    expect(ledger.rebuildRun).not.toHaveBeenCalled();
    expect(physicalAttempts).toEqual([]);
  });

  it('runs an exact manifest-bound workflow activity through its durable terminal', async () => {
    const { runPersistedDurableManifestWorkflowActivity } = await loadHost();
    const root = mkdtempSync(join(tmpdir(), 'wharfie-workflow-host-'));
    const fixture = bindingFixture();
    const db = createVanillaDB({ path: join(root, 'db') });
    const payloadStore = createLocalExecutionPayloadStore({
      path: join(root, 'payloads'),
      storeId: 'durable-workflow-host-test',
    });
    const ledger = createExecutionLedger({
      db,
      tableName: 'durable-workflow-host-test',
      payloadStore,
    });
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'exact-host-happy-path',
    });

    try {
      const created = await ledger.createWorkflowRun({
        runId,
        appId: APP_ID,
        revisionId: fixture.identity.revisionId,
        workflowId: WORKFLOW_ID,
        definition: fixture.planPayload.definition,
        input: { name: 'Ada' },
        callerMetadata: { source: 'durable-workflow-host-test' },
        transitionId: 'create-exact-host-workflow',
        actor: ACTOR,
        observedAt: OBSERVED_AT,
      });
      expect(created.workflowCursor.planId).toBe(fixture.planId);

      const result = await runPersistedDurableManifestWorkflowActivity({
        ledger,
        execution: fixture.execution,
        runId,
        workflowId: WORKFLOW_ID,
        planId: fixture.planId,
        invocationId: created.invocation.invocationId,
        activityId: ACTIVITY_ID,
        generation: created.invocation.generation,
        cursor: {
          version: created.workflowCursor.version,
          continuationId: created.workflowCursor.continuationId,
          stepId: created.workflowCursor.stepId,
          stepIndex: created.workflowCursor.stepIndex,
        },
        actor: ACTOR,
        createFencingToken: () => 'workflow-host-fence',
      });

      expect(result).toMatchObject({
        appId: APP_ID,
        revisionId: fixture.identity.revisionId,
        workflowId: WORKFLOW_ID,
        planId: fixture.planId,
        activityName: ACTIVITY_ID,
        runId,
        outcome: {
          disposition: 'completed',
          dispatched: true,
          run: { status: RunStatus.COMPLETED, version: 4 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            outputs: [
              expect.objectContaining({ stepId: STEP_ID, stepIndex: 0 }),
            ],
          },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        },
      });
      expect(physicalAttempts).toHaveLength(1);
      expect(physicalAttempts[0]).toMatchObject({
        activityName: ACTIVITY_ID,
        start: {
          revisionId: fixture.identity.revisionId,
          activityId: ACTIVITY_ID,
          runId,
          invocationId: created.invocation.invocationId,
          input: { name: 'Ada' },
          caller: {
            metadata: { source: 'durable-workflow-host-test' },
          },
        },
      });
      expect(physicalAttempts[0].options.signal).toBeInstanceOf(AbortSignal);

      const rebuilt = await ledger.rebuildRun(runId);
      expect(rebuilt).toMatchObject({
        run: { status: RunStatus.COMPLETED },
        workflowCursor: {
          disposition: WorkflowCursorDisposition.COMPLETED,
        },
      });
      await expect(
        ledger.listReadyWork({
          appId: APP_ID,
          revisionId: fixture.identity.revisionId,
          observedAt: Number.MAX_SAFE_INTEGER,
          limit: 10,
        }),
      ).resolves.toEqual({ items: [] });
    } finally {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
