/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Internal exact-state helpers keep their types compact, and TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { assertApplicationRevisionId } from '../../../runtime/application-revision.js';
import { assertArtifactId } from '../../../runtime/artifact-record.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import { CONDITION_TYPE } from '../base.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';

export const LOCAL_APPLICATION_ACTIVATION_SCHEMA_VERSION = 1;
export const LOCAL_APPLICATION_ACTIVATION_RECORD_KIND =
  'local-application-activation';
export const LOCAL_APPLICATION_ACTIVATION_SORT_KEY =
  'local-application/v1/activation';
export const LOCAL_APPLICATION_ACTIVATION_PARTITION_DOMAIN =
  'wharfie:local-application-activation-partition:v1';
export const LOCAL_APPLICATION_ACTIVATION_PARTITION_PREFIX = 'wlap';
export const LOCAL_APPLICATION_ACTIVATION_TRANSITION_DOMAIN =
  'wharfie:local-application-activation-transition:v1';
export const LOCAL_APPLICATION_ACTIVATION_TRANSITION_PREFIX = 'wlat';
export const LOCAL_APPLICATION_ACTIVATION_MAX_RECORD_BYTES = 32 * 1024;

export const LocalApplicationActivationPhase = Object.freeze({
  ACTIVE: 'ACTIVE',
  QUIESCING: 'QUIESCING',
  QUIESCENT: 'QUIESCENT',
  SELECTED: 'SELECTED',
  ACTIVATING: 'ACTIVATING',
});

export const LocalApplicationActivationAction = Object.freeze({
  INSTALL: 'install',
  UPDATE: 'update',
  ROLLBACK: 'rollback',
});

export const LocalApplicationActivationDestination = Object.freeze({
  SOURCE: 'source',
  TARGET: 'target',
});

export const LocalApplicationActivationOutcome = Object.freeze({
  TARGET_ACTIVE: 'target-active',
  SOURCE_RETAINED: 'source-retained',
  SOURCE_RESTORED: 'source-restored',
});

const PHASES = new Set(Object.values(LocalApplicationActivationPhase));
const ACTIONS = new Set(Object.values(LocalApplicationActivationAction));
const OUTCOMES = new Set(Object.values(LocalApplicationActivationOutcome));
const STORAGE_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'record_version',
  'selection_generation',
  'phase',
  'selected_artifact_id',
  'selected_revision_id',
  'desired_artifact_id',
  'desired_revision_id',
  'rollback_artifact_id',
  'rollback_revision_id',
  'transition_id',
  'transition_action',
  'transition_source_record_version',
  'transition_source_selection_generation',
  'transition_source_artifact_id',
  'transition_source_revision_id',
  'transition_target_artifact_id',
  'transition_target_revision_id',
  'transition_started_at',
  'last_transition_id',
  'last_transition_outcome',
  'created_at',
  'updated_at',
]);

export class LocalApplicationActivationConflictError extends Error {
  /** @param {string} appId - Application identity. @param {string} reason - Safe conflict reason. */
  constructor(appId, reason) {
    super(
      `Local application activation changed concurrently: ${appId} (${reason})`,
    );
    this.name = 'LocalApplicationActivationConflictError';
    this.code = 'WHARFIE_LOCAL_APPLICATION_ACTIVATION_CONFLICT';
    this.appId = appId;
    this.reason = reason;
  }
}

export class LocalApplicationActivationNotFoundError extends Error {
  /** @param {string} appId - Application identity. */
  constructor(appId) {
    super(`Local application activation was not found: ${appId}`);
    this.name = 'LocalApplicationActivationNotFoundError';
    this.code = 'WHARFIE_LOCAL_APPLICATION_ACTIVATION_NOT_FOUND';
    this.appId = appId;
  }
}

export class LocalApplicationActivationRecordError extends Error {
  /** @param {string} appId - Application identity. @param {string} reason - Safe record failure. */
  constructor(appId, reason) {
    super(
      `Local application activation record is invalid: ${appId} (${reason})`,
    );
    this.name = 'LocalApplicationActivationRecordError';
    this.code = 'WHARFIE_LOCAL_APPLICATION_ACTIVATION_RECORD_INVALID';
    this.appId = appId;
    this.reason = reason;
  }
}

export class LocalApplicationAdmissionClosedError extends Error {
  /**
   * @param {{appId: string, revisionId: string, artifactId?: string, operation: 'run-creation'|'service-start', phase?: string, selectedRevisionId?: string}} input - Safe admission details.
   */
  constructor(input) {
    super(
      `Local application admission is closed for ${input.operation}: ${input.appId}`,
    );
    this.name = 'LocalApplicationAdmissionClosedError';
    this.code = 'WHARFIE_LOCAL_APPLICATION_ADMISSION_CLOSED';
    this.appId = input.appId;
    this.revisionId = input.revisionId;
    this.artifactId = input.artifactId;
    this.operation = input.operation;
    this.phase = input.phase;
    this.selectedRevisionId = input.selectedRevisionId;
  }
}

/** @param {string} propertyName - Field. @param {string|number|null} propertyValue - Value. @returns {import('../base.js').KeyCondition} - Equality condition. */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/** @param {string} propertyName - Field. @returns {import('../base.js').KeyCondition} - Nonexistence condition. */
function notExists(propertyName) {
  return { conditionType: CONDITION_TYPE.NOT_EXISTS, propertyName };
}

