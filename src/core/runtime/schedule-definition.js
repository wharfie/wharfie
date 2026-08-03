/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion and readonly signatures are not understood by the current JSDoc lint parser. */

import { compareCanonicalStrings } from './canonical-order.js';
import { cloneBoundedJsonObject, cloneBoundedJsonValue } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const SCHEDULE_DEFINITIONS_MAX_BYTES = 1024 * 1024;
export const SCHEDULE_MAX_DEFINITIONS = 128;
export const SCHEDULE_INPUT_MAX_BYTES = 256 * 1024;
export const SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES = 366 * 24 * 60;
export const SCHEDULE_MINUTE_MS = 60 * 1000;
export const SCHEDULE_MAX_UTC_TIMESTAMP_MS = 8_640_000_000_000_000;
const SCHEDULE_DEFINITION_KEYS = [
  'cron',
  'workflow',
  'input',
  'missed',
  'overlap',
];
const OCCURRENCE_SEARCH_OPTION_KEYS = [
  'afterExclusiveMs',
  'throughInclusiveMs',
  'minuteScanLimit',
];

/**
 * @typedef {'minute' | 'hour' | 'day-of-month' | 'month' | 'day-of-week'} UtcCronFieldName
 * @typedef {{name: UtcCronFieldName, minimum: number, maximum: number}} UtcCronFieldSpec
 * @typedef {{wildcard: boolean, values: Set<number>}} ParsedUtcCronField
 * @typedef {{minute: ParsedUtcCronField, hour: ParsedUtcCronField, dayOfMonth: ParsedUtcCronField, month: ParsedUtcCronField, dayOfWeek: ParsedUtcCronField}} ParsedUtcCronExpression
 * @typedef {{cron: string, workflow: string, input: any, missed: 'latest', overlap: 'allow'}} ScheduleDefinition
 * @typedef {{count: number, firstScheduledAtMs: number, lastScheduledAtMs: number}} SkippedScheduleOccurrences
 * @typedef {{occurrences: readonly number[], skipped: Readonly<SkippedScheduleOccurrences> | null, scannedMinuteCount: number}} DueScheduleOccurrenceResult
 */

/** @type {readonly UtcCronFieldSpec[]} */
const UTC_CRON_FIELDS = Object.freeze([
  Object.freeze({ name: 'minute', minimum: 0, maximum: 59 }),
  Object.freeze({ name: 'hour', minimum: 0, maximum: 23 }),
  Object.freeze({ name: 'day-of-month', minimum: 1, maximum: 31 }),
  Object.freeze({ name: 'month', minimum: 1, maximum: 12 }),
  Object.freeze({ name: 'day-of-week', minimum: 0, maximum: 6 }),
]);

const MAXIMUM_DAY_BY_MONTH = Object.freeze([
  0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
]);

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
 * Parse one field in Wharfie's deliberately small canonical UTC cron dialect.
 * A field is either "*" or an ascending comma-separated set of canonical
 * decimal integers. The wildcard is the only spelling of a complete domain.
 * @param {string} value - Exact field text.
 * @param {UtcCronFieldSpec} spec - Field bounds and label.
 * @param {string} valuePath - Human-readable expression path.
 * @returns {ParsedUtcCronField} - Parsed field.
 */
