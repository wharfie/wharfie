import Operation, { Status as OperationStatus } from '../../graph/operation.js';
import Action, { Status as ActionStatus } from '../../graph/action.js';
import {
  RUN_SORT_KEY_PREFIX,
  getActionSortKey,
  getOperationSortKey,
  getOperationSortKeyPrefix,
} from '../../graph/operation-record-key.js';
import { assertApplicationRevisionId } from '../../../runtime/application-revision.js';

import { CONDITION_TYPE, KEY_TYPE } from '../base.js';

/**
 * @typedef {import('../base.js').DBClient} DBClient
 */

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';

// A replacement writes the new snapshot and deletes every stale action in one
// transaction. Keeping both the old and new graph below 50 actions guarantees
// the worst case fits DynamoDB's 100-item transaction limit.
export const MAX_OPERATION_ACTIONS = 49;

const TERMINAL_OPERATION_STATUSES = new Set([
  OperationStatus.COMPLETED,
  OperationStatus.FAILED,
  OperationStatus.CANCELLED,
]);

const OPERATION_TRANSITIONS = new Map([
  [OperationStatus.PENDING, new Set([OperationStatus.RUNNING])],
  [
    OperationStatus.RUNNING,
    new Set([
      OperationStatus.COMPLETED,
      OperationStatus.FAILED,
      OperationStatus.BLOCKED,
    ]),
  ],
]);

/** Error raised when a create would overwrite a durable operation. */
export class OperationAlreadyExistsError extends Error {
  /**
   * @param {string} resourceId - Application resource id.
   * @param {string} operationId - Operation id.
   */
  constructor(resourceId, operationId) {
    super(`Operation already exists: ${resourceId}#${operationId}`);
    this.name = 'OperationAlreadyExistsError';
    this.resourceId = resourceId;
    this.operationId = operationId;
  }
}

/** Error raised when an expected durable version is no longer current. */
export class OperationConflictError extends Error {
  /**
   * @param {string} resourceId - Application resource id.
   * @param {string} operationId - Operation id.
   * @param {string} [reason] - Optional safe conflict reason.
   */
  constructor(resourceId, operationId, reason) {
    super(
      `Operation changed concurrently: ${resourceId}#${operationId}${
        reason ? ` (${reason})` : ''
      }`,
    );
    this.name = 'OperationConflictError';
    this.resourceId = resourceId;
    this.operationId = operationId;
  }
}

/** Error raised when an operation does not exist. */
export class OperationNotFoundError extends Error {
  /**
   * @param {string} resourceId - Application resource id.
   * @param {string} operationId - Operation id.
   */
  constructor(resourceId, operationId) {
    super(`Operation not found: ${resourceId}#${operationId}`);
    this.name = 'OperationNotFoundError';
    this.resourceId = resourceId;
    this.operationId = operationId;
  }
}

/** Error raised when a multi-record operation snapshot is incomplete or invalid. */
export class OperationSnapshotError extends Error {
  /**
   * @param {string} resourceId - Application resource id.
   * @param {string} operationId - Operation id.
   * @param {string} reason - Safe structural failure reason.
   */
  constructor(resourceId, operationId, reason) {
    super(
      `Operation snapshot is incomplete or invalid: ${resourceId}#${operationId} (${reason})`,
    );
    this.name = 'OperationSnapshotError';
    this.resourceId = resourceId;
    this.operationId = operationId;
  }
}

/**
 * @param {string} propertyName - Property name.
 * @param {string} propertyValue - Property value.
 * @returns {import('../base.js').KeyCondition} - Primary-key equality condition.
 */
