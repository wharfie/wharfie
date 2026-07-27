import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import path from 'node:path';

const PROOF_SCHEMA_VERSION = 1;
const PROOF_KIND = 'wharfie.package-sea.schedule-restart-proof';
const MAX_OBSERVATION_BYTES = 1024 * 1024;
const MAX_SCHEDULE_TIMESTAMP_MS = 8_640_000_000_000_000;
const LOGICAL_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA256_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OPTION_KEYS = ['ports'];
const INPUT_KEYS = [
  'appId',
  'revisionId',
  'scheduleId',
  'definitionId',
  'workflowId',
  'planId',
  'scheduledAt',
  'workRoot',
];
const PORT_KEYS = [
  'startResident',
  'waitReady',
  'waitForCompletion',
  'signalResident',
  'pollAfterRestart',
  'cleanup',
  'workRootAbsent',
];
const SNAPSHOT_KEYS = [
  'cursor',
  'occurrence',
  'run',
  'rawRows',
  'runDirectory',
  'readyWork',
  'marker',
  'dispatchCount',
];
const MARKER_KEYS = ['bytesBase64', 'record'];

/**
 * Recursively sort JSON object keys while retaining array order.
 * @param {any} value - Validated JSON value.
 * @returns {any} - Canonically ordered value.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

/**
 * Compare JSON values without treating object insertion order as semantic.
 * @param {unknown} left - Left JSON value.
 * @param {unknown} right - Right JSON value.
 * @returns {boolean} - Whether canonical JSON bytes match.
 */
function hasSameCanonicalJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/**
 * Create the same domain-separated canonical JSON identity used by Wharfie's
 * runtime. Tests cross-check these standalone bytes against the authoritative
 * runtime implementation.
 * @param {string} domain - Identity domain.
 * @param {string} prefix - Textual ID prefix.
 * @param {unknown} value - JSON identity payload.
 * @returns {string} - Typed base64url SHA-256 ID.
 */
function canonicalId(domain, prefix, value) {
  const digest = createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('base64url');
  return `${prefix}_${digest}`;
}

/**
 * Clone a bounded plain JSON object.
 * @param {unknown} value - Candidate value.
 * @param {number} maximumBytes - Encoded byte bound.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Independent JSON object.
 */
function cloneBoundedJsonObject(value, maximumBytes, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable.`);
  }
  if (
    encoded === undefined ||
    Buffer.byteLength(encoded, 'utf8') > maximumBytes
  ) {
    throw new TypeError(
      `${label} must be JSON and no larger than ${maximumBytes} bytes.`,
    );
  }
  return exactObject(JSON.parse(encoded), label);
}

/**
 * @param {unknown} value - Candidate logical ID.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function assertLogicalId(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 63 ||
    !LOGICAL_ID_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a canonical logical ID.`);
  }
}

/**
 * @param {unknown} value - Candidate typed ID.
 * @param {string} prefix - Expected prefix.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function assertTypedSha256Id(value, prefix, label) {
  const digest =
    typeof value === 'string' && value.startsWith(`${prefix}_`)
      ? value.slice(prefix.length + 1)
      : '';
  if (
    !SHA256_ID_PATTERN.test(digest) ||
    Buffer.from(digest, 'base64url').toString('base64url') !== digest
  ) {
    throw new TypeError(`${label} must be a canonical ${prefix} identity.`);
  }
}

/**
 * @param {unknown} value - Candidate integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Positive safe integer.
 */
function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate minute.
 * @param {string} label - Boundary label.
 * @returns {number} - Exact UTC minute.
 */
function assertScheduleMinute(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > MAX_SCHEDULE_TIMESTAMP_MS ||
    Number(value) % 60_000 !== 0
  ) {
    throw new TypeError(
      `${label} must be a nonnegative safe UTC minute timestamp.`,
    );
  }
  return Number(value);
}

