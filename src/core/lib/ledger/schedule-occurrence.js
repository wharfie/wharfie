/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { assertApplicationRevisionId } from '../../runtime/application-revision.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  SCHEDULE_DEFINITIONS_MAX_BYTES,
  SCHEDULE_MAX_UTC_TIMESTAMP_MS,
  SCHEDULE_MINUTE_MS,
  validateScheduleDefinition,
} from '../../runtime/schedule-definition.js';
import { assertWorkflowPlanId } from './workflow-execution-contract.js';

export const SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION = 1;
export const SCHEDULE_DEFINITION_ID_SCHEMA_VERSION = 1;
export const SCHEDULE_DEFINITION_ID_DOMAIN = 'wharfie:schedule-definition:v1';
export const SCHEDULE_OCCURRENCE_ID_DOMAIN = 'wharfie:schedule-occurrence:v1';
export const SCHEDULE_OCCURRENCE_ID_PREFIX = 'wso';
export const SCHEDULE_DEFINITION_ID_PREFIX = 'wsd';
export const SCHEDULE_OCCURRENCE_MAX_BYTES = 16 * 1024;

const SCHEDULE_CAUSE_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'scheduleId',
  'definitionId',
  'occurrenceId',
  'scheduledAt',
]);

/**
 * Require one plain object to contain exactly the named data fields.
 * @param {Record<string, any>} value - Candidate object.
 * @param {readonly string[]} keys - Exact fields.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertExactKeys(value, keys, label) {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.length !== allowed.size ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} must contain exactly ${keys.join(', ')}.`);
  }
}

/**
 * Require a nonnegative UTC Unix timestamp on an exact minute boundary.
 * @param {unknown} value - Candidate timestamp.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {number} - Exact timestamp.
 */
export function assertScheduleMinute(
  value,
  label = 'schedule occurrence scheduledAt',
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > SCHEDULE_MAX_UTC_TIMESTAMP_MS ||
    Number(value) % SCHEDULE_MINUTE_MS !== 0
  ) {
    throw new TypeError(
      `${label} must be a nonnegative safe UTC Unix timestamp on an exact minute boundary.`,
    );
  }
  return Number(value);
}

/**
 * Assert one typed schedule-definition content identity.
 * @param {unknown} value - Candidate definition ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertScheduleDefinitionId(
  value,
  label = 'schedule definitionId',
) {
  assertDomainSeparatedSha256Id(value, SCHEDULE_DEFINITION_ID_PREFIX, label);
}

/**
 * Assert one typed logical schedule-occurrence identity.
 * @param {unknown} value - Candidate occurrence ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertScheduleOccurrenceId(
  value,
  label = 'schedule occurrenceId',
) {
  assertDomainSeparatedSha256Id(value, SCHEDULE_OCCURRENCE_ID_PREFIX, label);
}

/**
 * Derive the revision-bound identity of one exact schedule and its sealed
 * workflow plan. This identity is causal provenance, not logical occurrence
 * identity; changing revision, plan, cron, policy, or static input changes it.
 * @param {{appId: string, revisionId: string, scheduleId: string, planId: string, definition: unknown}} value - Definition identity inputs.
 * @returns {string} - Stable definition ID.
 */
export function createScheduleDefinitionId(value) {
  const input = cloneBoundedJsonObject(
    value,
    SCHEDULE_DEFINITIONS_MAX_BYTES,
    'schedule definition identity',
  );
  assertExactKeys(
    input,
    ['appId', 'revisionId', 'scheduleId', 'planId', 'definition'],
    'schedule definition identity',
  );
  assertLogicalId(input.appId, 'schedule definition identity.appId');
  assertApplicationRevisionId(
    input.revisionId,
    'schedule definition identity.revisionId',
  );
  assertLogicalId(input.scheduleId, 'schedule definition identity.scheduleId');
  assertWorkflowPlanId(input.planId, 'schedule definition identity.planId');
  const definition = validateScheduleDefinition(
    input.definition,
    'schedule definition identity.definition',
  );
  return createCanonicalJsonSha256Id({
    domain: SCHEDULE_DEFINITION_ID_DOMAIN,
    prefix: SCHEDULE_DEFINITION_ID_PREFIX,
    value: {
      schemaVersion: SCHEDULE_DEFINITION_ID_SCHEMA_VERSION,
      appId: input.appId,
      revisionId: input.revisionId,
      scheduleId: input.scheduleId,
      planId: input.planId,
      definition,
    },
    valuePath: 'schedule definition identity',
  });
}

/**
 * Derive one logical scheduled minute independently of revision, observation
 * time, retry count, or coordinator generation. A revision update racing the
 * same named minute must conflict or replay; it cannot mint a second logical
 * occurrence merely by changing artifact identity.
 * @param {{appId: string, scheduleId: string, scheduledAt: number}} value - Occurrence identity inputs.
 * @returns {string} - Stable occurrence ID.
 */