function parseUtcCronField(value, spec, valuePath) {
  if (value === '*') {
    return {
      wildcard: true,
      values: new Set(
        Array.from(
          { length: spec.maximum - spec.minimum + 1 },
          (_, index) => spec.minimum + index,
        ),
      ),
    };
  }

  if (!/^(?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*$/.test(value)) {
    throw new TypeError(
      `${valuePath} ${spec.name} must be '*' or a strictly ascending comma-separated set of canonical decimal integers.`,
    );
  }

  const values = value.split(',').map((item) => Number(item));
  let prior;
  for (const item of values) {
    if (item < spec.minimum || item > spec.maximum) {
      throw new TypeError(
        `${valuePath} ${spec.name} values must be between ${spec.minimum} and ${spec.maximum}.`,
      );
    }
    if (prior !== undefined && item <= prior) {
      throw new TypeError(
        `${valuePath} ${spec.name} values must be strictly ascending without duplicates.`,
      );
    }
    prior = item;
  }

  if (values.length === spec.maximum - spec.minimum + 1) {
    throw new TypeError(
      `${valuePath} ${spec.name} must use '*' instead of listing its complete domain.`,
    );
  }

  return { wildcard: false, values: new Set(values) };
}

/**
 * Parse and validate one canonical five-field UTC cron expression.
 *
 * Fields are minute, hour, day-of-month, month, and day-of-week. Sunday is 0;
 * 7 is never an alias. When day-of-month and day-of-week are both restricted,
 * either field may match, as in conventional cron. Otherwise the restricted
 * field controls.
 * @param {unknown} value - Candidate expression.
 * @param {string} valuePath - Human-readable expression path.
 * @returns {ParsedUtcCronExpression} - Parsed expression.
 */
function parseUtcCronExpression(value, valuePath) {
  if (typeof value !== 'string') {
    throw new TypeError(`${valuePath} must be a canonical UTC cron string.`);
  }
  const fields = value.split(' ');
  if (fields.length !== UTC_CRON_FIELDS.length) {
    throw new TypeError(
      `${valuePath} must contain exactly five fields separated by single ASCII spaces.`,
    );
  }

  const parsedFields = UTC_CRON_FIELDS.map((spec, index) =>
    parseUtcCronField(fields[index], spec, valuePath),
  );
  const parsed = /** @type {ParsedUtcCronExpression} */ ({
    minute: parsedFields[0],
    hour: parsedFields[1],
    dayOfMonth: parsedFields[2],
    month: parsedFields[3],
    dayOfWeek: parsedFields[4],
  });

  if (!parsed.dayOfMonth.wildcard) {
    for (const dayOfMonth of parsed.dayOfMonth.values) {
      const isReachable = [...parsed.month.values].some(
        (month) => dayOfMonth <= MAXIMUM_DAY_BY_MONTH[month],
      );
      if (!isReachable) {
        throw new TypeError(
          `${valuePath} day-of-month value ${dayOfMonth} can never occur in the selected months.`,
        );
      }
    }
  }

  return parsed;
}

/**
 * Validate one expression in Wharfie's canonical five-field UTC cron dialect.
 * @param {unknown} value - Candidate expression.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {string} - The unchanged canonical expression.
 */
export function validateUtcCronExpression(
  value,
  valuePath = 'UTC cron expression',
) {
  parseUtcCronExpression(value, valuePath);
  return /** @type {string} */ (value);
}

/**
 * Validate one static workflow schedule independently of an app manifest.
 * Workflow existence is deliberately checked only when schedules become part
 * of a versioned manifest boundary.
 * @param {unknown} value - Candidate schedule definition.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {ScheduleDefinition} - Independent normalized definition.
 */
export function validateScheduleDefinition(
  value,
  valuePath = 'schedule definition',
) {
  const definition = cloneBoundedJsonObject(
    value,
    SCHEDULE_DEFINITIONS_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(definition, SCHEDULE_DEFINITION_KEYS, valuePath);

  const cron = validateUtcCronExpression(definition.cron, `${valuePath}.cron`);
  assertLogicalId(definition.workflow, `${valuePath}.workflow`);
  if (definition.missed !== 'latest') {
    throw new TypeError(`${valuePath}.missed must be 'latest'.`);
  }
  if (definition.overlap !== 'allow') {
    throw new TypeError(`${valuePath}.overlap must be 'allow'.`);
  }

  return {
    cron,
    workflow: definition.workflow,
    input: cloneBoundedJsonValue(
      definition.input,
      SCHEDULE_INPUT_MAX_BYTES,
      `${valuePath}.input`,
    ),
    missed: 'latest',
    overlap: 'allow',
  };
}

/**
 * Validate a nonempty logical-ID keyed schedule map and return canonical key
 * order for the strict application manifest and resident runtime.
 * @param {unknown} value - Candidate schedule map.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {Record<string, ScheduleDefinition>} - Normalized schedule map.
 */
export function validateScheduleDefinitions(
  value,
  valuePath = 'schedule definitions',
) {
  const definitions = cloneBoundedJsonObject(
    value,
    SCHEDULE_DEFINITIONS_MAX_BYTES,
    valuePath,
  );
  const scheduleIds = Object.keys(definitions).sort(compareCanonicalStrings);
  if (scheduleIds.length === 0) {
    throw new TypeError(`${valuePath} must not be empty when provided.`);
  }
  if (scheduleIds.length > SCHEDULE_MAX_DEFINITIONS) {
    throw new TypeError(
      `${valuePath} must contain at most ${SCHEDULE_MAX_DEFINITIONS} schedules.`,
    );
  }

  /** @type {Record<string, ScheduleDefinition>} */
  const normalized = {};
  for (const scheduleId of scheduleIds) {
    assertLogicalId(scheduleId, `${valuePath}.${scheduleId}`);
    normalized[scheduleId] = validateScheduleDefinition(
      definitions[scheduleId],
      `${valuePath}.${scheduleId}`,
    );
  }
  return normalized;
}

/**
 * Require one injected epoch-millisecond timestamp that Date's UTC calendar
 * operations can represent. The evaluator never reads a wall clock.
 * @param {unknown} value - Candidate timestamp.
 * @param {string} valuePath - Human-readable option path.
 * @returns {asserts value is number}
 */
function assertUtcTimestamp(value, valuePath) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > SCHEDULE_MAX_UTC_TIMESTAMP_MS
  ) {
    throw new TypeError(
      `${valuePath} must be a nonnegative safe integer UTC millisecond timestamp.`,
    );
  }
}

/**
 * Return whether one exact UTC minute boundary matches a parsed expression.
 * @param {ParsedUtcCronExpression} cron - Parsed canonical expression.
 * @param {number} scheduledAtMs - Exact UTC minute boundary.
 * @returns {boolean} - Whether the minute is due.
 */