/**
 * @param {{appId: string, scheduleId: string, definitionId: string, scheduledAt: number}} value - Cause identity.
 * @returns {Readonly<Record<string, any>>} - Exact schedule cause.
 */
function createScheduleRunCause(value) {
  const occurrenceId = canonicalId('wharfie:schedule-occurrence:v1', 'wso', {
    appId: value.appId,
    scheduleId: value.scheduleId,
    scheduledAt: value.scheduledAt,
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: 'schedule',
    scheduleId: value.scheduleId,
    definitionId: value.definitionId,
    occurrenceId,
    scheduledAt: value.scheduledAt,
  });
}

/**
 * @param {{appId: string, idempotencyKey: string}} value - Run identity.
 * @returns {string} - Workflow run ID.
 */
function createWorkflowRunId(value) {
  return canonicalId('wharfie:workflow-run:v1', 'wfr', value);
}

/**
 * @param {unknown} value - Candidate object.
 * @param {string} label - Human-readable boundary label.
 * @returns {Record<string, any>} - Plain object.
 */
function exactObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} expectedKeys - Exact allowed keys.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertExactKeys(value, expectedKeys, label) {
  const keys = Object.keys(value);
  const expected = new Set(expectedKeys);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError(
      `${label} must contain exactly ${expectedKeys.join(', ')}.`,
    );
  }
}

/**
 * @template T
 * @param {T} value - JSON-compatible value.
 * @returns {Readonly<T>} - Recursively frozen value.
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return /** @type {Readonly<T>} */ (value);
}

/**
 * @param {unknown} value - Candidate proof input.
 * @returns {Readonly<Record<string, any>>} - Validated proof identity.
 */
function validateInput(value) {
  const input = exactObject(value, 'package SEA schedule-restart proof input');
  assertExactKeys(
    input,
    INPUT_KEYS,
    'package SEA schedule-restart proof input',
  );
  assertLogicalId(input.appId, 'schedule-restart proof appId');
  assertTypedSha256Id(
    input.revisionId,
    'wrv1',
    'schedule-restart proof revisionId',
  );
  assertLogicalId(input.scheduleId, 'schedule-restart proof scheduleId');
  assertTypedSha256Id(
    input.definitionId,
    'wsd',
    'schedule-restart proof definitionId',
  );
  assertLogicalId(input.workflowId, 'schedule-restart proof workflowId');
  assertTypedSha256Id(input.planId, 'wfp', 'schedule-restart proof planId');
  const scheduledAt = assertScheduleMinute(
    input.scheduledAt,
    'schedule-restart proof scheduledAt',
  );
  if (
    typeof input.workRoot !== 'string' ||
    path.resolve(input.workRoot) !== input.workRoot ||
    input.workRoot === path.parse(input.workRoot).root
  ) {
    throw new TypeError(
      'schedule-restart proof workRoot must be a normalized absolute non-root path.',
    );
  }
  const cause = createScheduleRunCause({
    appId: input.appId,
    scheduleId: input.scheduleId,
    definitionId: input.definitionId,
    scheduledAt,
  });
  return deepFreeze({
    appId: input.appId,
    revisionId: input.revisionId,
    scheduleId: input.scheduleId,
    definitionId: input.definitionId,
    workflowId: input.workflowId,
    planId: input.planId,
    scheduledAt,
    occurrenceId: cause.occurrenceId,
    runId: createWorkflowRunId({
      appId: input.appId,
      idempotencyKey: cause.occurrenceId,
    }),
    cause,
    workRoot: input.workRoot,
  });
}

/**
 * @param {unknown} value - Candidate port collection.
 * @returns {Readonly<Record<string, Function>>} - Receiver-bound ports.
 */
function capturePorts(value) {
  const ports = exactObject(value, 'package SEA schedule-restart proof ports');
  assertExactKeys(ports, PORT_KEYS, 'package SEA schedule-restart proof ports');
  /** @type {Record<string, Function>} */
  const captured = {};
  for (const key of PORT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(ports, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `package SEA schedule-restart proof ports.${key} must be an own data function.`,
      );
    }
    captured[key] = descriptor.value.bind(ports);
  }
  return Object.freeze(captured);
}

