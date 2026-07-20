import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  createWorkflowPlanId,
  createWorkflowRunId,
  isWorkflowActivityDispatchSupported,
  normalizeWorkflowPlanPayload,
} from '../lib/ledger/workflow-execution-contract.js';
import {
  getManifestActivityNames,
  getManifestWorkflowDefinition,
  invokeManifestActivityAttemptWithStart,
  resolveManifestActivityExecutionBinding,
} from './app-runs.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { runWorkflowLedgerActivity } from './workflow-ledger-run.js';

const WORKFLOW_START_TRANSITION_ID = 'workflow-start';

/**
 * Bind one named workflow to the exact immutable application revision. Public
 * start currently accepts only plans whose complete activity chain can finish
 * on the implemented resident continuation surface.
 * @param {{identity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, workflowId: string}} options - Bound revision and workflow name.
 * @returns {Readonly<{planId: string, planPayload: Record<string, any>, dispatchSupported: boolean}>} - Exact immutable plan binding.
 */
export function resolveManifestWorkflowStartBinding(options) {
  const definition = getManifestWorkflowDefinition({
    manifest: options.identity.manifest,
    workflowName: options.workflowId,
  });
  if (!definition) {
    throw new Error(
      `Workflow '${String(options.workflowId)}' is unavailable in revision ${options.identity.revisionId}.`,
    );
  }
  const planPayload = normalizeWorkflowPlanPayload(
    {
      schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
      kind: WORKFLOW_PLAN_PAYLOAD_KIND,
      appId: options.identity.appId,
      revisionId: options.identity.revisionId,
      workflowId: options.workflowId,
      definition,
    },
    'manifest workflow plan',
  );
  return Object.freeze({
    planId: createWorkflowPlanId(planPayload),
    planPayload,
    dispatchSupported: planPayload.definition.steps.every((_, stepIndex) =>
      isWorkflowActivityDispatchSupported({ stepIndex }, planPayload),
    ),
  });
}

/**
 * Cross-check one persisted activation against the exact workflow definition
 * sealed into an already-bound application revision.
 * @param {{identity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, workflowId: string, planId: string, activityId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}}} options - Bound revision and persisted activation.
 * @returns {Readonly<{planPayload: Record<string, any>, step: Record<string, any>, dispatchSupported: boolean}>} - Exact manifest binding.
 */
export function resolveManifestWorkflowActivityBinding(options) {
  const workflow = resolveManifestWorkflowStartBinding({
    identity: options.identity,
    workflowId: options.workflowId,
  });
  if (workflow.planId !== options.planId) {
    throw new Error(
      `Persisted workflow plan ${String(options.planId)} does not match workflow '${String(options.workflowId)}' in revision ${options.identity.revisionId}.`,
    );
  }
  const step = workflow.planPayload.definition.steps[options.cursor?.stepIndex];
  if (
    !step ||
    step.kind !== 'activity' ||
    step.id !== options.cursor?.stepId ||
    step.activity !== options.activityId ||
    !getManifestActivityNames(options.identity.manifest).includes(
      options.activityId,
    )
  ) {
    throw new Error(
      'Persisted workflow activation does not match its exact manifest activity step.',
    );
  }
  return Object.freeze({
    planPayload: workflow.planPayload,
    step,
    dispatchSupported: isWorkflowActivityDispatchSupported(
      options.cursor,
      workflow.planPayload,
    ),
  });
}

/**
 * Persist one exact manifest workflow start without executing user code. The
 * caller must hold the app mutation owner; source and packaged command hosts
 * share this boundary.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: import('./durable-activity-host.js').ManifestActivityExecution, workflowId: string, idempotencyKey: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}}} options - Immutable workflow start request.
 * @returns {Promise<Readonly<{appId: string, revisionId: string, workflowId: string, planId: string, idempotencyKey: string, runId: string, outcome: Record<string, any>}>>} - Durable start result.
 */