export function createScheduleOccurrenceId(value) {
  const input = cloneBoundedJsonObject(
    value,
    SCHEDULE_OCCURRENCE_MAX_BYTES,
    'schedule occurrence identity',
  );
  assertExactKeys(
    input,
    ['appId', 'scheduleId', 'scheduledAt'],
    'schedule occurrence identity',
  );
  assertLogicalId(input.appId, 'schedule occurrence identity.appId');
  assertLogicalId(input.scheduleId, 'schedule occurrence identity.scheduleId');
  const scheduledAt = assertScheduleMinute(
    input.scheduledAt,
    'schedule occurrence identity.scheduledAt',
  );
  return createCanonicalJsonSha256Id({
    domain: SCHEDULE_OCCURRENCE_ID_DOMAIN,
    prefix: SCHEDULE_OCCURRENCE_ID_PREFIX,
    value: {
      appId: input.appId,
      scheduleId: input.scheduleId,
      scheduledAt,
    },
    valuePath: 'schedule occurrence identity',
  });
}

/**
 * Create the authoritative causal identity embedded in a scheduled workflow
 * run. The definition digest remains revision-bound while occurrence identity
 * deliberately stays app/schedule/minute-bound.
 * @param {{appId: string, scheduleId: string, definitionId: string, scheduledAt: number}} value - Cause inputs.
 * @returns {Readonly<{schemaVersion: 1, kind: 'schedule', scheduleId: string, definitionId: string, occurrenceId: string, scheduledAt: number}>} - Frozen schedule cause.
 */
export function createScheduleRunCause(value) {
  const input = cloneBoundedJsonObject(
    value,
    SCHEDULE_OCCURRENCE_MAX_BYTES,
    'schedule run cause input',
  );
  assertExactKeys(
    input,
    ['appId', 'scheduleId', 'definitionId', 'scheduledAt'],
    'schedule run cause input',
  );
  assertLogicalId(input.appId, 'schedule run cause input.appId');
  assertLogicalId(input.scheduleId, 'schedule run cause input.scheduleId');
  assertScheduleDefinitionId(
    input.definitionId,
    'schedule run cause input.definitionId',
  );
  const scheduledAt = assertScheduleMinute(
    input.scheduledAt,
    'schedule run cause input.scheduledAt',
  );
  return Object.freeze({
    schemaVersion: SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION,
    kind: /** @type {'schedule'} */ ('schedule'),
    scheduleId: input.scheduleId,
    definitionId: input.definitionId,
    occurrenceId: createScheduleOccurrenceId({
      appId: input.appId,
      scheduleId: input.scheduleId,
      scheduledAt,
    }),
    scheduledAt,
  });
}

/**
 * Validate one untrusted run cause against its enclosing application. The
 * occurrence digest is recomputed so a syntactically valid ID cannot be moved
 * between schedules or nominal minutes.
 * @param {unknown} value - Candidate cause.
 * @param {{appId: string, label?: string}} options - Enclosing run scope.
 * @returns {Readonly<{schemaVersion: 1, kind: 'schedule', scheduleId: string, definitionId: string, occurrenceId: string, scheduledAt: number}>} - Frozen normalized cause.
 */
export function normalizeScheduleRunCause(value, options) {
  const label = options?.label || 'schedule run cause';
  assertLogicalId(options?.appId, `${label} appId`);
  const cause = cloneBoundedJsonObject(
    value,
    SCHEDULE_OCCURRENCE_MAX_BYTES,
    label,
  );
  assertExactKeys(cause, SCHEDULE_CAUSE_KEYS, label);
  if (
    cause.schemaVersion !== SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION ||
    cause.kind !== 'schedule'
  ) {
    throw new TypeError(
      `${label} must be a schemaVersion ${SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION} schedule cause.`,
    );
  }
  assertLogicalId(cause.scheduleId, `${label}.scheduleId`);
  assertScheduleDefinitionId(cause.definitionId, `${label}.definitionId`);
  assertScheduleOccurrenceId(cause.occurrenceId, `${label}.occurrenceId`);
  const scheduledAt = assertScheduleMinute(
    cause.scheduledAt,
    `${label}.scheduledAt`,
  );
  const expected = createScheduleOccurrenceId({
    appId: options.appId,
    scheduleId: cause.scheduleId,
    scheduledAt,
  });
  if (cause.occurrenceId !== expected) {
    throw new TypeError(
      `${label}.occurrenceId does not bind its application, schedule, and scheduledAt.`,
    );
  }
  return Object.freeze({
    schemaVersion: SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION,
    kind: /** @type {'schedule'} */ ('schedule'),
    scheduleId: cause.scheduleId,
    definitionId: cause.definitionId,
    occurrenceId: cause.occurrenceId,
    scheduledAt,
  });
}

export default {
  SCHEDULE_DEFINITION_ID_DOMAIN,
  SCHEDULE_DEFINITION_ID_PREFIX,
  SCHEDULE_DEFINITION_ID_SCHEMA_VERSION,
  SCHEDULE_MINUTE_MS,
  SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION,
  SCHEDULE_OCCURRENCE_ID_DOMAIN,
  SCHEDULE_OCCURRENCE_ID_PREFIX,
  SCHEDULE_OCCURRENCE_MAX_BYTES,
  assertScheduleDefinitionId,
  assertScheduleMinute,
  assertScheduleOccurrenceId,
  createScheduleDefinitionId,
  createScheduleOccurrenceId,
  createScheduleRunCause,
  normalizeScheduleRunCause,
};