/**
 * @param {unknown} value - Candidate resident process handle.
 * @param {string} label - Lifecycle phase label.
 * @returns {object | Function} - Opaque resident handle.
 */
function validateResidentHandle(value, label) {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    throw new TypeError(`${label} did not return a resident process handle.`);
  }
  return /** @type {object | Function} */ (value);
}

/**
 * @param {unknown} value - Candidate READY lifecycle snapshot.
 * @param {Readonly<Record<string, any>>} expected - Exact proof identity.
 * @param {string} label - Lifecycle phase label.
 * @returns {Readonly<Record<string, any>>} - Bounded READY snapshot.
 */
function validateReady(value, expected, label) {
  const ready = cloneBoundedJsonObject(
    value,
    MAX_OBSERVATION_BYTES,
    `${label} READY lifecycle`,
  );
  if (
    ready.status !== 'READY' ||
    ready.appId !== expected.appId ||
    ready.revisionId !== expected.revisionId ||
    typeof ready.sessionId !== 'string' ||
    !ready.sessionId
  ) {
    throw new Error(
      `${label} resident did not reach READY for the exact app revision.`,
    );
  }
  assertPositiveSafeInteger(
    ready.generation,
    `${label} READY lifecycle.generation`,
  );
  return deepFreeze(ready);
}

/**
 * @param {Record<string, any>} cursor - Durable schedule cursor.
 * @param {Readonly<Record<string, any>>} expected - Exact proof identity.
 * @returns {void}
 */
function assertExactCursor(cursor, expected) {
  if (
    cursor.appId !== expected.appId ||
    cursor.scheduleId !== expected.scheduleId ||
    cursor.revisionId !== expected.revisionId ||
    cursor.definitionId !== expected.definitionId ||
    cursor.activationBoundary >= expected.scheduledAt ||
    cursor.horizon !== expected.scheduledAt ||
    !Number.isSafeInteger(cursor.version) ||
    cursor.version < 2 ||
    !Number.isSafeInteger(cursor.updatedAt) ||
    cursor.updatedAt < cursor.horizon
  ) {
    throw new Error(
      'Completed schedule cursor does not match the exact due occurrence.',
    );
  }
}

/**
 * @param {Record<string, any>} occurrence - Durable occurrence projection.
 * @param {Readonly<Record<string, any>>} expected - Exact proof identity.
 * @param {Record<string, any>} cursor - Matching durable cursor.
 * @returns {void}
 */
function assertExactOccurrence(occurrence, expected, cursor) {
  if (
    occurrence.appId !== expected.appId ||
    occurrence.scheduleId !== expected.scheduleId ||
    occurrence.revisionId !== expected.revisionId ||
    occurrence.definitionId !== expected.definitionId ||
    occurrence.workflowId !== expected.workflowId ||
    occurrence.planId !== expected.planId ||
    occurrence.runId !== expected.runId ||
    occurrence.occurrenceId !== expected.occurrenceId ||
    occurrence.scheduledAt !== expected.scheduledAt ||
    occurrence.windowAfterExclusive >= expected.scheduledAt ||
    occurrence.throughInclusive !== cursor.horizon ||
    !hasSameCanonicalJson(occurrence.cause, expected.cause)
  ) {
    throw new Error(
      'Completed schedule occurrence does not match its exact causal identity.',
    );
  }
}

/**
 * @param {Record<string, any>} rebuilt - Durable rebuilt workflow run.
 * @param {Readonly<Record<string, any>>} expected - Exact proof identity.
 * @returns {void}
 */