export async function startDurableManifestWorkflow(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('startDurableManifestWorkflow requires options.');
  }
  const allowed = new Set([
    'ledger',
    'execution',
    'workflowId',
    'idempotencyKey',
    'input',
    'callerMetadata',
    'actor',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `startDurableManifestWorkflow.${key} is not supported.`,
      );
    }
  }
  const ledger = options.ledger;
  const execution = options.execution;
  const workflowId = options.workflowId;
  const idempotencyKey = options.idempotencyKey;
  const input = cloneJsonValue(
    Object.prototype.hasOwnProperty.call(options, 'input') ? options.input : {},
    'Workflow start input',
  );
  const callerMetadata = cloneJsonObject(
    Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
      ? options.callerMetadata
      : {},
    'Workflow start caller metadata',
  );
  const actor =
    options.actor === undefined
      ? undefined
      : /** @type {{kind: string, id: string}} */ (
          cloneJsonObject(options.actor, 'Workflow start actor')
        );
  if (!ledger || typeof ledger.createWorkflowRun !== 'function') {
    throw new TypeError(
      'startDurableManifestWorkflow requires a workflow execution ledger.',
    );
  }
  const binding = resolveManifestActivityExecutionBinding(execution);
  const workflow = resolveManifestWorkflowStartBinding({
    identity: binding.identity,
    workflowId,
  });
  if (!workflow.dispatchSupported) {
    throw new Error(
      `Workflow '${String(workflowId)}' cannot start until every declared continuation kind is implemented.`,
    );
  }
  const runId = createWorkflowRunId({
    appId: binding.identity.appId,
    idempotencyKey,
  });
  if (binding.execution.kind === 'prepared-source') {
    await binding.execution.prepared.verifyRuntime();
  }
  const outcome = await ledger.createWorkflowRun({
    runId,
    appId: binding.identity.appId,
    revisionId: binding.identity.revisionId,
    workflowId,
    definition: workflow.planPayload.definition,
    input,
    callerMetadata,
    transitionId: WORKFLOW_START_TRANSITION_ID,
    ...(actor === undefined ? {} : { actor }),
  });
  return Object.freeze({
    appId: binding.identity.appId,
    revisionId: binding.identity.revisionId,
    workflowId,
    planId: workflow.planId,
    idempotencyKey,
    runId,
    outcome,
  });
}

/**
 * Execute one exact persisted workflow activation against the workflow plan
 * sealed into the selected source or embedded revision. No managed-effect
 * handler is installed: workflow attempt effects remain deliberately closed.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: import('./durable-activity-host.js').ManifestActivityExecution, runId: string, workflowId: string, planId: string, invocationId: string, activityId: string, generation: number, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, actor?: {kind: string, id: string}, admissionSignal?: AbortSignal, signal?: AbortSignal, createFencingToken?: () => string}} options - Exact resident workflow activation.
 * @returns {Promise<Readonly<{appId: string, revisionId: string, workflowId: string, planId: string, activityName: string, runId: string, outcome: Record<string, any>}>>} - Durable activation result.
 */
export async function runPersistedDurableManifestWorkflowActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'runPersistedDurableManifestWorkflowActivity requires options.',
    );
  }
  const allowed = new Set([
    'ledger',
    'execution',
    'runId',
    'workflowId',
    'planId',
    'invocationId',
    'activityId',
    'generation',
    'cursor',
    'actor',
    'admissionSignal',
    'signal',
    'createFencingToken',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `runPersistedDurableManifestWorkflowActivity.${key} is not supported.`,
      );
    }
  }
  const ledger = options.ledger;
  const execution = options.execution;
  const runId = options.runId;
  const workflowId = options.workflowId;
  const planId = options.planId;
  const invocationId = options.invocationId;
  const activityId = options.activityId;
  const generation = options.generation;
  const cursor =
    /** @type {{version: number, continuationId: string, stepId: string, stepIndex: number}} */ (
      cloneJsonObject(options.cursor, 'Persisted workflow activity cursor')
    );
  const actorValue = options.actor;
  const actor =
    actorValue === undefined
      ? undefined
      : /** @type {{kind: string, id: string}} */ (
          cloneJsonObject(actorValue, 'Persisted workflow activity actor')
        );
  const admissionSignal = options.admissionSignal;
  const signal = options.signal;
  const createFencingToken = options.createFencingToken;
  if (!ledger) {
    throw new TypeError(
      'runPersistedDurableManifestWorkflowActivity requires ledger.',
    );
  }
  const binding = resolveManifestActivityExecutionBinding(execution);
  const manifestBinding = resolveManifestWorkflowActivityBinding({
    identity: binding.identity,
    workflowId,
    planId,
    activityId,
    cursor,
  });
  if (!manifestBinding.dispatchSupported) {
    throw new Error(
      `Workflow activity '${manifestBinding.step.id}' cannot dispatch before its continuation kind is implemented.`,
    );
  }
  if (binding.execution.kind === 'prepared-source') {
    await binding.execution.prepared.verifyRuntime();
  }

  const outcome = await runWorkflowLedgerActivity({
    ledger,
    runId,
    appId: binding.identity.appId,
    revisionId: binding.identity.revisionId,
    workflowId,
    planId,
    invocationId,
    activityId,
    generation,
    cursor,
    ...(actor === undefined ? {} : { actor }),
    ...(admissionSignal === undefined ? {} : { admissionSignal }),
    ...(signal === undefined ? {} : { signal }),
    ...(createFencingToken === undefined ? {} : { createFencingToken }),
    executeAttempt: async (startFrame, { signal }) =>
      await invokeManifestActivityAttemptWithStart({
        activityName: activityId,
        startFrame,
        signal,
        execution: binding.execution,
      }),
  });
  return Object.freeze({
    appId: binding.identity.appId,
    revisionId: binding.identity.revisionId,
    workflowId,
    planId,
    activityName: activityId,
    runId,
    outcome,
  });
}

export default runPersistedDurableManifestWorkflowActivity;