function pkEq(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.PRIMARY,
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Property name.
 * @param {string} propertyValue - Property value.
 * @returns {import('../base.js').KeyCondition} - Sort-key prefix condition.
 */
function skBegins(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.SORT,
    conditionType: CONDITION_TYPE.BEGINS_WITH,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Property name.
 * @param {unknown} propertyValue - Property value.
 * @returns {import('../base.js').KeyCondition} - Equality condition.
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Property name.
 * @returns {import('../base.js').KeyCondition} - Non-existence condition.
 */
function notExists(propertyName) {
  return {
    conditionType: CONDITION_TYPE.NOT_EXISTS,
    propertyName,
  };
}

/**
 * @param {unknown} error - Error to inspect.
 * @returns {boolean} - Whether a conditional write lost a race.
 */
function isConditionalCheckFailed(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * Locale-independent string ordering.
 * @param {string} left - Left value.
 * @param {string} right - Right value.
 * @returns {number} - Comparison result.
 */
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Validate the serialized graph against the exact action records in a
 * snapshot. The metadata graph is authoritative for membership and edges.
 * @param {string} serializedGraph - Serialized operation graph.
 * @param {Array<{id: string, type: string}>} actions - Exact action definitions.
 * @param {string} resourceId - Application resource id.
 * @param {string} operationId - Operation id.
 * @returns {void}
 */
function validateSerializedActionGraph(
  serializedGraph,
  actions,
  resourceId,
  operationId,
) {
  /** @type {any} */
  let graph;
  try {
    graph = JSON.parse(serializedGraph);
  } catch {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'serialized graph is not valid JSON',
    );
  }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'serialized graph must be an object',
    );
  }
  const graphKeys = Object.keys(graph).sort(compareStrings);
  if (
    JSON.stringify(graphKeys) !==
    JSON.stringify(
      ['actionIdsToTypes', 'incomingEdges', 'outgoingEdges'].sort(
        compareStrings,
      ),
    )
  ) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'serialized graph has unexpected fields',
    );
  }
  if (
    !Array.isArray(graph.actionIdsToTypes) ||
    !Array.isArray(graph.outgoingEdges) ||
    !Array.isArray(graph.incomingEdges)
  ) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'serialized graph collections must be arrays',
    );
  }

  const actionById = new Map();
  for (const action of actions) {
    if (
      !action ||
      typeof action.id !== 'string' ||
      typeof action.type !== 'string' ||
      actionById.has(action.id)
    ) {
      throw new OperationSnapshotError(
        resourceId,
        operationId,
        'action records contain an invalid or duplicate identity',
      );
    }
    actionById.set(action.id, action);
  }

  const declaredTypes = new Map();
  for (const entry of graph.actionIdsToTypes) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string' ||
      declaredTypes.has(entry[0])
    ) {
      throw new OperationSnapshotError(
        resourceId,
        operationId,
        'action type declarations are invalid or duplicated',
      );
    }
    declaredTypes.set(entry[0], entry[1]);
  }
  if (declaredTypes.size !== actionById.size) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'action metadata and records have different membership',
    );
  }
  for (const [actionId, action] of actionById) {
    if (declaredTypes.get(actionId) !== action.type) {
      throw new OperationSnapshotError(
        resourceId,
        operationId,
        'action metadata and records have different types',
      );
    }
  }

  /**
   * @param {any[]} entries - Serialized adjacency entries.
   * @param {boolean} incoming - Whether entries are destination -> origins.
   * @returns {Set<string>} - Canonical directed edges.
   */
  const parseEdges = (entries, incoming) => {
    const edges = new Set();
    const seenNodes = new Set();
    for (const entry of entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        !Array.isArray(entry[1]) ||
        !actionById.has(entry[0]) ||
        seenNodes.has(entry[0])
      ) {
        throw new OperationSnapshotError(
          resourceId,
          operationId,
          'action adjacency entries are invalid',
        );
      }
      seenNodes.add(entry[0]);
      const seenNeighbors = new Set();
      for (const neighbor of entry[1]) {
        if (
          typeof neighbor !== 'string' ||
          !actionById.has(neighbor) ||
          seenNeighbors.has(neighbor)
        ) {
          throw new OperationSnapshotError(
            resourceId,
            operationId,
            'action adjacency contains an invalid endpoint',
          );
        }
        seenNeighbors.add(neighbor);
        const origin = incoming ? neighbor : entry[0];
        const destination = incoming ? entry[0] : neighbor;
        edges.add(JSON.stringify([origin, destination]));
      }
    }
    return edges;
  };

  const outgoingEdges = parseEdges(graph.outgoingEdges, false);
  const incomingEdges = parseEdges(graph.incomingEdges, true);
  if (
    outgoingEdges.size !== incomingEdges.size ||
    [...outgoingEdges].some((edge) => !incomingEdges.has(edge))
  ) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'incoming and outgoing edges disagree',
    );
  }

  /** @type {Map<string, string[]>} */
  const outgoingById = new Map(
    [...actionById.keys()].map((actionId) => [actionId, []]),
  );
  /** @type {Map<string, number>} */
  const inDegree = new Map(
    [...actionById.keys()].map((actionId) => [actionId, 0]),
  );
  for (const encodedEdge of outgoingEdges) {
    const [origin, destination] = JSON.parse(encodedEdge);
    outgoingById.get(origin)?.push(destination);
    inDegree.set(destination, Number(inDegree.get(destination) || 0) + 1);
  }
  const ready = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([actionId]) => actionId);
  let visited = 0;
  while (ready.length > 0) {
    const actionId = ready.pop();
    if (!actionId) break;
    visited += 1;
    for (const downstream of outgoingById.get(actionId) || []) {
      const nextDegree = Number(inDegree.get(downstream) || 0) - 1;
      inDegree.set(downstream, nextDegree);
      if (nextDegree === 0) ready.push(downstream);
    }
  }
  if (visited !== actionById.size) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'action graph contains a cycle',
    );
  }
}

/**
 * @param {Operation} operation - Operation to validate.
 * @returns {Action[]} - Its actions.
 */
function validateOperationSnapshot(operation) {
  if (!(operation instanceof Operation)) {
    throw new TypeError('Expected an Operation instance');
  }
  assertApplicationRevisionId(operation.revision_id, 'operation.revision_id');
  const actions = operation.getActions();
  if (actions.length > MAX_OPERATION_ACTIONS) {
    throw new RangeError(
      `Operation ${operation.id} has ${actions.length} actions; the current transactional store supports at most ${MAX_OPERATION_ACTIONS}`,
    );
  }
  for (const action of actions) {
    if (
      action.resource_id !== operation.resource_id ||
      action.operation_id !== operation.id
    ) {
      throw new Error(
        `Action ${action.id} does not belong to operation ${operation.resource_id}#${operation.id}`,
      );
    }
  }
  validateSerializedActionGraph(
    operation.serializeGraph(),
    actions,
    operation.resource_id,
    operation.id,
  );
  return actions;
}

/**
 * Add query-friendly concurrency fields at the record top level.
 * @param {Record<string, any>} record - Persisted record.
 * @returns {Record<string, any>} - Normalized record.
 */
