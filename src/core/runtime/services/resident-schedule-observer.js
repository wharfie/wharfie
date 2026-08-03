/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Internal exact-schema helpers stay compact, and readonly signatures are not understood by the current JSDoc lint parser. */

import {
  LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
  LedgerServiceOwnerKind,
  assertLedgerServiceId,
  assertLedgerServiceSessionId,
  createLedgerServiceId,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import {
  LocalApplicationAdmissionClosedError,
  getLocalApplicationRunCreationFence,
  getLocalApplicationServiceStartFence,
} from '../../lib/db/tables/local-application-activation.js';
import { createScheduleControl } from '../../lib/db/tables/schedule-control.js';
import {
  createScheduleDefinitionId,
  createScheduleRunCause,
} from '../../lib/ledger/schedule-occurrence.js';
import {
  createWorkflowPlanId,
  createWorkflowRunId,
  normalizeWorkflowPlanPayload,
} from '../../lib/ledger/workflow-execution-contract.js';
import { resolveManifestActivityExecutionBinding } from '../app-runs.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { assertArtifactId } from '../artifact-record.js';
import { compareCanonicalStrings } from '../canonical-order.js';
import { assertLogicalId } from '../logical-id.js';
import { resolveManifestScheduleBindings } from '../manifest-schedule-binding.js';
import {
  SCHEDULE_MAX_DEFINITIONS,
  SCHEDULE_MAX_UTC_TIMESTAMP_MS,
  SCHEDULE_MINUTE_MS,
  SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES,
  findDueScheduleOccurrences,
  validateScheduleDefinition,
} from '../schedule-definition.js';

export const RESIDENT_SCHEDULE_DEFAULT_POLL_INTERVAL_MS = 1_000;
export const RESIDENT_SCHEDULE_MAX_POLL_INTERVAL_MS = 60_000;
export const RESIDENT_SCHEDULE_WORKFLOW_START_TRANSITION_ID = 'workflow-start';

const BINDING_KEYS = Object.freeze([
  'appId',
  'revisionId',
  'scheduleId',
  'definitionId',
  'workflowId',
  'planId',
  'scheduleDefinition',
  'workflowPlanPayload',
]);
const OWNERSHIP_KEYS = Object.freeze([
  'schemaVersion',
  'serviceId',
  'appId',
  'scopeId',
  'principalId',
  'sessionId',
  'ownerKind',
  'generation',
  'claimedAt',
  'updatedAt',
]);

export class ResidentScheduleOwnershipLostError extends Error {
  /** @param {{appId: string, serviceId: string}} details */
  constructor(details) {
    super(
      `Resident schedule ownership was lost for application ${details.appId}.`,
    );
    this.name = 'ResidentScheduleOwnershipLostError';
    this.code = 'resident-schedule-ownership-lost';
    this.details = Object.freeze({ ...details });
  }
}

/** @template T @param {T} value */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** @param {unknown} value @param {readonly string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = /** @type {Record<string, any>} */ (value);
  const allowed = new Set(keys);
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} must contain exactly ${keys.join(', ')}.`);
  }
  return record;
}

/** @param {unknown} value @param {string} label */
function normalizeTimestamp(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > SCHEDULE_MAX_UTC_TIMESTAMP_MS
  ) {
    throw new TypeError(
      `${label} must be a nonnegative safe UTC millisecond timestamp.`,
    );
  }
  return Number(value);
}

/** @param {unknown} value */
function normalizePollInterval(value) {
  if (value === undefined) return RESIDENT_SCHEDULE_DEFAULT_POLL_INTERVAL_MS;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > RESIDENT_SCHEDULE_MAX_POLL_INTERVAL_MS
  ) {
    throw new TypeError(
      `Resident schedule pollIntervalMs must be a positive safe integer no greater than ${RESIDENT_SCHEDULE_MAX_POLL_INTERVAL_MS}.`,
    );
  }
  return Number(value);
}

/** @param {unknown} value @param {boolean} [optional] */
function normalizeAbortSignal(value, optional = false) {
  if (value === undefined && optional) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
      'function' ||
    typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
      'function'
  ) {
    throw new TypeError(
      'Resident schedule observer signal must be an AbortSignal.',
    );
  }
  return /** @type {AbortSignal} */ (value);
}

/** @param {unknown} value @param {string} appId */
function normalizeOwnership(value, appId) {
  const ownership = assertExactKeys(
    value,
    OWNERSHIP_KEYS,
    'resident schedule ownership',
  );
  if (
    ownership.schemaVersion !== LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION ||
    ownership.ownerKind !== LedgerServiceOwnerKind.RESIDENT
  ) {
    throw new TypeError(
      'Resident schedule ownership must be an exact resident ownership snapshot.',
    );
  }
  assertLedgerServiceId(
    ownership.serviceId,
    'resident schedule ownership.serviceId',
  );
  assertLogicalId(ownership.appId, 'resident schedule ownership.appId');
  assertLogicalId(ownership.scopeId, 'resident schedule ownership.scopeId');
  assertLogicalId(
    ownership.principalId,
    'resident schedule ownership.principalId',
  );
  assertLedgerServiceSessionId(
    ownership.sessionId,
    'resident schedule ownership.sessionId',
  );
  if (!Number.isSafeInteger(ownership.generation) || ownership.generation < 1) {
    throw new TypeError(
      'resident schedule ownership.generation must be a positive safe integer.',
    );
  }
  const claimedAt = normalizeTimestamp(
    ownership.claimedAt,
    'resident schedule ownership.claimedAt',
  );
  const updatedAt = normalizeTimestamp(
    ownership.updatedAt,
    'resident schedule ownership.updatedAt',
  );
  if (
    ownership.appId !== appId ||
    ownership.serviceId !== createLedgerServiceId({ appId }) ||
    updatedAt < claimedAt
  ) {
    throw new TypeError(
      'Resident schedule ownership does not match its application or timestamps.',
    );
  }
  return Object.freeze({
    schemaVersion: LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
    serviceId: ownership.serviceId,
    appId,
    scopeId: ownership.scopeId,
    principalId: ownership.principalId,
    sessionId: ownership.sessionId,
    ownerKind: LedgerServiceOwnerKind.RESIDENT,
    generation: ownership.generation,
    claimedAt,
    updatedAt,
  });
}

/** @param {Readonly<Record<string, any>> | null} observed @param {Readonly<Record<string, any>>} expected */
function hasExactOwnership(observed, expected) {
  return Boolean(
    observed && OWNERSHIP_KEYS.every((key) => observed[key] === expected[key]),
  );
}

/** @param {unknown} value */
function normalizeScheduleBindings(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('Resident schedule bindings must be an array.');
  }
  if (value.length > SCHEDULE_MAX_DEFINITIONS) {
    throw new TypeError(
      `Resident schedule bindings must contain at most ${SCHEDULE_MAX_DEFINITIONS} schedules.`,
    );
  }
  /** @type {Readonly<Record<string, any>>[]} */
  const normalized = [];
  let priorScheduleId;
  let appId;
  let revisionId;
  for (let index = 0; index < value.length; index += 1) {
    const label = `resident schedule binding ${index}`;
    const binding = assertExactKeys(value[index], BINDING_KEYS, label);
    assertLogicalId(binding.appId, `${label}.appId`);
    assertApplicationRevisionId(binding.revisionId, `${label}.revisionId`);
    assertLogicalId(binding.scheduleId, `${label}.scheduleId`);
    assertLogicalId(binding.workflowId, `${label}.workflowId`);
    const scheduleDefinition = validateScheduleDefinition(
      binding.scheduleDefinition,
      `${label}.scheduleDefinition`,
    );
    const workflowPlanPayload = normalizeWorkflowPlanPayload(
      binding.workflowPlanPayload,
      `${label}.workflowPlanPayload`,
    );
    const planId = createWorkflowPlanId(workflowPlanPayload);
    const definitionId = createScheduleDefinitionId({
      appId: binding.appId,
      revisionId: binding.revisionId,
      scheduleId: binding.scheduleId,
      planId,
      definition: scheduleDefinition,
    });
    if (
      binding.planId !== planId ||
      binding.definitionId !== definitionId ||
      workflowPlanPayload.appId !== binding.appId ||
      workflowPlanPayload.revisionId !== binding.revisionId ||
      workflowPlanPayload.workflowId !== binding.workflowId
    ) {
      throw new TypeError(`${label} does not match its sealed identities.`);
    }
    if (
      priorScheduleId !== undefined &&
      compareCanonicalStrings(priorScheduleId, binding.scheduleId) >= 0
    ) {
      throw new TypeError(
        'Resident schedule bindings must use unique canonical schedule-ID order.',
      );
    }
    if (
      (appId !== undefined && binding.appId !== appId) ||
      (revisionId !== undefined && binding.revisionId !== revisionId)
    ) {
      throw new TypeError(
        'Resident schedule bindings must belong to one exact application revision.',
      );
    }
    priorScheduleId = binding.scheduleId;
    appId = binding.appId;
    revisionId = binding.revisionId;
    normalized.push(
      deepFreeze({
        appId: binding.appId,
        revisionId: binding.revisionId,
        scheduleId: binding.scheduleId,
        definitionId,
        workflowId: binding.workflowId,
        planId,
        scheduleDefinition,
        workflowPlanPayload,
      }),
    );
  }
  return Object.freeze(normalized);
}

/**
 * Build one stateful observer over schedules derived from an exact sealed
 * source or packaged execution.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: import('../durable-activity-host.js').ManifestActivityExecution, artifactId?: string, controlContext: {db: import('../../lib/db/base.js').DBClient, tableName: string}, ownership: Readonly<Record<string, any>>, signal?: AbortSignal, onWorkflowReady?: () => void | Promise<void>}} options
 */
export function createResidentScheduleObserver(options) {
  if (
    !options?.ledger ||
    typeof options.ledger.createWorkflowRun !== 'function'
  ) {
    throw new TypeError(
      'createResidentScheduleObserver requires a workflow execution ledger.',
    );
  }
  if (
    !options.controlContext?.db ||
    typeof options.controlContext.tableName !== 'string' ||
    !options.controlContext.tableName.trim()
  ) {
    throw new TypeError(
      'createResidentScheduleObserver requires an open control store.',
    );
  }
  if (
    options.onWorkflowReady !== undefined &&
    typeof options.onWorkflowReady !== 'function'
  ) {
    throw new TypeError(
      'createResidentScheduleObserver onWorkflowReady must be a function.',
    );
  }
  const signal = normalizeAbortSignal(options.signal, true);
  const executionBinding = resolveManifestActivityExecutionBinding(
    options.execution,
  );
  if (options.artifactId !== undefined) {
    assertArtifactId(
      options.artifactId,
      'resident schedule observer artifactId',
    );
  }
  const artifactId = options.artifactId;
  const scheduleBindings = normalizeScheduleBindings(
    resolveManifestScheduleBindings(executionBinding.execution),
  );
  const ownership = normalizeOwnership(
    options.ownership,
    executionBinding.identity.appId,
  );
  const tableName = options.controlContext.tableName.trim();
  const scheduleControl = createScheduleControl({
    db: options.controlContext.db,
    tableName,
  });
  const ownershipStore = createLedgerServiceOwnership({
    db: options.controlContext.db,
    tableName,
  });
  /** @type {Map<string, Readonly<Record<string, any>>>} */
  const cursorByScheduleId = new Map();
  let initialized = false;
  let observationInFlight = false;

  /** Verify the retained source snapshot before schedule authority advances. */
  async function verifyExecutionRuntime() {
    if (executionBinding.execution.kind === 'prepared-source') {
      await executionBinding.execution.prepared.verifyRuntime();
    }
  }

  /** @returns {Promise<boolean>} Whether observation may continue. */
  async function probeAuthority() {
    if (signal?.aborted) return false;
    const observed = await ownershipStore.getOwnership({
      serviceId: ownership.serviceId,
    });
    if (!hasExactOwnership(observed, ownership)) {
      throw new ResidentScheduleOwnershipLostError({
        appId: ownership.appId,
        serviceId: ownership.serviceId,
      });
    }
    if (signal?.aborted) return false;
    try {
      await getLocalApplicationRunCreationFence({
        db: options.controlContext.db,
        tableName,
        appId: executionBinding.identity.appId,
        revisionId: executionBinding.identity.revisionId,
      });
    } catch (error) {
      if (
        !initialized &&
        error instanceof LocalApplicationAdmissionClosedError &&
        artifactId !== undefined
      ) {
        await getLocalApplicationServiceStartFence({
          db: options.controlContext.db,
          tableName,
          appId: executionBinding.identity.appId,
          revisionId: executionBinding.identity.revisionId,
          artifactId,
        });
        await verifyExecutionRuntime();
        return false;
      }
      throw error;
    }
    return !signal?.aborted;
  }

  /** @param {number} observedAt */
  async function activate(observedAt) {
    for (const binding of scheduleBindings) {
      if (signal?.aborted) return false;
      // Canonical and bounded by the strict manifest schedule count.
      // eslint-disable-next-line no-await-in-loop
      const result = await scheduleControl.activate({
        appId: binding.appId,
        scheduleId: binding.scheduleId,
        revisionId: binding.revisionId,
        definitionId: binding.definitionId,
        owner: ownership,
        observedAt,
      });
      cacheCursor(binding, result.cursor);
    }
    initialized = true;
    return true;
  }

  /**
   * Retain a cursor only while it still represents this observer's exact
   * immutable manifest binding.
   * @param {Readonly<Record<string, any>>} binding
   * @param {Readonly<Record<string, any>>} cursor
   */
  function cacheCursor(binding, cursor) {
    if (
      cursor.appId !== binding.appId ||
      cursor.scheduleId !== binding.scheduleId ||
      cursor.revisionId !== binding.revisionId ||
      cursor.definitionId !== binding.definitionId
    ) {
      throw new Error(
        `Resident schedule cursor does not match its exact binding: ${binding.scheduleId}`,
      );
    }
    cursorByScheduleId.set(binding.scheduleId, cursor);
    return cursor;
  }

  /** @param {Readonly<Record<string, any>>} binding */
  function requireCursor(binding) {
    const cursor = cursorByScheduleId.get(binding.scheduleId);
    if (!cursor) {
      throw new Error(
        `Resident schedule cursor is missing: ${binding.scheduleId}`,
      );
    }
    return cacheCursor(binding, cursor);
  }

  /**
   * Observe one injected wall-clock horizon for every exact schedule.
   * @param {{observedAt: number}} input
   */
  async function observeOnce(input) {
    const observation = assertExactKeys(
      input,
      ['observedAt'],
      'resident schedule observation',
    );
    const observedAt = normalizeTimestamp(
      observation.observedAt,
      'resident schedule observation.observedAt',
    );
    const throughInclusive =
      Math.floor(observedAt / SCHEDULE_MINUTE_MS) * SCHEDULE_MINUTE_MS;
    let admitted = 0;
    let replayed = 0;
    let advanced = 0;
    if (!(await probeAuthority())) {
      return Object.freeze({
        observedAt,
        throughInclusive,
        scheduleCount: scheduleBindings.length,
        admitted,
        replayed,
        advanced,
      });
    }
    if (!initialized) {
      await verifyExecutionRuntime();
      if (signal?.aborted || !(await activate(observedAt))) {
        return Object.freeze({
          observedAt,
          throughInclusive,
          scheduleCount: scheduleBindings.length,
          admitted,
          replayed,
          advanced,
        });
      }
    } else if (
      scheduleBindings.some(
        (binding) => throughInclusive > requireCursor(binding).horizon,
      )
    ) {
      await verifyExecutionRuntime();
      if (signal?.aborted) {
        return Object.freeze({
          observedAt,
          throughInclusive,
          scheduleCount: scheduleBindings.length,
          admitted,
          replayed,
          advanced,
        });
      }
    }
    for (const binding of scheduleBindings) {
      if (signal?.aborted) break;
      const cursor = requireCursor(binding);
      if (throughInclusive <= cursor.horizon) continue;
      const due = findDueScheduleOccurrences(binding.scheduleDefinition, {
        afterExclusiveMs: cursor.horizon,
        throughInclusiveMs: throughInclusive,
        minuteScanLimit: SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES,
      });
      if (due.occurrences.length === 0) {
        // Each schedule is independently authoritative.
        // eslint-disable-next-line no-await-in-loop
        const result = await scheduleControl.advance({
          expectedCursor: cursor,
          throughInclusive,
          owner: ownership,
          observedAt,
        });
        cacheCursor(binding, result.cursor);
        if (result.applied) advanced += 1;
        continue;
      }
      const scheduledAt = due.occurrences[0];
      const cause = createScheduleRunCause({
        appId: binding.appId,
        scheduleId: binding.scheduleId,
        definitionId: binding.definitionId,
        scheduledAt,
      });
      const runId = createWorkflowRunId({
        appId: binding.appId,
        idempotencyKey: cause.occurrenceId,
      });
      // eslint-disable-next-line no-await-in-loop
      const scheduleAdmission = await scheduleControl.prepareWorkflowAdmission({
        expectedCursor: cursor,
        scheduledAt,
        throughInclusive,
        skipped: due.skipped,
        workflowId: binding.workflowId,
        planId: binding.planId,
        runId,
        cause,
        owner: ownership,
        observedAt,
      });
      if (signal?.aborted) break;
      // eslint-disable-next-line no-await-in-loop
      const outcome = await options.ledger.createWorkflowRun({
        runId,
        appId: binding.appId,
        revisionId: binding.revisionId,
        workflowId: binding.workflowId,
        definition: binding.workflowPlanPayload.definition,
        input: binding.scheduleDefinition.input,
        callerMetadata: {},
        cause,
        scheduleAdmission,
        transitionId: RESIDENT_SCHEDULE_WORKFLOW_START_TRANSITION_ID,
        actor: {
          kind: 'resident-schedule',
          id: binding.appId,
        },
        observedAt,
      });
      // The exact atomic write or replay now owns the durable cursor value.
      // Reread rather than manufacturing a public cursor transition.
      // eslint-disable-next-line no-await-in-loop
      const nextCursor = await scheduleControl.getCursor({
        appId: binding.appId,
        scheduleId: binding.scheduleId,
      });
      if (!nextCursor) {
        throw new Error(
          `Resident schedule cursor disappeared: ${binding.scheduleId}`,
        );
      }
      cacheCursor(binding, nextCursor);
      if (outcome.applied) admitted += 1;
      else replayed += 1;
      // Wake-up is only a local optimization. The ready-work row committed in
      // the same transaction remains authoritative if this callback is lost.
      if (!signal?.aborted) {
        // eslint-disable-next-line no-await-in-loop
        await options.onWorkflowReady?.();
      }
    }
    return Object.freeze({
      observedAt,
      throughInclusive,
      scheduleCount: scheduleBindings.length,
      admitted,
      replayed,
      advanced,
    });
  }

  /** @param {{observedAt: number}} input */
  async function observe(input) {
    if (observationInFlight) {
      throw new Error(
        'Resident schedule observer does not permit concurrent observations.',
      );
    }
    observationInFlight = true;
    try {
      return await observeOnce(input);
    } finally {
      observationInFlight = false;
    }
  }

  return Object.freeze({
    scheduleCount: scheduleBindings.length,
    observe,
  });
}

/** @param {AbortSignal} signal @param {number} pollIntervalMs */
async function waitForPoll(signal, pollIntervalMs) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    const timer = setTimeout(finish, pollIntervalMs);
    /** Finish the wait after its timer or cancellation wins. */
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve(undefined);
    }
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/**
 * Observe schedules independently from serial physical activity execution.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: import('../durable-activity-host.js').ManifestActivityExecution, artifactId?: string, controlContext: {db: import('../../lib/db/base.js').DBClient, tableName: string}, ownership: Readonly<Record<string, any>>, signal: AbortSignal, pollIntervalMs?: number, now?: () => number, wait?: (signal: AbortSignal, pollIntervalMs: number) => void | Promise<void>, onWorkflowReady?: () => void | Promise<void>, onReady?: () => void | Promise<void>}} options
 */
export async function runResidentScheduleObserver(options) {
  const signal = /** @type {AbortSignal} */ (
    normalizeAbortSignal(options?.signal)
  );
  const pollIntervalMs = normalizePollInterval(options?.pollIntervalMs);
  const now = options?.now ?? (() => Date.now());
  const wait = options?.wait ?? waitForPoll;
  if (typeof now !== 'function') {
    throw new TypeError('Resident schedule observer now must be a function.');
  }
  if (typeof wait !== 'function') {
    throw new TypeError('Resident schedule observer wait must be a function.');
  }
  if (options?.onReady !== undefined && typeof options.onReady !== 'function') {
    throw new TypeError(
      'Resident schedule observer onReady must be a function.',
    );
  }
  const observer = createResidentScheduleObserver(options);
  let observations = 0;
  let admitted = 0;
  let replayed = 0;
  let advanced = 0;
  let ready = false;
  while (!signal.aborted) {
    // The clock is injected and validated at the exact observation boundary.
    // eslint-disable-next-line no-await-in-loop
    const result = await observer.observe({ observedAt: now() });
    observations += 1;
    admitted += result.admitted;
    replayed += result.replayed;
    advanced += result.advanced;
    if (!ready && !signal.aborted) {
      // Readiness means ownership was verified and the first reconciliation
      // either completed or was safely deferred behind managed activation.
      // eslint-disable-next-line no-await-in-loop
      await options.onReady?.();
      ready = true;
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(signal, pollIntervalMs);
  }
  return Object.freeze({
    observations,
    admitted,
    replayed,
    advanced,
  });
}

export default runResidentScheduleObserver;
