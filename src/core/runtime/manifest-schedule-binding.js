/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- Readonly nested signatures are not understood by the current JSDoc lint parser. */

import { createScheduleDefinitionId } from '../lib/ledger/schedule-occurrence.js';
import { resolveManifestActivityExecutionBinding } from './app-runs.js';
import { compareCanonicalStrings } from './canonical-order.js';
import { resolveManifestWorkflowStartBinding } from './durable-workflow-host.js';

/**
 * @typedef ManifestScheduleBinding
 * @property {string} appId - Exact application identity.
 * @property {string} revisionId - Exact immutable application revision.
 * @property {string} scheduleId - Manifest schedule logical ID.
 * @property {string} definitionId - Revision- and workflow-plan-bound schedule identity.
 * @property {string} workflowId - Target workflow logical ID.
 * @property {string} planId - Exact normalized workflow plan identity.
 * @property {Readonly<import('./schedule-definition.js').ScheduleDefinition>} scheduleDefinition - Frozen static schedule definition and policies.
 * @property {Readonly<Record<string, any>>} workflowPlanPayload - Frozen normalized workflow plan sealed into the revision.
 */

/**
 * Deeply freeze one independently validated JSON value.
 * @template T
 * @param {T} value - JSON value to freeze.
 * @returns {Readonly<T>} - The same deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return /** @type {Readonly<T>} */ (value);
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return /** @type {Readonly<T>} */ (Object.freeze(value));
}

/**
 * Resolve every authored schedule against the exact workflow plan sealed into
 * one validated source or packaged execution. Bindings are
 * emitted in canonical schedule-ID order and retain no caller-owned mutable
 * values.
 * @param {unknown} executionValue - Exact source or packaged execution.
 * @returns {readonly Readonly<ManifestScheduleBinding>[]} - Frozen resident-ready bindings.
 */
export function resolveManifestScheduleBindings(executionValue) {
  const executionBinding =
    resolveManifestActivityExecutionBinding(executionValue);
  const { identity } = executionBinding;
  const { manifest } = identity;
  return Object.freeze(
    Object.keys(manifest.schedules || {})
      .sort(compareCanonicalStrings)
      .map((scheduleId) => {
        const scheduleDefinition = manifest.schedules[scheduleId];
        const workflowId = scheduleDefinition.workflow;
        const workflow = resolveManifestWorkflowStartBinding({
          identity: {
            appId: identity.appId,
            revisionId: identity.revisionId,
            manifest,
          },
          workflowId,
        });
        const binding = {
          appId: identity.appId,
          revisionId: identity.revisionId,
          scheduleId,
          definitionId: createScheduleDefinitionId({
            appId: identity.appId,
            revisionId: identity.revisionId,
            scheduleId,
            planId: workflow.planId,
            definition: scheduleDefinition,
          }),
          workflowId,
          planId: workflow.planId,
          scheduleDefinition,
          workflowPlanPayload: workflow.planPayload,
        };
        return deepFreeze(binding);
      }),
  );
}

export default {
  resolveManifestScheduleBindings,
};