function normalizeRecord(record) {
  return {
    ...record,
    status: record.data.status,
    ...(record.data.record_type === Operation.RecordType
      ? {
          generation: record.data.generation,
          version: record.data.version,
          revision_id: record.data.revision_id,
        }
      : {
          operation_generation: record.data.operation_generation,
          action_version: record.data.version,
        }),
  };
}

/**
 * Produce records for a new durable graph generation without mutating the
 * caller-owned graph until the transaction succeeds.
 * @param {Operation} operation - Operation snapshot.
 * @param {number} generation - Graph generation.
 * @param {number} version - Operation CAS version.
 * @param {Map<string, number>} [actionVersions] - Next revision by action ID.
 * @returns {Record<string, any>[]} - Normalized records.
 */
function snapshotRecords(
  operation,
  generation,
  version,
  actionVersions = new Map(),
) {
  validateOperationSnapshot(operation);
  return operation.toRecords().map((record) => {
    const next = {
      ...record,
      data: { ...record.data },
    };
    if (next.data.record_type === Operation.RecordType) {
      next.data.generation = generation;
      next.data.version = version;
    } else {
      next.data.operation_generation = generation;
      next.data.version = actionVersions.get(next.data.id) || 1;
    }
    return normalizeRecord(next);
  });
}

/**
 * Adopt metadata only after a durable transaction succeeds.
 * @param {Operation} operation - Operation snapshot.
 * @param {number} generation - Graph generation.
 * @param {number} version - CAS version.
 * @param {Map<string, number>} [actionVersions] - Adopted revision by action ID.
 */
function adoptSnapshotMetadata(
  operation,
  generation,
  version,
  actionVersions = new Map(),
) {
  operation.generation = generation;
  operation.version = version;
  for (const action of operation.getActions()) {
    action.operation_generation = generation;
    action.version = actionVersions.get(action.id) || 1;
  }
}

/**
 * @param {Record<string, any>} record - Persisted record.
 * @param {string} resourceId - App resource id.
 * @param {string} operationId - Operation id.
 * @returns {boolean} - Whether this is the exact operation record.
 */
function isOperationRecord(record, resourceId, operationId) {
  return (
    record?.data?.record_type === Operation.RecordType &&
    record.data.resource_id === resourceId &&
    record.data.id === operationId &&
    record.sort_key === getOperationSortKey(operationId)
  );
}

/**
 * @param {Record<string, any>} record - Persisted record.
 * @param {string} resourceId - App resource id.
 * @param {string} operationId - Operation id.
 * @returns {boolean} - Whether this action belongs to the exact operation.
 */
function isActionRecord(record, resourceId, operationId) {
  if (
    typeof record?.data?.id !== 'string' ||
    record.data.record_type !== Action.RecordType ||
    record.data.resource_id !== resourceId ||
    record.data.operation_id !== operationId
  ) {
    return false;
  }
  return record.sort_key === getActionSortKey(operationId, record.data.id);
}

/**
 * Validate one exact persisted operation snapshot before constructing graph
 * objects or authorizing a replacement.
 * @param {Record<string, any>} operationRecord - Exact operation metadata.
 * @param {Record<string, any>[]} actionRecords - All records under its action namespace.
 * @param {string} resourceId - Application resource id.
 * @param {string} operationId - Operation id.
 * @returns {void}
 */
function validatePersistedSnapshot(
  operationRecord,
  actionRecords,
  resourceId,
  operationId,
) {
  if (!isOperationRecord(operationRecord, resourceId, operationId)) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'metadata record identity is invalid',
    );
  }
  try {
    assertApplicationRevisionId(
      operationRecord.data.revision_id,
      'operation.revision_id',
    );
  } catch {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'application revision identity is invalid',
    );
  }
  if (
    !Number.isSafeInteger(operationRecord.data.generation) ||
    operationRecord.data.generation < 1 ||
    !Number.isSafeInteger(operationRecord.data.version) ||
    operationRecord.data.version < 1 ||
    operationRecord.generation !== operationRecord.data.generation ||
    operationRecord.version !== operationRecord.data.version ||
    operationRecord.revision_id !== operationRecord.data.revision_id ||
    operationRecord.status !== operationRecord.data.status
  ) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      'metadata concurrency fields are invalid',
    );
  }
  if (actionRecords.length > MAX_OPERATION_ACTIONS) {
    throw new OperationSnapshotError(
      resourceId,
      operationId,
      `snapshot exceeds ${MAX_OPERATION_ACTIONS} actions`,
    );
  }
  for (const actionRecord of actionRecords) {
    if (
      !isActionRecord(actionRecord, resourceId, operationId) ||
      actionRecord.data.operation_generation !==
        operationRecord.data.generation ||
      !Number.isSafeInteger(actionRecord.data.version) ||
      actionRecord.data.version < 1 ||
      actionRecord.operation_generation !==
        actionRecord.data.operation_generation ||
      actionRecord.action_version !== actionRecord.data.version ||
      actionRecord.status !== actionRecord.data.status
    ) {
      throw new OperationSnapshotError(
        resourceId,
        operationId,
        'action identity or concurrency fields are invalid',
      );
    }
  }
  validateSerializedActionGraph(
    operationRecord.data.serialized_action_graph,
    actionRecords.map((record) => record.data),
    resourceId,
    operationId,
  );
}