function assertExactCompletedRun(rebuilt, expected) {
  const run = exactObject(
    rebuilt.run,
    'schedule-restart proof rebuilt run.run',
  );
  const trigger = exactObject(
    run.trigger,
    'schedule-restart proof rebuilt run trigger',
  );
  const cursor = exactObject(
    rebuilt.workflowCursor,
    'schedule-restart proof workflow cursor',
  );
  if (
    run.runId !== expected.runId ||
    run.appId !== expected.appId ||
    run.revisionId !== expected.revisionId ||
    run.status !== 'COMPLETED' ||
    trigger.kind !== 'workflow' ||
    trigger.workflowId !== expected.workflowId ||
    trigger.planId !== expected.planId ||
    !hasSameCanonicalJson(trigger.cause, expected.cause) ||
    cursor.runId !== expected.runId ||
    cursor.appId !== expected.appId ||
    cursor.revisionId !== expected.revisionId ||
    cursor.workflowId !== expected.workflowId ||
    cursor.planId !== expected.planId ||
    cursor.disposition !== 'COMPLETED'
  ) {
    throw new Error(
      'Scheduled workflow run is not the exact completed causal run.',
    );
  }
  if (!Array.isArray(rebuilt.events)) {
    throw new TypeError(
      'schedule-restart proof rebuilt run.events must be an array.',
    );
  }
  const creationCount = rebuilt.events.filter(
    (event) =>
      event &&
      typeof event === 'object' &&
      !Array.isArray(event) &&
      event.type === 'workflow-run-created',
  ).length;
  if (creationCount !== 1) {
    throw new Error(
      'Scheduled workflow run must retain exactly one workflow-run-created event.',
    );
  }
}

/**
 * Require the physical ledger rows, verified run directory, drained ready-work
 * projection, and exact marker bytes that make duplicate dispatch observable.
 * @param {Record<string, any>} snapshot - Completed proof snapshot.
 * @param {Readonly<Record<string, any>>} expected - Exact proof identity.
 * @returns {void}
 */
function assertExactDurableEvidence(snapshot, expected) {
  if (!Array.isArray(snapshot.rawRows) || snapshot.rawRows.length === 0) {
    throw new Error(
      'Schedule-restart proof requires nonempty physical ledger rows.',
    );
  }
  for (const [index, value] of snapshot.rawRows.entries()) {
    const row = exactObject(value, `schedule-restart proof rawRows[${index}]`);
    if (row.run_id !== expected.runId) {
      throw new Error(
        'Schedule-restart proof physical ledger row names another run.',
      );
    }
  }
  if (
    !Array.isArray(snapshot.runDirectory) ||
    snapshot.runDirectory.length !== 1
  ) {
    throw new Error(
      'Schedule-restart proof requires exactly one run-directory item.',
    );
  }
  const directory = exactObject(
    snapshot.runDirectory[0],
    'schedule-restart proof runDirectory[0]',
  );
  if (
    directory.runId !== expected.runId ||
    directory.appId !== expected.appId ||
    directory.revisionId !== expected.revisionId ||
    directory.kind !== 'workflow' ||
    directory.status !== 'COMPLETED'
  ) {
    throw new Error(
      'Schedule-restart proof run directory does not name the exact completed workflow.',
    );
  }
  if (!Array.isArray(snapshot.readyWork) || snapshot.readyWork.length !== 0) {
    throw new Error(
      'Completed schedule-restart proof must have no remaining ready work.',
    );
  }
  const marker = exactObject(
    snapshot.marker,
    'schedule-restart proof dispatch marker',
  );
  assertExactKeys(
    marker,
    MARKER_KEYS,
    'schedule-restart proof dispatch marker',
  );
  const markerRecord = exactObject(
    marker.record,
    'schedule-restart proof dispatch marker.record',
  );
  if (
    Object.keys(markerRecord).length === 0 ||
    typeof marker.bytesBase64 !== 'string'
  ) {
    throw new TypeError(
      'Schedule-restart proof dispatch marker must retain exact bytes and a nonempty record.',
    );
  }
  const markerBytes = Buffer.from(marker.bytesBase64, 'base64');
  if (
    markerBytes.length === 0 ||
    markerBytes.length > 64 * 1024 ||
    markerBytes.toString('base64') !== marker.bytesBase64 ||
    !markerBytes.equals(
      Buffer.from(`${JSON.stringify(markerRecord)}\n`, 'utf8'),
    )
  ) {
    throw new Error(
      'Schedule-restart proof dispatch marker bytes do not exactly encode its record.',
    );
  }
}

