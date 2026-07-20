import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  createWorkflowPlanId,
  isWorkflowActivityDispatchSupported,
  normalizeWorkflowPlanPayload,
} from '../lib/ledger/workflow-execution-contract.js';
import {
  getManifestActivityNames,
  invokeManifestActivityAttemptWithStart,
  resolveManifestActivityExecutionBinding,
} from './app-runs.js';
import { cloneJsonObject } from './json-value.js';
import { runWorkflowLedgerActivity } from './workflow-ledger-run.js';

/**
 * Cross-check one persisted activation against the exact workflow definition
 * sealed into an already-bound application revision.
 * @param {{identity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, workflowId: string, planId: string, activityId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}}} options - Bound revision and persisted activation.
 * @returns {Readonly<{planPayload: Record<string, any>, step: Record<string, any>, dispatchSupported: boolean}>} - Exact manifest binding.
 */
export function resolveManifestWorkflowActivityBinding(options) {
  const definition = options.identity.manifest.workflows?.[options.workflowId];
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
    'resident manifest workflow plan',
  );
  const expectedPlanId = createWorkflowPlanId(planPayload);
  if (expectedPlanId !== options.planId) {
    throw new Error(
      `Persisted workflow plan ${String(options.planId)} does not match workflow '${String(options.workflowId)}' in revision ${options.identity.revisionId}.`,
    );
  }
  const step = planPayload.definition.steps[options.cursor?.stepIndex];
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
    planPayload,
    step,
    dispatchSupported: isWorkflowActivityDispatchSupported(
      options.cursor,
      planPayload,
    ),
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