/**
 * @param {DBClient} dbClient - DB client.
 * @param {string} tableName - Table name.
 * @param {string} resourceId - Resource id.
 * @param {string} operationId - Operation id.
 * @returns {Promise<Record<string, any>[]>} - Exact operation records.
 */
async function queryOperationRecords(
  dbClient,
  tableName,
  resourceId,
  operationId,
) {
  return (
    (await dbClient.query({
      tableName,
      consistentRead: true,
      keyConditions: [
        pkEq(KEY_NAME, resourceId),
        skBegins(SORT_KEY_NAME, getOperationSortKeyPrefix(operationId)),
      ],
    })) || []
  );
}

/**
 * Load an exact graph through a metadata/query/metadata stability check. This
 * is necessary because DynamoDB strongly consistent Query is read-committed,
 * not a transactional snapshot across multiple items.
 * @param {DBClient} dbClient - DB client.
 * @param {string} tableName - Table name.
 * @param {string} resourceId - Application resource id.
 * @param {string} operationId - Operation id.
 * @returns {Promise<Record<string, any>[]>} - Metadata followed by exact actions, or an empty array.
 */
async function loadStableOperationRecords(
  dbClient,
  tableName,
  resourceId,
  operationId,
) {
  /** @type {OperationSnapshotError | undefined} */
  let lastSnapshotError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const before = await dbClient.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: resourceId,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: getOperationSortKey(operationId),
      consistentRead: true,
    });
    if (!before) return [];

    // eslint-disable-next-line no-await-in-loop
    const queried = await queryOperationRecords(
      dbClient,
      tableName,
      resourceId,
      operationId,
    );
    // eslint-disable-next-line no-await-in-loop
    const after = await dbClient.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: resourceId,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: getOperationSortKey(operationId),
      consistentRead: true,
    });

    if (
      !after ||
      before.data?.version !== after.data?.version ||
      before.data?.generation !== after.data?.generation ||
      before.data?.status !== after.data?.status ||
      before.data?.revision_id !== after.data?.revision_id ||
      before.data?.serialized_action_graph !==
        after.data?.serialized_action_graph
    ) {
      lastSnapshotError = new OperationSnapshotError(
        resourceId,
        operationId,
        'metadata changed during the read',
      );
      continue;
    }

    try {
      const queriedMetadata = queried.filter((record) =>
        isOperationRecord(record, resourceId, operationId),
      );
      const actionRecords = queried.filter((record) =>
        isActionRecord(record, resourceId, operationId),
      );
      if (
        queriedMetadata.length !== 1 ||
        queriedMetadata[0].data.version !== after.data.version ||
        queriedMetadata[0].data.generation !== after.data.generation ||
        queriedMetadata[0].data.revision_id !== after.data.revision_id
      ) {
        throw new OperationSnapshotError(
          resourceId,
          operationId,
          'query metadata does not match the stable metadata read',
        );
      }
      if (queriedMetadata.length + actionRecords.length !== queried.length) {
        throw new OperationSnapshotError(
          resourceId,
          operationId,
          'operation namespace contains an unknown record',
        );
      }
      validatePersistedSnapshot(after, actionRecords, resourceId, operationId);
      return [after, ...actionRecords];
    } catch (error) {
      if (!(error instanceof OperationSnapshotError)) throw error;
      lastSnapshotError = error;
    }
  }

  throw (
    lastSnapshotError ||
    new OperationSnapshotError(
      resourceId,
      operationId,
      'could not obtain a stable snapshot',
    )
  );
}

/**
 * Persisted operation and action API.
 * @typedef {Object} OperationsTableClient
 * @property {(operation: Operation) => Promise<Operation>} createOperation - Conditionally create one complete operation snapshot.
 * @property {(operation: Operation, expectedVersion?: number) => Promise<Operation>} replaceOperation - Atomically replace an existing snapshot and remove stale actions.
 * @property {(resource_id: string, operation_id: string, expectedVersion?: number) => Promise<Operation>} retryOperation - Explicitly reset failed or blocked work.
 * @property {(resource_id: string, operation_id: string, metadata?: {reason?: string, requestedBy?: string}) => Promise<{operation: Operation, changed: boolean}>} cancelOperation - Durably cancel nonterminal work.
 * @property {(resource_id: string, operation_id: string) => Promise<Operation | null>} getOperation - Load one operation.
 * @property {(resource_id: string) => Promise<Operation[]>} getOperations - Load an app's operations.
 * @property {(operation: Operation) => Promise<Action[]>} getActions - Load an operation's current-generation actions.
 * @property {(resource_id: string, operation_id: string, action_id: string) => Promise<Action | null>} getAction - Load one action.
 * @property {(action: Action, expected_status?: string) => Promise<boolean>} commitAction - Conditionally commit a complete action snapshot.
 * @property {(action: Action, new_status: string, overrideTableName?: string) => Promise<boolean>} updateActionStatus - Conditionally transition an action status.
 * @property {(operation: Operation, new_status: import('../../graph/operation.js').WharfieOperationStatusEnum, overrideTableName?: string) => Promise<boolean>} updateOperationStatus - Conditionally transition operation status.
 * @property {(operation: Operation, action_id: string) => Promise<boolean>} checkActionPrerequisites - Check exact action prerequisites.
 * @property {(resource_id: string, operation_id?: string) => Promise<{ operations: Operation[]; actions: Action[] }>} getRecords - Load current persisted runs.
 */