/**
 * @param {unknown} value - Candidate completed durable proof snapshot.
 * @param {Readonly<Record<string, any>>} expected - Exact proof identity.
 * @param {string} label - Observation label.
 * @returns {Readonly<Record<string, any>>} - Validated bounded snapshot.
 */
function validateCompletedSnapshot(value, expected, label) {
  const snapshot = cloneBoundedJsonObject(value, MAX_OBSERVATION_BYTES, label);
  assertExactKeys(snapshot, SNAPSHOT_KEYS, label);
  const cursor = exactObject(snapshot.cursor, `${label}.cursor`);
  const occurrence = exactObject(snapshot.occurrence, `${label}.occurrence`);
  const rebuilt = exactObject(snapshot.run, `${label}.run`);
  assertExactCursor(cursor, expected);
  assertExactOccurrence(occurrence, expected, cursor);
  assertExactCompletedRun(rebuilt, expected);
  assertExactDurableEvidence(snapshot, expected);
  if (snapshot.dispatchCount !== 1) {
    throw new Error(
      'Schedule-restart proof requires exactly one authored activity dispatch.',
    );
  }
  return deepFreeze(snapshot);
}

/**
 * @param {unknown} value - Candidate process exit.
 * @param {'SIGKILL'|'SIGTERM'} signal - Requested process signal.
 * @returns {Readonly<{code: number | null, signal: string | null}>} - Exact expected exit.
 */
function validateExit(value, signal) {
  const exit = cloneBoundedJsonObject(
    value,
    1024,
    `resident exit after ${signal}`,
  );
  assertExactKeys(exit, ['code', 'signal'], `resident exit after ${signal}`);
  const expected =
    signal === 'SIGKILL'
      ? { code: null, signal: 'SIGKILL' }
      : { code: 0, signal: null };
  if (!hasSameCanonicalJson(exit, expected)) {
    throw new Error(
      `Resident did not produce the exact expected exit after ${signal}.`,
    );
  }
  return /** @type {Readonly<{code: number | null, signal: string | null}>} */ (
    deepFreeze(exit)
  );
}

/**
 * Construct a hermetic orchestration proof around side-effect ports. The
 * production adapter may build and run a relocated SEA; tests can supply
 * in-memory ports without invoking native tooling.
 *
 * The first resident must complete one exact due occurrence before it is
 * killed. A replacement resident then reaches a new READY generation, performs
 * one observed schedule poll, and must expose byte-for-byte equivalent durable
 * JSON with the same single authored dispatch.
 * @param {unknown} optionsValue - Exact proof ports.
 * @returns {Readonly<{verify: (input: unknown) => Promise<Readonly<Record<string, any>>>}>} - Schedule-restart verifier.
 */