function matchesUtcCronMinute(cron, scheduledAtMs) {
  const date = new Date(scheduledAtMs);
  if (
    !cron.minute.values.has(date.getUTCMinutes()) ||
    !cron.hour.values.has(date.getUTCHours()) ||
    !cron.month.values.has(date.getUTCMonth() + 1)
  ) {
    return false;
  }

  const dayOfMonthMatches = cron.dayOfMonth.values.has(date.getUTCDate());
  const dayOfWeekMatches = cron.dayOfWeek.values.has(date.getUTCDay());
  if (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  if (!cron.dayOfMonth.wildcard) return dayOfMonthMatches;
  if (!cron.dayOfWeek.wildcard) return dayOfWeekMatches;
  return true;
}

/**
 * Find due UTC minute occurrences in one fully bounded recovery window.
 *
 * Occurrences must be exact UTC minute boundaries strictly after
 * afterExclusiveMs and at or before throughInclusiveMs. minuteScanLimit caps
 * candidate minute boundaries, not matches; the complete window is rejected
 * before iteration when it would exceed that caller-selected bound.
 *
 * The only current missed policy is "latest", so the result contains at most
 * the newest due occurrence. skipped describes only earlier due occurrences.
 * @param {unknown} definitionValue - Strict schedule definition.
 * @param {unknown} optionsValue - Injected boundaries and scan bound.
 * @returns {Readonly<DueScheduleOccurrenceResult>} - Bounded due result.
 */
export function findDueScheduleOccurrences(definitionValue, optionsValue) {
  const definition = validateScheduleDefinition(
    definitionValue,
    'schedule definition',
  );
  const options = cloneBoundedJsonObject(
    optionsValue,
    1024,
    'schedule occurrence options',
  );
  assertExactKeys(
    options,
    OCCURRENCE_SEARCH_OPTION_KEYS,
    'schedule occurrence options',
  );
  assertUtcTimestamp(
    options.afterExclusiveMs,
    'schedule occurrence options.afterExclusiveMs',
  );
  assertUtcTimestamp(
    options.throughInclusiveMs,
    'schedule occurrence options.throughInclusiveMs',
  );
  if (options.throughInclusiveMs < options.afterExclusiveMs) {
    throw new TypeError(
      'schedule occurrence options.throughInclusiveMs must be greater than or equal to afterExclusiveMs.',
    );
  }
  if (
    !Number.isSafeInteger(options.minuteScanLimit) ||
    options.minuteScanLimit < 1 ||
    options.minuteScanLimit > SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES
  ) {
    throw new TypeError(
      `schedule occurrence options.minuteScanLimit must be a positive safe integer no greater than ${SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES}.`,
    );
  }

  const firstCandidateMs =
    (Math.floor(options.afterExclusiveMs / SCHEDULE_MINUTE_MS) + 1) *
    SCHEDULE_MINUTE_MS;
  const scannedMinuteCount =
    firstCandidateMs > options.throughInclusiveMs
      ? 0
      : Math.floor(
          (options.throughInclusiveMs - firstCandidateMs) / SCHEDULE_MINUTE_MS,
        ) + 1;
  if (scannedMinuteCount > options.minuteScanLimit) {
    throw new RangeError(
      `schedule occurrence window contains ${scannedMinuteCount} UTC minute boundaries, exceeding minuteScanLimit ${options.minuteScanLimit}.`,
    );
  }

  const cron = parseUtcCronExpression(
    definition.cron,
    'schedule definition.cron',
  );
  let dueCount = 0;
  /** @type {number | undefined} */
  let firstDueMs;
  /** @type {number | undefined} */
  let lastSkippedMs;
  /** @type {number | undefined} */
  let latestDueMs;

  for (
    let index = 0, candidateMs = firstCandidateMs;
    index < scannedMinuteCount;
    index += 1, candidateMs += SCHEDULE_MINUTE_MS
  ) {
    if (!matchesUtcCronMinute(cron, candidateMs)) continue;
    dueCount += 1;
    firstDueMs ??= candidateMs;
    lastSkippedMs = latestDueMs;
    latestDueMs = candidateMs;
  }

  const occurrences = Object.freeze(
    latestDueMs === undefined ? [] : [latestDueMs],
  );
  const skipped =
    dueCount <= 1
      ? null
      : Object.freeze({
          count: dueCount - 1,
          firstScheduledAtMs: /** @type {number} */ (firstDueMs),
          lastScheduledAtMs: /** @type {number} */ (lastSkippedMs),
        });

  return Object.freeze({
    occurrences,
    skipped,
    scannedMinuteCount,
  });
}

export default {
  SCHEDULE_DEFINITIONS_MAX_BYTES,
  SCHEDULE_INPUT_MAX_BYTES,
  SCHEDULE_MAX_DEFINITIONS,
  SCHEDULE_MAX_UTC_TIMESTAMP_MS,
  SCHEDULE_MINUTE_MS,
  SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES,
  findDueScheduleOccurrences,
  validateScheduleDefinition,
  validateScheduleDefinitions,
  validateUtcCronExpression,
};