/**
 * Create an operations table client.
 * @param {{ db?: DBClient, tableName?: string }} [params] - Table configuration.
 * @throws {Error} If db or tableName are missing.
 * @returns {OperationsTableClient} - Operations table client.
 */
export function createOperationsTable({ db, tableName } = {}) {
  if (!db) throw new Error('createOperationsTable requires a db client');
  if (typeof db.transactionWrite !== 'function') {
    throw new Error(
      'createOperationsTable requires a transactional DB client (transactionWrite)',
    );
  }
  if (!tableName || !String(tableName).trim()) {
    throw new Error('createOperationsTable requires a tableName');
  }

  /** @type {DBClient} */
  const dbClient = db;
  const resolvedTableName = String(tableName).trim();

  /**
   * @param {Operation} operation - Operation to create.
   * @returns {Promise<Operation>} - Created operation.
   */
  async function createOperation(operation) {
    const records = snapshotRecords(operation, 1, 1);
    const operationRecord = records.find(
      (record) => record.data.record_type === Operation.RecordType,
    );
    if (!operationRecord) throw new Error('Operation snapshot has no metadata');

    try {
      await dbClient.transactionWrite({
        tableName: resolvedTableName,
        putRequests: records.map((record) => ({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
          ...(record === operationRecord
            ? { conditions: [notExists(SORT_KEY_NAME)] }
            : {}),
        })),
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new OperationAlreadyExistsError(
          operation.resource_id,
          operation.id,
        );
      }
      throw error;
    }

    adoptSnapshotMetadata(operation, 1, 1);
    return operation;
  }

  /**
   * @param {Operation} operation - Replacement snapshot.
   * @param {number} [expectedVersion] - Required current CAS version.
   * @param {{allowRunning?: boolean, expectedActionStates?: Array<{id: string, generation: number, version: number, status: string}>}} [internal] - Internal cancellation override and first-read action preimage.
   * @returns {Promise<Operation>} - Replaced operation.
   */
  async function replaceOperation(
    operation,
    expectedVersion = operation.version,
    internal = {},
  ) {
    validateOperationSnapshot(operation);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new TypeError('replaceOperation requires expectedVersion >= 1');
    }

    const currentRecords = await loadStableOperationRecords(
      dbClient,
      resolvedTableName,
      operation.resource_id,
      operation.id,
    );
    const currentOperationRecord = currentRecords.find((record) =>
      isOperationRecord(record, operation.resource_id, operation.id),
    );
    if (!currentOperationRecord) {
      throw new OperationNotFoundError(operation.resource_id, operation.id);
    }
    if (currentOperationRecord.data.version !== expectedVersion) {
      throw new OperationConflictError(operation.resource_id, operation.id);
    }
    if (operation.revision_id !== currentOperationRecord.data.revision_id) {
      throw new OperationConflictError(
        operation.resource_id,
        operation.id,
        'replacement revision does not match persisted revision',
      );
    }
    const currentStatus = currentOperationRecord.data.status;
    const normallyReplaceable = new Set([
      OperationStatus.PENDING,
      OperationStatus.FAILED,
      OperationStatus.BLOCKED,
    ]);
    if (
      !normallyReplaceable.has(currentStatus) &&
      !(
        internal.allowRunning === true &&
        currentStatus === OperationStatus.RUNNING
      )
    ) {
      throw new Error(
        `Operation ${operation.resource_id}#${operation.id} cannot be replaced from ${currentStatus}`,
      );
    }

    const nextGeneration = Number(currentOperationRecord.data.generation) + 1;
    const nextVersion = expectedVersion + 1;
    const currentBySortKey = new Map(
      currentRecords.map((record) => [record.sort_key, record]),
    );
    const nextActionVersions = new Map(
      operation.getActions().map((action) => {
        const current = currentBySortKey.get(
          getActionSortKey(operation.id, action.id),
        );
        return [action.id, Number(current?.data?.version || 0) + 1];
      }),
    );
    const nextRecords = snapshotRecords(
      operation,
      nextGeneration,
      nextVersion,
      nextActionVersions,
    );
    const nextSortKeys = new Set(nextRecords.map((record) => record.sort_key));
    const expectedActionStateBySortKey = new Map(
      (internal.expectedActionStates || []).map((state) => [
        getActionSortKey(operation.id, state.id),
        state,
      ]),
    );
    if (internal.expectedActionStates) {
      const currentActionRecords = currentRecords.filter((record) =>
        isActionRecord(record, operation.resource_id, operation.id),
      );
      if (
        currentActionRecords.length !== expectedActionStateBySortKey.size ||
        currentActionRecords.some((record) => {
          const expected = expectedActionStateBySortKey.get(record.sort_key);
          return (
            !expected ||
            expected.generation !== record.data.operation_generation ||
            expected.version !== record.data.version ||
            expected.status !== record.data.status
          );
        })
      ) {
        throw new OperationConflictError(operation.resource_id, operation.id);
      }
    }
    const staleActionRecords = currentRecords.filter(
      (record) =>
        isActionRecord(record, operation.resource_id, operation.id) &&
        !nextSortKeys.has(record.sort_key),
    );

    const nextOperationRecord = nextRecords.find(
      (record) => record.data.record_type === Operation.RecordType,
    );
    if (!nextOperationRecord) {
      throw new Error('Operation replacement has no metadata');
    }

    try {
      await dbClient.transactionWrite({
        tableName: resolvedTableName,
        putRequests: nextRecords.map((record) => ({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
          ...(record === nextOperationRecord
            ? {
                conditions: [
                  eq('version', expectedVersion),
                  eq('revision_id', currentOperationRecord.data.revision_id),
                ],
              }
            : {
                conditions:
                  expectedActionStateBySortKey.get(record.sort_key) ||
                  currentBySortKey.get(record.sort_key)
                    ? [
                        eq(
                          'operation_generation',
                          expectedActionStateBySortKey.get(record.sort_key)
                            ?.generation ??
                            currentBySortKey.get(record.sort_key)?.data
                              ?.operation_generation,
                        ),
                        eq(
                          'status',
                          expectedActionStateBySortKey.get(record.sort_key)
                            ?.status ??
                            currentBySortKey.get(record.sort_key)?.data?.status,
                        ),
                        eq(
                          'action_version',
                          expectedActionStateBySortKey.get(record.sort_key)
                            ?.version ??
                            currentBySortKey.get(record.sort_key)?.data
                              ?.version,
                        ),
                      ]
                    : [notExists(SORT_KEY_NAME)],
              }),
        })),
        deleteRequests: staleActionRecords.map((record) => ({
          keyName: KEY_NAME,
          keyValue: operation.resource_id,
          sortKeyName: SORT_KEY_NAME,
          sortKeyValue: record.sort_key,
          conditions: [
            eq('operation_generation', record.data.operation_generation),
            eq('action_version', record.data.version),
            eq('status', record.data.status),
          ],
        })),
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new OperationConflictError(operation.resource_id, operation.id);
      }
      throw error;
    }

    adoptSnapshotMetadata(
      operation,
      nextGeneration,
      nextVersion,
      nextActionVersions,
    );
    return operation;
  }

  /**
   * Reset failed or blocked work through an explicit new graph generation.
   * @param {string} resourceId - App resource id.
   * @param {string} operationId - Operation id.
   * @param {number} [expectedVersion] - Version whose definition was authorized for retry.
   * @returns {Promise<Operation>} - Retried operation.
   */
  async function retryOperation(resourceId, operationId, expectedVersion) {
    const records = await getRecords(resourceId, operationId);
    const operation = records.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (!operation) throw new OperationNotFoundError(resourceId, operationId);
    if (
      expectedVersion !== undefined &&
      operation.version !== expectedVersion
    ) {
      throw new OperationConflictError(resourceId, operationId);
    }

    if (
      operation.status !== OperationStatus.FAILED &&
      operation.status !== OperationStatus.BLOCKED
    ) {
      throw new Error(
        `Operation ${resourceId}#${operationId} cannot be retried from ${operation.status}`,
      );
    }

    operation.status = OperationStatus.PENDING;
    operation.last_updated_at = Date.now();
    operation.cancellation = undefined;
    for (const action of operation.getActions()) {
      if (
        action.status === ActionStatus.FAILED ||
        action.status === ActionStatus.RUNNING
      ) {
        action.status = ActionStatus.PENDING;
        action.last_updated_at = operation.last_updated_at;
        action.error = undefined;
        action.outputs = undefined;
      }
    }

    return await replaceOperation(operation, operation.version);
  }

  /**
   * Durably cancel an operation while retaining its current records.
   * @param {string} resourceId - App resource id.
   * @param {string} operationId - Operation id.
   * @param {{reason?: string, requestedBy?: string}} [metadata] - Operator metadata.
   * @returns {Promise<{operation: Operation, changed: boolean}>} - Cancellation result.
   */
  async function cancelOperation(resourceId, operationId, metadata = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const records = await getRecords(resourceId, operationId);
      const operation = records.operations.find(
        (candidate) => candidate.id === operationId,
      );
      if (!operation) {
        throw new OperationNotFoundError(resourceId, operationId);
      }

      if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
        return { operation, changed: false };
      }

      const expectedActionStates = operation.getActions().map((action) => ({
        id: action.id,
        generation: action.operation_generation,
        version: action.version,
        status: action.status,
      }));
      const cancelledAt = Date.now();
      operation.status = OperationStatus.CANCELLED;
      operation.last_updated_at = cancelledAt;
      operation.cancellation = {
        requested_at: cancelledAt,
        ...(typeof metadata.reason === 'string' && metadata.reason
          ? { reason: metadata.reason }
          : {}),
        ...(typeof metadata.requestedBy === 'string' && metadata.requestedBy
          ? { requested_by: metadata.requestedBy }
          : {}),
      };
      for (const action of operation.getActions()) {
        if (
          action.status === ActionStatus.PENDING ||
          action.status === ActionStatus.RUNNING
        ) {
          action.status = ActionStatus.CANCELLED;
          action.last_updated_at = cancelledAt;
        }
      }

      try {
        await replaceOperation(operation, operation.version, {
          allowRunning: true,
          expectedActionStates,
        });
        return { operation, changed: true };
      } catch (error) {
        if (!(error instanceof OperationConflictError)) throw error;
      }
    }

    throw new OperationConflictError(resourceId, operationId);
  }

  /**
   * @param {string} resourceId - App resource id.
   * @param {string} operationId - Operation id.
   * @returns {Promise<Operation | null>} - Persisted operation, if found.
   */
  async function getOperation(resourceId, operationId) {
    const records = await getRecords(resourceId, operationId);
    return (
      records.operations.find((operation) => operation.id === operationId) ||
      null
    );
  }

  /**
   * @param {Operation} operation - Operation whose status should change.
   * @param {import('../../graph/operation.js').WharfieOperationStatusEnum} newStatus - New status.
   * @param {string} [overrideTableName] - Optional table override.
   * @returns {Promise<boolean>} - Whether the transition was persisted.
   */
  async function updateOperationStatus(
    operation,
    newStatus,
    overrideTableName = resolvedTableName,
  ) {
    if (!OPERATION_TRANSITIONS.get(operation.status)?.has(newStatus)) {
      return false;
    }
    if (
      !Number.isSafeInteger(operation.generation) ||
      operation.generation < 1 ||
      !Number.isSafeInteger(operation.version) ||
      operation.version < 1
    ) {
      return false;
    }

    const nextVersion = operation.version + 1;
    const lastUpdatedAt = Date.now();
    try {
      await dbClient.transactionWrite({
        tableName: overrideTableName,
        updateRequests: [
          {
            keyName: KEY_NAME,
            keyValue: operation.resource_id,
            sortKeyName: SORT_KEY_NAME,
            sortKeyValue: getOperationSortKey(operation.id),
            updates: [
              { property: ['data', 'status'], propertyValue: newStatus },
              {
                property: ['data', 'last_updated_at'],
                propertyValue: lastUpdatedAt,
              },
              {
                property: ['data', 'version'],
                propertyValue: nextVersion,
              },
              { property: ['status'], propertyValue: newStatus },
              { property: ['version'], propertyValue: nextVersion },
            ],
            conditions: [
              eq('status', operation.status),
              eq('generation', operation.generation),
              eq('version', operation.version),
            ],
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }

    operation.status = newStatus;
    operation.version = nextVersion;
    operation.last_updated_at = lastUpdatedAt;
    return true;
  }

  /**
   * @param {string} resourceId - App resource id.
   * @returns {Promise<Operation[]>} - Persisted operations.
   */
  async function getOperations(resourceId) {
    return (await getRecords(resourceId)).operations;
  }

  /**
   * @param {Operation} operation - Operation whose actions should be loaded.
   * @returns {Promise<Action[]>} - Persisted current-generation actions.
   */
  async function getActions(operation) {
    const records = await getRecords(operation.resource_id, operation.id);
    const current = records.operations.find(
      (candidate) => candidate.id === operation.id,
    );
    if (!current || current.generation !== operation.generation) return [];
    return records.actions;
  }

  /**
   * @param {string} resourceId - App resource id.
   * @param {string} operationId - Operation id.
   * @param {string} actionId - Action id.
   * @returns {Promise<Action | null>} - Persisted action, if found.
   */
  async function getAction(resourceId, operationId, actionId) {
    const item = await dbClient.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: resourceId,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: getActionSortKey(operationId, actionId),
      consistentRead: true,
    });
    return item && isActionRecord(item, resourceId, operationId)
      ? Action.fromRecord(item)
      : null;
  }

  /**
   * Persist an action result only while its operation generation is current.
   * @param {Action} action - Complete action snapshot.
   * @param {string} [expectedStatus] - Expected stored action status.
   * @returns {Promise<boolean>} - Whether the snapshot committed.
   */
  async function commitAction(action, expectedStatus = ActionStatus.RUNNING) {
    if (
      !Number.isSafeInteger(action.operation_generation) ||
      action.operation_generation < 1 ||
      !Number.isSafeInteger(action.version) ||
      action.version < 1
    ) {
      return false;
    }
    const nextActionVersion = action.version + 1;
    const record = normalizeRecord(action.toRecord());
    record.data.version = nextActionVersion;
    record.action_version = nextActionVersion;
    try {
      await dbClient.transactionWrite({
        tableName: resolvedTableName,
        conditionChecks: [
          {
            keyName: KEY_NAME,
            keyValue: action.resource_id,
            sortKeyName: SORT_KEY_NAME,
            sortKeyValue: getOperationSortKey(action.operation_id),
            conditions: [
              eq('generation', action.operation_generation),
              eq('status', OperationStatus.RUNNING),
            ],
          },
        ],
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record,
            conditions: [
              eq('operation_generation', action.operation_generation),
              eq('action_version', action.version),
              eq('status', expectedStatus),
            ],
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
    action.version = nextActionVersion;
    return true;
  }

  /**
   * @param {Action} action - Action whose status should change.
   * @param {string} newStatus - New status.
   * @param {string} [overrideTableName] - Optional table override.
   * @returns {Promise<boolean>} - Whether the transition was persisted.
   */
  async function updateActionStatus(
    action,
    newStatus,
    overrideTableName = resolvedTableName,
  ) {
    if (
      action.status !== ActionStatus.PENDING ||
      newStatus !== ActionStatus.RUNNING ||
      !Number.isSafeInteger(action.operation_generation) ||
      action.operation_generation < 1 ||
      !Number.isSafeInteger(action.version) ||
      action.version < 1
    ) {
      return false;
    }
    const nextActionVersion = action.version + 1;
    const lastUpdatedAt = Date.now();
    try {
      await dbClient.transactionWrite({
        tableName: overrideTableName,
        conditionChecks: [
          {
            keyName: KEY_NAME,
            keyValue: action.resource_id,
            sortKeyName: SORT_KEY_NAME,
            sortKeyValue: getOperationSortKey(action.operation_id),
            conditions: [
              eq('generation', action.operation_generation),
              eq('status', OperationStatus.RUNNING),
            ],
          },
        ],
        updateRequests: [
          {
            keyName: KEY_NAME,
            keyValue: action.resource_id,
            sortKeyName: SORT_KEY_NAME,
            sortKeyValue: getActionSortKey(action.operation_id, action.id),
            updates: [
              { property: ['data', 'status'], propertyValue: newStatus },
              {
                property: ['data', 'last_updated_at'],
                propertyValue: lastUpdatedAt,
              },
              {
                property: ['data', 'version'],
                propertyValue: nextActionVersion,
              },
              { property: ['status'], propertyValue: newStatus },
              {
                property: ['action_version'],
                propertyValue: nextActionVersion,
              },
            ],
            conditions: [
              eq('operation_generation', action.operation_generation),
              eq('action_version', action.version),
              eq('status', action.status),
            ],
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
    action.status = ActionStatus.RUNNING;
    action.version = nextActionVersion;
    action.last_updated_at = lastUpdatedAt;
    return true;
  }

  /**
   * @param {Operation} operation - Operation containing the action graph.
   * @param {string} actionId - Exact action id.
   * @returns {Promise<boolean>} - Whether every prerequisite completed.
   */
  async function checkActionPrerequisites(operation, actionId) {
    if (!operation.actions.has(actionId)) return false;
    for (const prerequisiteId of operation.getUpstreamActionIds(actionId)) {
      const item = await dbClient.get({
        tableName: resolvedTableName,
        keyName: KEY_NAME,
        keyValue: operation.resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: getActionSortKey(operation.id, prerequisiteId),
        consistentRead: true,
      });
      if (
        !item ||
        !isActionRecord(item, operation.resource_id, operation.id) ||
        item.data.operation_generation !== operation.generation
      ) {
        return false;
      }
      const prerequisite = Action.fromRecord(item);
      if (
        prerequisite.id !== prerequisiteId ||
        prerequisite.status !== ActionStatus.COMPLETED
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * @param {string} resourceId - App resource id.
   * @param {string} [operationId] - Optional exact operation id.
   * @returns {Promise<{ operations: Operation[]; actions: Action[] }>} - Persisted runs.
   */
  async function getRecords(resourceId, operationId) {
    let items;
    if (operationId) {
      items = await loadStableOperationRecords(
        dbClient,
        resolvedTableName,
        resourceId,
        operationId,
      );
    } else {
      const listed =
        (await dbClient.query({
          tableName: resolvedTableName,
          consistentRead: true,
          keyConditions: [
            pkEq(KEY_NAME, resourceId),
            skBegins(SORT_KEY_NAME, RUN_SORT_KEY_PREFIX),
          ],
        })) || [];
      const operationIds = [
        ...new Set(
          listed
            .filter(
              (record) =>
                record?.data?.record_type === Operation.RecordType &&
                record.data.resource_id === resourceId &&
                typeof record.data.id === 'string' &&
                record.sort_key === getOperationSortKey(record.data.id),
            )
            .map((record) => record.data.id),
        ),
      ].sort(compareStrings);
      const snapshots = await Promise.all(
        operationIds.map((id) =>
          loadStableOperationRecords(
            dbClient,
            resolvedTableName,
            resourceId,
            id,
          ),
        ),
      );
      items = snapshots.flat();
    }

    const operationRecords = items
      .filter(
        (item) =>
          item?.data?.record_type === Operation.RecordType &&
          item.data.resource_id === resourceId &&
          (!operationId || item.data.id === operationId) &&
          item.sort_key === getOperationSortKey(item.data.id),
      )
      .sort((left, right) => compareStrings(left.data.id, right.data.id));

    const currentGenerationByOperation = new Map(
      operationRecords.map((record) => [
        record.data.id,
        record.data.generation,
      ]),
    );
    const actionRecords = items
      .filter(
        (item) =>
          item?.data?.record_type === Action.RecordType &&
          item.data.resource_id === resourceId &&
          (!operationId || item.data.operation_id === operationId) &&
          item.sort_key ===
            getActionSortKey(item.data.operation_id, item.data.id) &&
          item.data.operation_generation ===
            currentGenerationByOperation.get(item.data.operation_id),
      )
      .sort((left, right) => {
        const byOperation = compareStrings(
          left.data.operation_id,
          right.data.operation_id,
        );
        return byOperation || compareStrings(left.data.id, right.data.id);
      });

    return {
      operations: operationRecords.map((operationRecord) =>
        Operation.fromRecords(
          operationRecord,
          actionRecords.filter(
            (actionRecord) =>
              actionRecord.data.operation_id === operationRecord.data.id,
          ),
        ),
      ),
      actions: actionRecords.map((record) => Action.fromRecord(record)),
    };
  }

  return {
    createOperation,
    replaceOperation,
    retryOperation,
    cancelOperation,
    getOperation,
    getOperations,
    getActions,
    getAction,
    commitAction,
    updateActionStatus,
    updateOperationStatus,
    checkActionPrerequisites,
    getRecords,
  };
}