export function createPackageSeaScheduleRestartProof(optionsValue) {
  const options = exactObject(
    optionsValue,
    'package SEA schedule-restart proof options',
  );
  assertExactKeys(
    options,
    OPTION_KEYS,
    'package SEA schedule-restart proof options',
  );
  const ports = capturePorts(options.ports);

  return Object.freeze({
    async verify(inputValue) {
      const expected = validateInput(inputValue);
      /** @type {object | Function | undefined} */
      let initialResident;
      /** @type {object | Function | undefined} */
      let restartedResident;
      /** @type {unknown} */
      let primaryError;
      /** @type {Record<string, any> | undefined} */
      let result;

      try {
        initialResident = validateResidentHandle(
          await ports.startResident(
            Object.freeze({
              phase: 'initial',
              workRoot: expected.workRoot,
              expected,
            }),
          ),
          'initial schedule-restart proof',
        );
        const initialReady = validateReady(
          await ports.waitReady(
            Object.freeze({
              phase: 'initial',
              resident: initialResident,
              expected,
            }),
          ),
          expected,
          'Initial',
        );
        const completed = validateCompletedSnapshot(
          await ports.waitForCompletion(
            Object.freeze({
              resident: initialResident,
              ready: initialReady,
              expected,
            }),
          ),
          expected,
          'completed schedule-restart proof snapshot',
        );
        const killed = validateExit(
          await ports.signalResident(
            Object.freeze({
              phase: 'initial',
              resident: initialResident,
              signal: 'SIGKILL',
            }),
          ),
          'SIGKILL',
        );

        restartedResident = validateResidentHandle(
          await ports.startResident(
            Object.freeze({
              phase: 'restart',
              workRoot: expected.workRoot,
              expected,
            }),
          ),
          'restarted schedule-restart proof',
        );
        const restartedReady = validateReady(
          await ports.waitReady(
            Object.freeze({
              phase: 'restart',
              resident: restartedResident,
              expected,
            }),
          ),
          expected,
          'Restarted',
        );
        if (
          restartedReady.generation !== initialReady.generation + 1 ||
          restartedReady.sessionId === initialReady.sessionId
        ) {
          throw new Error(
            'Restarted resident READY did not establish one replacement generation and session.',
          );
        }
        const afterPoll = validateCompletedSnapshot(
          await ports.pollAfterRestart(
            Object.freeze({
              resident: restartedResident,
              ready: restartedReady,
              expected,
              completed,
            }),
          ),
          expected,
          'post-restart schedule poll snapshot',
        );
        if (!hasSameCanonicalJson(afterPoll, completed)) {
          throw new Error(
            'Durable schedule/workflow snapshot changed after the restarted resident poll.',
          );
        }
        const stopped = validateExit(
          await ports.signalResident(
            Object.freeze({
              phase: 'restart',
              resident: restartedResident,
              signal: 'SIGTERM',
            }),
          ),
          'SIGTERM',
        );
        result = {
          schemaVersion: PROOF_SCHEMA_VERSION,
          kind: PROOF_KIND,
          expected,
          initial: { ready: initialReady, exit: killed },
          restart: { ready: restartedReady, exit: stopped },
          durableSnapshot: completed,
        };
      } catch (error) {
        primaryError = error;
      }

      const residents = Object.freeze(
        [
          initialResident
            ? Object.freeze({
                phase: 'initial',
                resident: initialResident,
              })
            : null,
          restartedResident
            ? Object.freeze({
                phase: 'restart',
                resident: restartedResident,
              })
            : null,
        ].filter(Boolean),
      );
      /** @type {unknown[]} */
      const cleanupErrors = [];
      try {
        await ports.cleanup(
          Object.freeze({ workRoot: expected.workRoot, residents }),
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        if (
          (await ports.workRootAbsent(
            Object.freeze({ workRoot: expected.workRoot }),
          )) !== true
        ) {
          throw new Error(
            'Package SEA schedule-restart proof work root remains after cleanup.',
          );
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      if (primaryError && cleanupErrors.length === 0) throw primaryError;
      if (primaryError || cleanupErrors.length > 0) {
        throw new AggregateError(
          [...(primaryError ? [primaryError] : []), ...cleanupErrors],
          primaryError
            ? 'Package SEA schedule-restart proof failed and cleanup was incomplete.'
            : 'Package SEA schedule-restart proof cleanup was incomplete.',
        );
      }
      if (!result) {
        throw new Error(
          'Package SEA schedule-restart proof produced no result.',
        );
      }
      result.cleanup = { workRootRemoved: true };
      return deepFreeze(result);
    },
  });
}

export default createPackageSeaScheduleRestartProof;
