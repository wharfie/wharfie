import { compareCanonicalStrings } from './canonical-order.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const WORKFLOW_MAX_STEPS = 64;
export const WORKFLOW_DEFINITIONS_MAX_BYTES = 1024 * 1024;

const WORKFLOW_DEFINITION_KEYS = ['steps'];
const WORKFLOW_INPUT_KEYS = /** @type {Record<string, string[]>} */ ({
  literal: ['kind', 'value'],
  'step-output': ['kind', 'step'],
  'workflow-input': ['kind'],
});
const WORKFLOW_STEP_KEYS = /** @type {Record<string, string[]>} */ ({
  activity: ['id', 'kind', 'activity', 'input'],
  signal: ['id', 'kind'],
  timer: ['id', 'kind', 'delayMs'],
});

/**
 * @typedef {{kind: 'workflow-input'} | {kind: 'step-output', step: string} | {kind: 'literal', value: any}} WorkflowActivityInput
 * @typedef {{id: string, kind: 'activity', activity: string, input: WorkflowActivityInput} | {id: string, kind: 'timer', delayMs: number} | {id: string, kind: 'signal'}} WorkflowStep
 * @typedef {{steps: WorkflowStep[]}} WorkflowDefinition
 */

/**
 * Require one object to contain exactly the named fields.
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} keys - Exact fields.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertExactKeys(value, keys, valuePath) {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(
      `${valuePath} must contain exactly ${keys.join(', ')}.`,
    );
  }
}

/**
 * Normalize a caller-supplied collection of already-declared step IDs.
 * @param {Iterable<string> | undefined} value - Prior step identities.
 * @param {string} valuePath - Human-readable option path.
 * @returns {Set<string>} - Independent prior-step set.
 */
function normalizePriorStepIds(value, valuePath) {
  if (value === undefined) return new Set();
  if (!value || typeof value[Symbol.iterator] !== 'function') {
    throw new TypeError(
      `${valuePath} must be an iterable of logical step IDs.`,
    );
  }
  const stepIds = new Set();
  for (const stepId of value) {
    assertLogicalId(stepId, valuePath);
    stepIds.add(stepId);
  }
  return stepIds;
}

/**
 * Validate one explicit activity-input binding. A step-output binding may only
 * name an earlier step supplied by the enclosing workflow validator.
 * @param {unknown} value - Candidate input binding.
 * @param {{valuePath?: string, priorStepIds?: Iterable<string>}} [options] - Validation context.
 * @returns {WorkflowActivityInput} - Independent normalized binding.
 */
export function validateWorkflowActivityInput(value, options = {}) {
  const valuePath = options.valuePath || 'workflow activity input';
  const input = cloneBoundedJsonObject(
    value,
    WORKFLOW_DEFINITIONS_MAX_BYTES,
    valuePath,
  );
  const keys = WORKFLOW_INPUT_KEYS[input.kind];
  if (!keys) {
    throw new TypeError(
      `${valuePath}.kind must be 'workflow-input', 'step-output', or 'literal'.`,
    );
  }
  assertExactKeys(input, keys, valuePath);

  if (input.kind === 'step-output') {
    assertLogicalId(input.step, `${valuePath}.step`);
    const priorStepIds = normalizePriorStepIds(
      options.priorStepIds,
      `${valuePath} priorStepIds`,
    );
    if (!priorStepIds.has(input.step)) {
      throw new TypeError(
        `${valuePath}.step must reference an earlier step in the same workflow.`,
      );
    }
  }

  return /** @type {WorkflowActivityInput} */ (input);
}

/**
 * Validate one workflow step independently of an application manifest.
 * Activity existence is checked later by the manifest boundary.
 * @param {unknown} value - Candidate workflow step.
 * @param {{valuePath?: string, priorStepIds?: Iterable<string>}} [options] - Validation context.
 * @returns {WorkflowStep} - Independent normalized step.
 */