/** @param {unknown} error - Candidate failure. @returns {boolean} - Whether a portable condition failed. */
function isConditionalFailure(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/** @param {unknown} value - Candidate integer. @param {string} label - Boundary label. @returns {number} - Nonnegative integer. */
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value - Candidate integer. @param {string} label - Boundary label. @returns {number} - Positive integer. */
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {Record<string, any>} value - Object. @param {Set<string>} allowed - Keys. @param {string} label - Boundary label. @returns {void} */
function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`${label}.${key} is not supported.`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label}.${key} is required.`);
    }
  }
}

/** @param {unknown} value - Candidate input. @param {Set<string>} allowed - Exact keys. @param {string} label - Boundary label. @returns {Record<string, any>} - Cloned input. */
function normalizeInput(value, allowed, label) {
  const input = cloneBoundedJsonObject(
    value,
    LOCAL_APPLICATION_ACTIVATION_MAX_RECORD_BYTES,
    label,
  );
  for (const key of Object.keys(input)) {
    if (!allowed.has(key))
      throw new TypeError(`${label}.${key} is not supported.`);
  }
  return input;
}

/** @param {unknown} value - Candidate release. @param {string} label - Boundary label. @returns {Readonly<{artifactId: string, revisionId: string}>} - Exact release. */
function normalizeRelease(value, label) {
  const release = cloneBoundedJsonObject(value, 2048, label);
  assertExactKeys(release, new Set(['artifactId', 'revisionId']), label);
  assertArtifactId(release.artifactId, `${label}.artifactId`);
  assertApplicationRevisionId(release.revisionId, `${label}.revisionId`);
  return Object.freeze({
    artifactId: release.artifactId,
    revisionId: release.revisionId,
  });
}

/** @param {Readonly<{artifactId: string, revisionId: string}> | null} left - Release. @param {Readonly<{artifactId: string, revisionId: string}> | null} right - Release. @returns {boolean} - Exact equality. */
function sameRelease(left, right) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.artifactId === right.artifactId &&
      left.revisionId === right.revisionId)
  );
}

/** @param {Record<string, any>} record - Storage record. @param {string} prefix - Field prefix. @param {string} label - Boundary label. @param {boolean} nullable - Whether null is permitted. @returns {Readonly<{artifactId: string, revisionId: string}> | null} - Release reference. */
function readStoredRelease(record, prefix, label, nullable) {
  const artifactId = record[`${prefix}_artifact_id`];
  const revisionId = record[`${prefix}_revision_id`];
  if (artifactId === null || revisionId === null) {
    if (!nullable || artifactId !== null || revisionId !== null) {
      throw new TypeError(`${label} must be one paired release reference.`);
    }
    return null;
  }
  assertArtifactId(artifactId, `${label}.artifactId`);
  assertApplicationRevisionId(revisionId, `${label}.revisionId`);
  return Object.freeze({ artifactId, revisionId });
}

/** @param {unknown} value - Candidate action. @param {boolean} includeInstall - Whether install is legal. @returns {'install'|'update'|'rollback'} - Valid action. */
function normalizeAction(value, includeInstall) {
  const action = /** @type {'install'|'update'|'rollback'} */ (value);
  if (!ACTIONS.has(action) || (!includeInstall && action === 'install')) {
    throw new TypeError(
      includeInstall
        ? "activation action must be 'install', 'update', or 'rollback'."
        : "activation action must be 'update' or 'rollback'.",
    );
  }
  return action;
}

/** @param {unknown} value - Candidate transition ID. @param {string} [label] - Boundary label. @returns {asserts value is string} */
export function assertLocalApplicationActivationTransitionId(
  value,
  label = 'transitionId',
) {
  assertDomainSeparatedSha256Id(
    value,
    LOCAL_APPLICATION_ACTIVATION_TRANSITION_PREFIX,
    label,
  );
}

/**
 * @param {{appId: string, action: string, source: Readonly<{artifactId: string, revisionId: string}> | null, target: Readonly<{artifactId: string, revisionId: string}>, sourceRecordVersion: number, sourceSelectionGeneration: number}} input - Transition identity fields.
 * @returns {string} - Deterministic transition identity.
 */
export function createLocalApplicationActivationTransitionId(input) {
  assertLogicalId(input.appId, 'transition.appId');
  const action = normalizeAction(input.action, true);
  const source =
    input.source === null
      ? null
      : normalizeRelease(input.source, 'transition.source');
  const target = normalizeRelease(input.target, 'transition.target');
  const sourceRecordVersion = nonnegativeInteger(
    input.sourceRecordVersion,
    'transition.sourceRecordVersion',
  );
  const sourceSelectionGeneration = nonnegativeInteger(
    input.sourceSelectionGeneration,
    'transition.sourceSelectionGeneration',
  );
  if (action === LocalApplicationActivationAction.INSTALL) {
    if (source !== null) {
      throw new TypeError(
        'install transition identity requires a null source.',
      );
    }
  } else if (source === null || sameRelease(source, target)) {
    throw new TypeError(
      'update and rollback transition identities require distinct source and target releases.',
    );
  }
  return createCanonicalJsonSha256Id({
    domain: LOCAL_APPLICATION_ACTIVATION_TRANSITION_DOMAIN,
    prefix: LOCAL_APPLICATION_ACTIVATION_TRANSITION_PREFIX,
    value: {
      schemaVersion: LOCAL_APPLICATION_ACTIVATION_SCHEMA_VERSION,
      appId: input.appId,
      action,
      source,
      target,
      sourceRecordVersion,
      sourceSelectionGeneration,
    },
    valuePath: 'local application activation transition',
  });
}

/** @param {string} appId - Application identity. @returns {string} - Reserved shared-table partition. */
export function getLocalApplicationActivationPartitionKey(appId) {
  assertLogicalId(appId, 'appId');
  return createCanonicalJsonSha256Id({
    domain: LOCAL_APPLICATION_ACTIVATION_PARTITION_DOMAIN,
    prefix: LOCAL_APPLICATION_ACTIVATION_PARTITION_PREFIX,
    value: {
      schemaVersion: LOCAL_APPLICATION_ACTIVATION_SCHEMA_VERSION,
      appId,
    },
    valuePath: 'local application activation partition',
  });
}

/** @param {Record<string, any>} record - Storage record. @returns {Readonly<Record<string, any>>} - Frozen public snapshot. */
function toSnapshot(record) {
  const selected = readStoredRelease(record, 'selected', 'selected', true);
  const desired = readStoredRelease(record, 'desired', 'desired', false);
  const rollbackCandidate = readStoredRelease(
    record,
    'rollback',
    'rollbackCandidate',
    true,
  );
  const source = readStoredRelease(
    record,
    'transition_source',
    'transition.source',
    true,
  );
  const target = readStoredRelease(
    record,
    'transition_target',
    'transition.target',
    true,
  );
  const transition =
    record.transition_id === null
      ? null
      : Object.freeze({
          transitionId: record.transition_id,
          action: record.transition_action,
          sourceRecordVersion: record.transition_source_record_version,
          sourceSelectionGeneration:
            record.transition_source_selection_generation,
          source,
          target,
          startedAt: record.transition_started_at,
        });
  return Object.freeze({
    schemaVersion: record.schema_version,
    appId: record.app_id,
    recordVersion: record.record_version,
    selectionGeneration: record.selection_generation,
    phase: record.phase,
    selected,
    desired,
    rollbackCandidate,
    transition,
    lastTransition:
      record.last_transition_id === null
        ? null
        : Object.freeze({
            transitionId: record.last_transition_id,
            outcome: record.last_transition_outcome,
          }),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

/** @param {unknown} raw - Candidate storage record. @param {string} appId - Expected application. @returns {Record<string, any>} - Strict record. */
function normalizeStorageRecord(raw, appId) {
  let record;
  try {
    record = cloneBoundedJsonObject(
      raw,
      LOCAL_APPLICATION_ACTIVATION_MAX_RECORD_BYTES,
      'local application activation record',
    );
    assertExactKeys(
      record,
      STORAGE_RECORD_KEYS,
      'local application activation record',
    );
    if (record[KEY_NAME] !== getLocalApplicationActivationPartitionKey(appId)) {
      throw new TypeError('partition');
    }
    if (record[SORT_KEY_NAME] !== LOCAL_APPLICATION_ACTIVATION_SORT_KEY) {
      throw new TypeError('sort key');
    }
    if (record.schema_version !== LOCAL_APPLICATION_ACTIVATION_SCHEMA_VERSION) {
      throw new TypeError('schema version');
    }
    if (record.record_kind !== LOCAL_APPLICATION_ACTIVATION_RECORD_KIND) {
      throw new TypeError('record kind');
    }
    if (record.app_id !== appId) throw new TypeError('application');
    assertLogicalId(record.app_id, 'activation.appId');
    const recordVersion = positiveInteger(
      record.record_version,
      'activation.recordVersion',
    );
    const selectionGeneration = nonnegativeInteger(
      record.selection_generation,
      'activation.selectionGeneration',
    );
    if (!PHASES.has(record.phase)) throw new TypeError('phase');
    const selected = readStoredRelease(record, 'selected', 'selected', true);
    const desired = readStoredRelease(record, 'desired', 'desired', false);
    const rollbackCandidate = readStoredRelease(
      record,
      'rollback',
      'rollbackCandidate',
      true,
    );
    const source = readStoredRelease(
      record,
      'transition_source',
      'transition.source',
      true,
    );
    const target = readStoredRelease(
      record,
      'transition_target',
      'transition.target',
      true,
    );
    const createdAt = nonnegativeInteger(
      record.created_at,
      'activation.createdAt',
    );
    const updatedAt = nonnegativeInteger(
      record.updated_at,
      'activation.updatedAt',
    );
    if (updatedAt < createdAt) throw new TypeError('timestamps');

    if (record.last_transition_id === null) {
      if (record.last_transition_outcome !== null)
        throw new TypeError('last transition');
    } else {
      assertLocalApplicationActivationTransitionId(
        record.last_transition_id,
        'activation.lastTransitionId',
      );
      if (!OUTCOMES.has(record.last_transition_outcome)) {
        throw new TypeError('last transition outcome');
      }
    }

    if (record.phase === LocalApplicationActivationPhase.ACTIVE) {
      if (
        selected === null ||
        !sameRelease(selected, desired) ||
        selectionGeneration < 1 ||
        record.last_transition_id === null ||
        sameRelease(selected, rollbackCandidate) ||
        record.transition_id !== null ||
        record.transition_action !== null ||
        record.transition_source_record_version !== null ||
        record.transition_source_selection_generation !== null ||
        source !== null ||
        target !== null ||
        record.transition_started_at !== null
      ) {
        throw new TypeError('active invariants');
      }
    } else {
      assertLocalApplicationActivationTransitionId(
        record.transition_id,
        'activation.transitionId',
      );
      const action = normalizeAction(record.transition_action, true);
      const sourceRecordVersion = nonnegativeInteger(
        record.transition_source_record_version,
        'activation.transitionSourceRecordVersion',
      );
      const sourceSelectionGeneration = nonnegativeInteger(
        record.transition_source_selection_generation,
        'activation.transitionSourceSelectionGeneration',
      );
      if (target === null) throw new TypeError('transition target');
      const startedAt = nonnegativeInteger(
        record.transition_started_at,
        'activation.transitionStartedAt',
      );
      if (startedAt < createdAt || startedAt > updatedAt) {
        throw new TypeError('transition timestamps');
      }
      if (sourceRecordVersion >= recordVersion) {
        throw new TypeError('transition source record version');
      }
      if (
        record.last_transition_id !== null &&
        record.last_transition_id === record.transition_id
      ) {
        throw new TypeError('transition incarnation');
      }
      if (
        createLocalApplicationActivationTransitionId({
          appId,
          action,
          source,
          target,
          sourceRecordVersion,
          sourceSelectionGeneration,
        }) !== record.transition_id
      ) {
        throw new TypeError('transition identity');
      }
      if (action === LocalApplicationActivationAction.INSTALL) {
        if (
          source !== null ||
          rollbackCandidate !== null ||
          record.last_transition_id !== null ||
          !sameRelease(desired, target) ||
          sourceSelectionGeneration > selectionGeneration ||
          selectionGeneration - sourceSelectionGeneration > 1 ||
          (sourceRecordVersion === 0 && sourceSelectionGeneration !== 0)
        ) {
          throw new TypeError('install transition');
        }
      } else {
        if (
          source === null ||
          selected === null ||
          record.last_transition_id === null ||
          sourceRecordVersion < 1 ||
          sourceSelectionGeneration < 1 ||
          sourceSelectionGeneration > selectionGeneration ||
          selectionGeneration - sourceSelectionGeneration > 2 ||
          (!sameRelease(selected, source) && !sameRelease(selected, target)) ||
          (sameRelease(selected, source) &&
            selectionGeneration !== sourceSelectionGeneration &&
            selectionGeneration !== sourceSelectionGeneration + 2) ||
          (sameRelease(selected, target) &&
            selectionGeneration !== sourceSelectionGeneration + 1)
        ) {
          throw new TypeError('change transition');
        }
        if (
          action === LocalApplicationActivationAction.ROLLBACK &&
          !sameRelease(rollbackCandidate, target)
        ) {
          throw new TypeError('rollback target');
        }
      }
      if (!sameRelease(desired, source) && !sameRelease(desired, target)) {
        throw new TypeError('desired transition release');
      }
      if (
        (record.phase === LocalApplicationActivationPhase.SELECTED ||
          record.phase === LocalApplicationActivationPhase.ACTIVATING) &&
        (selected === null ||
          selectionGeneration < 1 ||
          !sameRelease(selected, desired))
      ) {
        throw new TypeError('selected transition release');
      }
      if (
        action !== LocalApplicationActivationAction.INSTALL &&
        (record.phase === LocalApplicationActivationPhase.QUIESCING ||
          record.phase === LocalApplicationActivationPhase.QUIESCENT) &&
        sameRelease(selected, target) &&
        sameRelease(desired, target)
      ) {
        throw new TypeError('unrecorded target selection');
      }
    }
  } catch (error) {
    if (error instanceof LocalApplicationActivationRecordError) throw error;
    throw new LocalApplicationActivationRecordError(appId, 'record shape');
  }
  return record;
}

/** @param {Record<string, any>} record - Observed record. @returns {import('../base.js').KeyCondition[]} - Exact CAS conditions. */
function replacementConditions(record) {
  return [...STORAGE_RECORD_KEYS]
    .filter((key) => key !== KEY_NAME && key !== SORT_KEY_NAME)
    .map((key) => eq(key, record[key]));
}

/** @param {import('../base.js').DBClient} db - DB client. @param {string} tableName - Table. @param {string} appId - Application. @returns {Promise<Record<string, any> | null>} - Strict record. */
async function readStored(db, tableName, appId) {
  const raw = await db.get({
    tableName,
    keyName: KEY_NAME,
    keyValue: getLocalApplicationActivationPartitionKey(appId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
    consistentRead: true,
  });
  return raw ? normalizeStorageRecord(raw, appId) : null;
}

/** @param {Record<string, any>} current - Current record. @param {Record<string, any>} changes - Replacement fields. @param {number} observedAt - Observation timestamp. @returns {Record<string, any>} - Next record. */
function replaceRecord(current, changes, observedAt) {
  return {
    ...current,
    ...changes,
    record_version: positiveInteger(
      current.record_version + 1,
      'next activation record version',
    ),
    updated_at: Math.max(current.updated_at, observedAt),
  };
}

/** @param {unknown} value - Candidate timestamp. @param {() => number} now - Clock. @param {string} label - Boundary label. @returns {number} - Timestamp. */
function observedAt(value, now, label) {
  return nonnegativeInteger(value === undefined ? now() : value, label);
}

/**
 * Create the durable local application activation state machine.
 * @param {{db: import('../base.js').DBClient, tableName: string, now?: () => number}} options - Store dependencies.
 * @returns {Readonly<Record<string, Function>>} - Activation operations.
 */
export function createLocalApplicationActivation({
  db,
  tableName,
  now = () => Date.now(),
}) {
  if (
    !db ||
    typeof db.get !== 'function' ||
    typeof db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createLocalApplicationActivation requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new TypeError(
      'createLocalApplicationActivation requires a tableName.',
    );
  }
  if (typeof now !== 'function') {
    throw new TypeError(
      'createLocalApplicationActivation now must be a function.',
    );
  }
  const resolvedTableName = tableName.trim();

  /** @param {string} appId - Application. @returns {Promise<Record<string, any> | null>} - Record. */
  async function read(appId) {
    return await readStored(db, resolvedTableName, appId);
  }

  /** @param {string} appId - Application. @param {Record<string, any> | null} current - Current record. @param {Record<string, any>} record - Next record. @returns {Promise<{applied: true, activation: Readonly<Record<string, any>>}>} - Applied record. */
  async function write(appId, current, record) {
    normalizeStorageRecord(record, appId);
    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record,
            conditions: current
              ? replacementConditions(current)
              : [notExists(SORT_KEY_NAME)],
          },
        ],
      });
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new LocalApplicationActivationConflictError(
          appId,
          'concurrent activation update',
        );
      }
      throw error;
    }
    return { applied: true, activation: toSnapshot(record) };
  }

  /** @param {{appId: string}} input - Application. @returns {Promise<Readonly<Record<string, any>> | null>} - Snapshot. */
  async function get(input) {
    const options = normalizeInput(input, new Set(['appId']), 'activation get');
    assertLogicalId(options.appId, 'get.appId');
    const record = await read(options.appId);
    return record ? toSnapshot(record) : null;
  }

  /** @param {{appId: string, target: {artifactId: string, revisionId: string}, observedAt?: number}} input - Initial install. @returns {Promise<Record<string, any>>} - Activation result. */
  async function beginInstall(input) {
    const options = normalizeInput(
      input,
      new Set(['appId', 'target', 'observedAt']),
      'activation beginInstall',
    );
    assertLogicalId(options.appId, 'beginInstall.appId');
    const target = normalizeRelease(options.target, 'beginInstall.target');
    const current = await read(options.appId);
    if (current) {
      const snapshot = toSnapshot(current);
      if (
        (snapshot.phase === LocalApplicationActivationPhase.ACTIVE &&
          sameRelease(snapshot.selected, target)) ||
        (snapshot.transition?.action ===
          LocalApplicationActivationAction.INSTALL &&
          sameRelease(snapshot.transition.target, target))
      ) {
        return { applied: false, activation: snapshot };
      }
      throw new LocalApplicationActivationConflictError(
        options.appId,
        'activation already exists',
      );
    }
    const timestamp = observedAt(
      options.observedAt,
      now,
      'beginInstall.observedAt',
    );
    const transitionId = createLocalApplicationActivationTransitionId({
      appId: options.appId,
      action: LocalApplicationActivationAction.INSTALL,
      source: null,
      target,
      sourceRecordVersion: 0,
      sourceSelectionGeneration: 0,
    });
    const record = {
      [KEY_NAME]: getLocalApplicationActivationPartitionKey(options.appId),
      [SORT_KEY_NAME]: LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
      schema_version: LOCAL_APPLICATION_ACTIVATION_SCHEMA_VERSION,
      record_kind: LOCAL_APPLICATION_ACTIVATION_RECORD_KIND,
      app_id: options.appId,
      record_version: 1,
      selection_generation: 0,
      phase: LocalApplicationActivationPhase.QUIESCING,
      selected_artifact_id: null,
      selected_revision_id: null,
      desired_artifact_id: target.artifactId,
      desired_revision_id: target.revisionId,
      rollback_artifact_id: null,
      rollback_revision_id: null,
      transition_id: transitionId,
      transition_action: LocalApplicationActivationAction.INSTALL,
      transition_source_record_version: 0,
      transition_source_selection_generation: 0,
      transition_source_artifact_id: null,
      transition_source_revision_id: null,
      transition_target_artifact_id: target.artifactId,
      transition_target_revision_id: target.revisionId,
      transition_started_at: timestamp,
      last_transition_id: null,
      last_transition_outcome: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    return await write(options.appId, null, record);
  }

  /** @param {{appId: string, transitionId: string, recordVersion: number, target: {artifactId: string, revisionId: string}, observedAt?: number}} input - Fenced replacement for a failed first-install target. @returns {Promise<Record<string, any>>} - Activation result. */
  async function replaceInstall(input) {
    const options = normalizeInput(
      input,
      new Set([
        'appId',
        'transitionId',
        'recordVersion',
        'target',
        'observedAt',
      ]),
      'activation replaceInstall',
    );
    assertLogicalId(options.appId, 'replaceInstall.appId');
    assertLocalApplicationActivationTransitionId(
      options.transitionId,
      'replaceInstall.transitionId',
    );
    const recordVersion = positiveInteger(
      options.recordVersion,
      'replaceInstall.recordVersion',
    );
    const target = normalizeRelease(options.target, 'replaceInstall.target');
    const current = await read(options.appId);
    if (!current)
      throw new LocalApplicationActivationNotFoundError(options.appId);
    const snapshot = toSnapshot(current);
    if (
      snapshot.transition?.action ===
        LocalApplicationActivationAction.INSTALL &&
      snapshot.transition.sourceRecordVersion === recordVersion &&
      sameRelease(snapshot.transition.target, target)
    ) {
      return { applied: false, activation: snapshot };
    }
    if (
      snapshot.phase === LocalApplicationActivationPhase.ACTIVE ||
      snapshot.transition?.action !==
        LocalApplicationActivationAction.INSTALL ||
      snapshot.transition.transitionId !== options.transitionId ||
      current.record_version !== recordVersion
    ) {
      throw new LocalApplicationActivationConflictError(
        options.appId,
        'expected exact in-flight install version',
      );
    }
    if (sameRelease(snapshot.transition.target, target)) {
      return { applied: false, activation: snapshot };
    }
    const timestamp = Math.max(
      current.updated_at,
      observedAt(options.observedAt, now, 'replaceInstall.observedAt'),
    );
    const transitionId = createLocalApplicationActivationTransitionId({
      appId: options.appId,
      action: LocalApplicationActivationAction.INSTALL,
      source: null,
      target,
      sourceRecordVersion: current.record_version,
      sourceSelectionGeneration: current.selection_generation,
    });
    return await write(
      options.appId,
      current,
      replaceRecord(
        current,
        {
          phase: LocalApplicationActivationPhase.QUIESCING,
          desired_artifact_id: target.artifactId,
          desired_revision_id: target.revisionId,
          transition_id: transitionId,
          transition_action: LocalApplicationActivationAction.INSTALL,
          transition_source_record_version: current.record_version,
          transition_source_selection_generation: current.selection_generation,
          transition_source_artifact_id: null,
          transition_source_revision_id: null,
          transition_target_artifact_id: target.artifactId,
          transition_target_revision_id: target.revisionId,
          transition_started_at: timestamp,
        },
        timestamp,
      ),
    );
  }

  /** @param {{appId: string, action: 'update'|'rollback', source: {artifactId: string, revisionId: string}, target: {artifactId: string, revisionId: string}, observedAt?: number}} input - Update or rollback. @returns {Promise<Record<string, any>>} - Activation result. */
  async function beginChange(input) {
    const options = normalizeInput(
      input,
      new Set(['appId', 'action', 'source', 'target', 'observedAt']),
      'activation beginChange',
    );
    assertLogicalId(options.appId, 'beginChange.appId');
    const action = normalizeAction(options.action, false);
    const source = normalizeRelease(options.source, 'beginChange.source');
    const target = normalizeRelease(options.target, 'beginChange.target');
    if (sameRelease(source, target)) {
      throw new TypeError('beginChange source and target must differ.');
    }
    const current = await read(options.appId);
    if (!current)
      throw new LocalApplicationActivationNotFoundError(options.appId);
    const snapshot = toSnapshot(current);
    if (
      snapshot.transition &&
      snapshot.transition.action === action &&
      sameRelease(snapshot.transition.source, source) &&
      sameRelease(snapshot.transition.target, target) &&
      sameRelease(snapshot.desired, target)
    ) {
      return { applied: false, activation: snapshot };
    }
    if (
      snapshot.phase !== LocalApplicationActivationPhase.ACTIVE ||
      !sameRelease(snapshot.selected, source)
    ) {
      throw new LocalApplicationActivationConflictError(
        options.appId,
        'expected exact active source release',
      );
    }
    if (
      action === LocalApplicationActivationAction.ROLLBACK &&
      !sameRelease(snapshot.rollbackCandidate, target)
    ) {
      throw new LocalApplicationActivationConflictError(
        options.appId,
        'rollback target is not the retained candidate',
      );
    }
    const timestamp = Math.max(
      current.updated_at,
      observedAt(options.observedAt, now, 'beginChange.observedAt'),
    );
    const transitionId = createLocalApplicationActivationTransitionId({
      appId: options.appId,
      action,
      source,
      target,
      sourceRecordVersion: current.record_version,
      sourceSelectionGeneration: current.selection_generation,
    });
    const record = replaceRecord(
      current,
      {
        phase: LocalApplicationActivationPhase.QUIESCING,
        desired_artifact_id: target.artifactId,
        desired_revision_id: target.revisionId,
        transition_id: transitionId,
        transition_action: action,
        transition_source_record_version: current.record_version,
        transition_source_selection_generation: current.selection_generation,
        transition_source_artifact_id: source.artifactId,
        transition_source_revision_id: source.revisionId,
        transition_target_artifact_id: target.artifactId,
        transition_target_revision_id: target.revisionId,
        transition_started_at: timestamp,
      },
      timestamp,
    );
    return await write(options.appId, current, record);
  }

  /** @param {unknown} input - Transition fence. @param {string} operation - Operation. @returns {Promise<{options: Record<string, any>, current: Record<string, any>, snapshot: Readonly<Record<string, any>>, timestamp: number}>} - Current transition. */
  async function currentTransition(input, operation) {
    const options = normalizeInput(
      input,
      new Set(['appId', 'transitionId', 'observedAt']),
      `activation ${operation}`,
    );
    assertLogicalId(options.appId, `${operation}.appId`);
    assertLocalApplicationActivationTransitionId(
      options.transitionId,
      `${operation}.transitionId`,
    );
    const current = await read(options.appId);
    if (!current)
      throw new LocalApplicationActivationNotFoundError(options.appId);
    const snapshot = toSnapshot(current);
    return {
      options,
      current,
      snapshot,
      timestamp: Math.max(
        current.updated_at,
        observedAt(options.observedAt, now, `${operation}.observedAt`),
      ),
    };
  }

  /** @param {{appId: string, transitionId: string, observedAt?: number}} input - Transition. @returns {Promise<Record<string, any>>} - Activation result. */
  async function markQuiescent(input) {
    const context = await currentTransition(input, 'markQuiescent');
    if (
      context.snapshot.transition?.transitionId !== context.options.transitionId
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'stale transition',
      );
    }
    if (
      context.snapshot.phase === LocalApplicationActivationPhase.QUIESCENT ||
      context.snapshot.phase === LocalApplicationActivationPhase.SELECTED ||
      context.snapshot.phase === LocalApplicationActivationPhase.ACTIVATING
    ) {
      return { applied: false, activation: context.snapshot };
    }
    if (context.snapshot.phase !== LocalApplicationActivationPhase.QUIESCING) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        `expected QUIESCING, found ${context.snapshot.phase}`,
      );
    }
    return await write(
      context.options.appId,
      context.current,
      replaceRecord(
        context.current,
        { phase: LocalApplicationActivationPhase.QUIESCENT },
        context.timestamp,
      ),
    );
  }

  /** @param {{appId: string, transitionId: string, destination: 'source'|'target', observedAt?: number}} input - Selection. @returns {Promise<Record<string, any>>} - Activation result. */
  async function markSelected(input) {
    const options = normalizeInput(
      input,
      new Set(['appId', 'transitionId', 'destination', 'observedAt']),
      'activation markSelected',
    );
    if (
      options.destination !== LocalApplicationActivationDestination.SOURCE &&
      options.destination !== LocalApplicationActivationDestination.TARGET
    ) {
      throw new TypeError(
        "markSelected.destination must be 'source' or 'target'.",
      );
    }
    const context = await currentTransition(
      {
        appId: options.appId,
        transitionId: options.transitionId,
        ...(Object.prototype.hasOwnProperty.call(options, 'observedAt')
          ? { observedAt: options.observedAt }
          : {}),
      },
      'markSelected',
    );
    if (context.snapshot.transition?.transitionId !== options.transitionId) {
      throw new LocalApplicationActivationConflictError(
        options.appId,
        'stale transition',
      );
    }
    const release =
      options.destination === LocalApplicationActivationDestination.SOURCE
        ? context.snapshot.transition.source
        : context.snapshot.transition.target;
    if (release === null || !sameRelease(context.snapshot.desired, release)) {
      throw new LocalApplicationActivationConflictError(
        options.appId,
        'destination does not match desired release',
      );
    }
    if (
      (context.snapshot.phase === LocalApplicationActivationPhase.SELECTED ||
        context.snapshot.phase ===
          LocalApplicationActivationPhase.ACTIVATING) &&
      sameRelease(context.snapshot.selected, release)
    ) {
      return { applied: false, activation: context.snapshot };
    }
    if (context.snapshot.phase !== LocalApplicationActivationPhase.QUIESCENT) {
      throw new LocalApplicationActivationConflictError(
        options.appId,
        `expected QUIESCENT, found ${context.snapshot.phase}`,
      );
    }
    const changed = !sameRelease(context.snapshot.selected, release);
    const record = replaceRecord(
      context.current,
      {
        phase: LocalApplicationActivationPhase.SELECTED,
        selection_generation: changed
          ? positiveInteger(
              context.current.selection_generation + 1,
              'next activation selection generation',
            )
          : context.current.selection_generation,
        selected_artifact_id: release.artifactId,
        selected_revision_id: release.revisionId,
      },
      context.timestamp,
    );
    return await write(options.appId, context.current, record);
  }

  /** @param {{appId: string, transitionId: string, observedAt?: number}} input - Transition. @returns {Promise<Record<string, any>>} - Activation result. */
  async function markActivating(input) {
    const context = await currentTransition(input, 'markActivating');
    if (
      context.snapshot.transition?.transitionId !== context.options.transitionId
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'stale transition',
      );
    }
    if (context.snapshot.phase === LocalApplicationActivationPhase.ACTIVATING) {
      return { applied: false, activation: context.snapshot };
    }
    if (
      context.snapshot.phase !== LocalApplicationActivationPhase.SELECTED ||
      !sameRelease(context.snapshot.selected, context.snapshot.desired)
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        `expected exact SELECTED release, found ${context.snapshot.phase}`,
      );
    }
    return await write(
      context.options.appId,
      context.current,
      replaceRecord(
        context.current,
        { phase: LocalApplicationActivationPhase.ACTIVATING },
        context.timestamp,
      ),
    );
  }

  /** @param {{appId: string, transitionId: string, observedAt?: number}} input - Failed target transition. @returns {Promise<Record<string, any>>} - Activation result. */
  async function beginSourceRestore(input) {
    const context = await currentTransition(input, 'beginSourceRestore');
    if (
      context.snapshot.transition?.transitionId !== context.options.transitionId
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'stale transition',
      );
    }
    const source = context.snapshot.transition.source;
    if (source === null) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'install transition has no source to restore',
      );
    }
    if (sameRelease(context.snapshot.desired, source)) {
      return { applied: false, activation: context.snapshot };
    }
    if (context.snapshot.phase === LocalApplicationActivationPhase.ACTIVE) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'transition is already complete',
      );
    }
    const record = replaceRecord(
      context.current,
      {
        phase: LocalApplicationActivationPhase.QUIESCING,
        desired_artifact_id: source.artifactId,
        desired_revision_id: source.revisionId,
      },
      context.timestamp,
    );
    return await write(context.options.appId, context.current, record);
  }

  /** @param {{appId: string, transitionId: string, observedAt?: number}} input - Forward change refused before the selected source was stopped. @returns {Promise<Record<string, any>>} - Activation result. */
  async function abortChange(input) {
    const context = await currentTransition(input, 'abortChange');
    if (
      context.snapshot.phase === LocalApplicationActivationPhase.ACTIVE &&
      context.snapshot.lastTransition?.transitionId ===
        context.options.transitionId &&
      context.snapshot.lastTransition.outcome ===
        LocalApplicationActivationOutcome.SOURCE_RETAINED
    ) {
      return { applied: false, activation: context.snapshot };
    }
    if (
      context.snapshot.transition?.transitionId !== context.options.transitionId
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'stale transition',
      );
    }
    const transition = context.snapshot.transition;
    if (
      transition.action === LocalApplicationActivationAction.INSTALL ||
      transition.source === null ||
      context.snapshot.phase !== LocalApplicationActivationPhase.QUIESCING ||
      !sameRelease(context.snapshot.selected, transition.source) ||
      !sameRelease(context.snapshot.desired, transition.target) ||
      context.snapshot.selectionGeneration !==
        transition.sourceSelectionGeneration
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'change can be aborted only before source quiescence or selection changes',
      );
    }
    const record = replaceRecord(
      context.current,
      {
        phase: LocalApplicationActivationPhase.ACTIVE,
        desired_artifact_id: transition.source.artifactId,
        desired_revision_id: transition.source.revisionId,
        transition_id: null,
        transition_action: null,
        transition_source_record_version: null,
        transition_source_selection_generation: null,
        transition_source_artifact_id: null,
        transition_source_revision_id: null,
        transition_target_artifact_id: null,
        transition_target_revision_id: null,
        transition_started_at: null,
        last_transition_id: context.options.transitionId,
        last_transition_outcome:
          LocalApplicationActivationOutcome.SOURCE_RETAINED,
      },
      context.timestamp,
    );
    return await write(context.options.appId, context.current, record);
  }

  /** @param {{appId: string, transitionId: string, observedAt?: number}} input - Healthy selected release. @returns {Promise<Record<string, any>>} - Activation result. */
  async function completeActivation(input) {
    const context = await currentTransition(input, 'completeActivation');
    if (
      context.snapshot.phase === LocalApplicationActivationPhase.ACTIVE &&
      context.snapshot.lastTransition?.transitionId ===
        context.options.transitionId
    ) {
      return { applied: false, activation: context.snapshot };
    }
    if (
      context.snapshot.transition?.transitionId !== context.options.transitionId
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'stale transition',
      );
    }
    if (
      context.snapshot.phase !== LocalApplicationActivationPhase.ACTIVATING ||
      !sameRelease(context.snapshot.selected, context.snapshot.desired)
    ) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        `expected exact ACTIVATING release, found ${context.snapshot.phase}`,
      );
    }
    const transition = context.snapshot.transition;
    const targetActive = sameRelease(
      context.snapshot.selected,
      transition.target,
    );
    const sourceRestored = sameRelease(
      context.snapshot.selected,
      transition.source,
    );
    if (!targetActive && !sourceRestored) {
      throw new LocalApplicationActivationConflictError(
        context.options.appId,
        'selected release is outside the transition',
      );
    }
    const rollbackCandidate = targetActive
      ? transition.source
      : context.snapshot.rollbackCandidate;
    const record = replaceRecord(
      context.current,
      {
        phase: LocalApplicationActivationPhase.ACTIVE,
        desired_artifact_id: context.snapshot.selected.artifactId,
        desired_revision_id: context.snapshot.selected.revisionId,
        rollback_artifact_id: rollbackCandidate?.artifactId ?? null,
        rollback_revision_id: rollbackCandidate?.revisionId ?? null,
        transition_id: null,
        transition_action: null,
        transition_source_record_version: null,
        transition_source_selection_generation: null,
        transition_source_artifact_id: null,
        transition_source_revision_id: null,
        transition_target_artifact_id: null,
        transition_target_revision_id: null,
        transition_started_at: null,
        last_transition_id: context.options.transitionId,
        last_transition_outcome: targetActive
          ? LocalApplicationActivationOutcome.TARGET_ACTIVE
          : LocalApplicationActivationOutcome.SOURCE_RESTORED,
      },
      context.timestamp,
    );
    return await write(context.options.appId, context.current, record);
  }

  return Object.freeze({
    get,
    beginInstall,
    replaceInstall,
    beginChange,
    markQuiescent,
    markSelected,
    markActivating,
    beginSourceRestore,
    abortChange,
    completeActivation,
  });
}

/** @param {string} appId - Application. @param {Record<string, any> | null} record - Activation record. @returns {Readonly<import('../base.js').TransactionConditionCheck>} - Portable transaction fence. */
function createAdmissionFence(appId, record) {
  const conditionCheck = {
    keyName: KEY_NAME,
    keyValue: getLocalApplicationActivationPartitionKey(appId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
    conditions: record
      ? [
          eq('schema_version', record.schema_version),
          eq('record_kind', record.record_kind),
          eq('app_id', record.app_id),
          eq('record_version', record.record_version),
          eq('selection_generation', record.selection_generation),
          eq('phase', record.phase),
          eq('selected_artifact_id', record.selected_artifact_id),
          eq('selected_revision_id', record.selected_revision_id),
          eq('desired_artifact_id', record.desired_artifact_id),
          eq('desired_revision_id', record.desired_revision_id),
          eq('transition_id', record.transition_id),
        ]
      : [notExists(SORT_KEY_NAME)],
  };
  for (const condition of conditionCheck.conditions) Object.freeze(condition);
  Object.freeze(conditionCheck.conditions);
  return Object.freeze(conditionCheck);
}

/** @param {{db: import('../base.js').DBClient, tableName: string, appId: string, revisionId: string}} input - Run admission request. @returns {Promise<Readonly<import('../base.js').TransactionConditionCheck>>} - Same-transaction run fence. */
export async function getLocalApplicationRunCreationFence(input) {
  if (!input?.db || typeof input.db.get !== 'function') {
    throw new TypeError(
      'run creation admission requires a DB client with get.',
    );
  }
  if (typeof input.tableName !== 'string' || !input.tableName.trim()) {
    throw new TypeError('run creation admission requires a tableName.');
  }
  assertLogicalId(input.appId, 'run admission.appId');
  assertApplicationRevisionId(input.revisionId, 'run admission.revisionId');
  const record = await readStored(
    input.db,
    input.tableName.trim(),
    input.appId,
  );
  if (!record) return createAdmissionFence(input.appId, null);
  const selected = readStoredRelease(record, 'selected', 'selected', true);
  if (
    record.phase !== LocalApplicationActivationPhase.ACTIVE ||
    selected === null ||
    selected.revisionId !== input.revisionId
  ) {
    throw new LocalApplicationAdmissionClosedError({
      appId: input.appId,
      revisionId: input.revisionId,
      operation: 'run-creation',
      phase: record.phase,
      selectedRevisionId: selected?.revisionId,
    });
  }
  return createAdmissionFence(input.appId, record);
}

/** @param {{db: import('../base.js').DBClient, tableName: string, appId: string, revisionId: string, artifactId?: string}} input - Service admission request. @returns {Promise<Readonly<import('../base.js').TransactionConditionCheck>>} - Same-transaction service fence. */
export async function getLocalApplicationServiceStartFence(input) {
  if (!input?.db || typeof input.db.get !== 'function') {
    throw new TypeError(
      'service start admission requires a DB client with get.',
    );
  }
  if (typeof input.tableName !== 'string' || !input.tableName.trim()) {
    throw new TypeError('service start admission requires a tableName.');
  }
  assertLogicalId(input.appId, 'service admission.appId');
  assertApplicationRevisionId(input.revisionId, 'service admission.revisionId');
  if (input.artifactId !== undefined) {
    assertArtifactId(input.artifactId, 'service admission.artifactId');
  }
  const record = await readStored(
    input.db,
    input.tableName.trim(),
    input.appId,
  );
  if (!record) return createAdmissionFence(input.appId, null);
  const selected = readStoredRelease(record, 'selected', 'selected', true);
  const desired = readStoredRelease(record, 'desired', 'desired', false);
  const source = readStoredRelease(
    record,
    'transition_source',
    'transition.source',
    true,
  );
  const target = readStoredRelease(
    record,
    'transition_target',
    'transition.target',
    true,
  );
  const drainingSource =
    record.phase === LocalApplicationActivationPhase.QUIESCING &&
    record.transition_action !== LocalApplicationActivationAction.INSTALL &&
    source !== null &&
    target !== null &&
    sameRelease(selected, source) &&
    sameRelease(desired, target);
  const phaseAdmits =
    record.phase === LocalApplicationActivationPhase.ACTIVE ||
    record.phase === LocalApplicationActivationPhase.ACTIVATING ||
    drainingSource;
  if (
    !phaseAdmits ||
    selected === null ||
    selected.revisionId !== input.revisionId ||
    input.artifactId === undefined ||
    selected.artifactId !== input.artifactId
  ) {
    throw new LocalApplicationAdmissionClosedError({
      appId: input.appId,
      revisionId: input.revisionId,
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      operation: 'service-start',
      phase: record.phase,
      selectedRevisionId: selected?.revisionId,
    });
  }
  return createAdmissionFence(input.appId, record);
}