export function validateWorkflowStep(value, options = {}) {
  const valuePath = options.valuePath || 'workflow step';
  const step = cloneBoundedJsonObject(
    value,
    WORKFLOW_DEFINITIONS_MAX_BYTES,
    valuePath,
  );
  const keys = WORKFLOW_STEP_KEYS[step.kind];
  if (!keys) {
    throw new TypeError(
      `${valuePath}.kind must be 'activity', 'timer', or 'signal'.`,
    );
  }
  assertExactKeys(step, keys, valuePath);
  assertLogicalId(step.id, `${valuePath}.id`);

  if (step.kind === 'activity') {
    assertLogicalId(step.activity, `${valuePath}.activity`);
    step.input = validateWorkflowActivityInput(step.input, {
      valuePath: `${valuePath}.input`,
      priorStepIds: options.priorStepIds,
    });
  } else if (step.kind === 'timer') {
    if (!Number.isSafeInteger(step.delayMs) || step.delayMs < 1) {
      throw new TypeError(
        `${valuePath}.delayMs must be a positive safe integer.`,
      );
    }
  }

  return /** @type {WorkflowStep} */ (step);
}

/**
 * Validate one finite ordered workflow definition. Array order is the complete
 * continuation graph; output references therefore point backward only.
 * @param {unknown} value - Candidate workflow definition.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {WorkflowDefinition} - Independent normalized definition.
 */
export function validateWorkflowDefinition(
  value,
  valuePath = 'workflow definition',
) {
  const definition = cloneBoundedJsonObject(
    value,
    WORKFLOW_DEFINITIONS_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(definition, WORKFLOW_DEFINITION_KEYS, valuePath);
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new TypeError(`${valuePath}.steps must be a nonempty array.`);
  }
  if (definition.steps.length > WORKFLOW_MAX_STEPS) {
    throw new TypeError(
      `${valuePath}.steps must contain at most ${WORKFLOW_MAX_STEPS} steps.`,
    );
  }

  const priorStepIds = new Set();
  definition.steps = definition.steps.map((step, index) => {
    const normalized = validateWorkflowStep(step, {
      valuePath: `${valuePath}.steps[${index}]`,
      priorStepIds,
    });
    if (priorStepIds.has(normalized.id)) {
      throw new TypeError(
        `${valuePath}.steps[${index}].id duplicates an earlier workflow step.`,
      );
    }
    priorStepIds.add(normalized.id);
    return normalized;
  });

  return /** @type {WorkflowDefinition} */ (definition);
}

/**
 * Validate a nonempty logical-ID keyed workflow map and return canonical key
 * order. This codec deliberately has no knowledge of application activities.
 * @param {unknown} value - Candidate workflow map.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {Record<string, WorkflowDefinition>} - Independent normalized map.
 */
export function validateWorkflowDefinitions(
  value,
  valuePath = 'workflow definitions',
) {
  const definitions = cloneBoundedJsonObject(
    value,
    WORKFLOW_DEFINITIONS_MAX_BYTES,
    valuePath,
  );
  const workflowIds = Object.keys(definitions).sort(compareCanonicalStrings);
  if (workflowIds.length === 0) {
    throw new TypeError(`${valuePath} must not be empty when provided.`);
  }

  /** @type {Record<string, WorkflowDefinition>} */
  const normalized = {};
  for (const workflowId of workflowIds) {
    assertLogicalId(workflowId, `${valuePath}.${workflowId}`);
    normalized[workflowId] = validateWorkflowDefinition(
      definitions[workflowId],
      `${valuePath}.${workflowId}`,
    );
  }
  return normalized;
}

export default {
  WORKFLOW_MAX_STEPS,
  WORKFLOW_DEFINITIONS_MAX_BYTES,
  validateWorkflowActivityInput,
  validateWorkflowDefinition,
  validateWorkflowDefinitions,
  validateWorkflowStep,
};
