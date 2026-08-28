import {
  createExecutionLedger,
  prepareExecutionLedgerCoordinatorAuthorityBinding,
} from '../../lib/db/tables/execution-ledger.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
} from '../../lib/db/tables/coordinator-authority.js';
import { createLedgerServiceOwnership } from '../../lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../lib/payload-store/local.js';
import {
  DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
  createControlDBClient,
  resolveControlAdapterName,
  resolveControlStoreRegion,
  resolveControlStorePath,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveExecutionPayloadStoreId,
  resolveLedgerServiceSessionPath,
  resolveResidentCoordinatorAuthorityConfiguration,
} from '../../lib/config/db.js';
import { createDynamoDBCoordinatorAuthorityProtocol } from '../../lib/db/tables/dynamodb-coordinator-authority.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../effects/application-state.js';
import { validateAwsDynamoDBCoordinatorAuthorityTableTopology } from '../dynamodb-coordinator-authority-topology-provider.js';
import { acquireLocalLedgerServiceSession } from '../services/ledger-service.js';
import { createResidentCoordinatorAuthoritySupervisor } from '../services/resident-coordinator-authority.js';

/**
 * @typedef {import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 */

/**
 * Resolve every ambient storage input once so one command cannot drift between
 * adapters, payload roots, or ownership namespaces while it is running.
 * @returns {Readonly<{adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string, region?: string, residentCoordinatorAuthority?: NonNullable<ReturnType<typeof resolveResidentCoordinatorAuthorityConfiguration>>}>} - One immutable command-local store configuration.
 */
export function resolveExecutionLedgerStoreConfiguration() {
  const adapterName = resolveControlAdapterName();
  const controlPath = resolveControlStorePath();
  const tableName = resolveExecutionLedgerTableName();
  const payloadPath = resolveExecutionPayloadPath(controlPath);
  const region = resolveControlStoreRegion(adapterName);
  const residentCoordinatorAuthority =
    resolveResidentCoordinatorAuthorityConfiguration({
      adapterName,
      tableName,
      ...(region === undefined ? {} : { region }),
    });
  return Object.freeze({
    adapterName,
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: resolveLedgerServiceSessionPath(controlPath),
    ...(region === undefined ? {} : { region }),
    ...(residentCoordinatorAuthority === undefined
      ? {}
      : { residentCoordinatorAuthority }),
  });
}

/**
 * Open the durable control store for one operation and always close it.
 * Read-only mode is used by inspection and recovery preflight so exact missing
 * lookups cannot materialize a local control store.
 * @template T
 * @param {(ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, sessionPath: string, readOnly: boolean}) => Promise<T>} handler - Work to run against the ledger.
 * @param {{readOnly?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} [options] - Store access options.
 * @returns {Promise<T>} - Handler result.
 */
export async function withExecutionLedger(handler, options = {}) {
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  const readOnly = options.readOnly === true;
  /** @type {import('../../lib/db/base.js').DBClient | undefined} */
  let db;
  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let handlerError;
  let handlerFailed = false;

  try {
    db = await createControlDBClient(configuration.adapterName, {
      path: configuration.controlPath,
      readOnly,
      ...(configuration.region === undefined
        ? {}
        : { region: configuration.region }),
    });
    const payloadStore = createLocalExecutionPayloadStore({
      path: configuration.payloadPath,
      storeId: configuration.payloadStoreId,
    });
    const ledger = createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: readOnly
        ? {
            ...payloadStore,
            putJson: async () => {
              throw new Error(
                'A read-only execution payload store cannot publish payloads.',
              );
            },
          }
        : payloadStore,
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    });
    result = await handler(ledger, {
      db,
      adapterName: configuration.adapterName,
      controlPath: configuration.controlPath,
      tableName: configuration.tableName,
      sessionPath: configuration.sessionPath,
      readOnly,
    });
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }

  /** @type {unknown} */
  let closeError;
  let closeFailed = false;
  try {
    await db?.close?.();
  } catch (error) {
    closeFailed = true;
    closeError = error;
  }
  if (handlerFailed && closeFailed) {
    throw new AggregateError(
      [handlerError, closeError],
      'Execution-ledger operation and control-store close both failed.',
    );
  }
  if (handlerFailed) throw handlerError;
  if (closeFailed) throw closeError;
  return /** @type {T} */ (result);
}

/**
 * Hold one explicit app-scoped coordinator authority while a caller uses an
 * authority-bound view of an already-open execution ledger. A stale release
 * after deliberate takeover is successful relinquishment from this process's
 * perspective; every earlier or concurrent mutation was still fenced in the
 * same durable transaction.
 * @template T
 * @param {{appId: string, coordinatorId: string, ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, tableName: string, readOnly: boolean}, handler: (ledger: ExecutionLedgerStore, authority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot) => Promise<T>}} options - Authority-scoped operation.
 * @returns {Promise<T>} - Handler result after graceful authority release.
 */
export async function withExecutionLedgerCoordinatorAuthority(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'withExecutionLedgerCoordinatorAuthority requires options.',
    );
  }
  if (options.context?.readOnly) {
    throw new Error(
      'A read-only execution ledger cannot acquire coordinator authority.',
    );
  }
  if (typeof options.ledger?.bindCoordinatorAuthority !== 'function') {
    throw new TypeError(
      'withExecutionLedgerCoordinatorAuthority requires a bindable execution ledger.',
    );
  }
  if (typeof options.handler !== 'function') {
    throw new TypeError(
      'withExecutionLedgerCoordinatorAuthority.handler must be a function.',
    );
  }

  const authorityStore = createCoordinatorAuthority({
    db: options.context.db,
    tableName: options.context.tableName,
  });
  const acquisition = await authorityStore.acquire({
    appId: options.appId,
    coordinatorId: options.coordinatorId,
    requestId: `coordinator-authority:acquire:${options.coordinatorId}`,
  });
  const authority = acquisition.authority;

  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let handlerError;
  let handlerFailed = false;
  try {
    const boundLedger = options.ledger.bindCoordinatorAuthority(authority);
    result = await options.handler(boundLedger, authority);
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }

  /** @type {unknown} */
  let releaseError;
  try {
    await authorityStore.release({
      authority,
      requestId: `coordinator-authority:release:${options.coordinatorId}`,
    });
  } catch (error) {
    if (!(error instanceof CoordinatorAuthorityStaleError)) {
      releaseError = error;
    }
  }
  if (handlerFailed && releaseError !== undefined) {
    throw new AggregateError(
      [handlerError, releaseError],
      'Coordinator-authoritative execution-ledger operation and authority release both failed.',
    );
  }
  if (handlerFailed) throw handlerError;
  if (releaseError !== undefined) throw releaseError;
  return /** @type {T} */ (result);
}

/**
 * Run one explicitly configured DynamoDB resident authority session. This is
 * the internal lifecycle seam for automatic RVN replacement; it deliberately
 * does not change the short-lived foreground/operator helper above or lift the
 * LMDB-only resident product gates. Topology must be proved before acquisition,
 * observation, renewal, takeover, or handler execution can begin.
 * @template T
 * @param {{appId: string, coordinatorId: string, ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, tableName: string, readOnly: boolean}, configuration: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, signal?: AbortSignal, handler: (ledger: ExecutionLedgerStore, session: Readonly<{authority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot, coordinatorAuthority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken, signal: AbortSignal, topology: Readonly<Record<string, any>>}>) => Promise<T> | T}} options - Exact resident authority session.
 * @param {{validateTopology?: typeof validateAwsDynamoDBCoordinatorAuthorityTableTopology, createProtocol?: typeof createDynamoDBCoordinatorAuthorityProtocol, createSupervisor?: typeof createResidentCoordinatorAuthoritySupervisor}} [dependencies] - Focused construction seams.
 * @returns {Promise<T>} - Resident handler result after drain and release.
 */
export async function withExecutionLedgerResidentCoordinatorAuthority(
  options,
  dependencies = {},
) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority requires options.',
    );
  }
  const allowedOptions = new Set([
    'appId',
    'coordinatorId',
    'ledger',
    'context',
    'configuration',
    'signal',
    'handler',
  ]);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority options contain unsupported fields.',
    );
  }

  // Snapshot the complete trusted run input once. No later dependency or
  // caller-owned accessor may split validation, topology proof, authority
  // mutation, and ledger binding across different objects or routing values.
  const appId = options.appId;
  const coordinatorId = options.coordinatorId;
  const ledger = options.ledger;
  const context = options.context;
  const contextDB = context?.db;
  const contextAdapterName = context?.adapterName;
  const contextTableName = context?.tableName;
  const contextReadOnly = context?.readOnly;
  const configuration = options.configuration;
  const configurationAdapterName = configuration?.adapterName;
  const configurationRegion = configuration?.region;
  const configurationTableName = configuration?.tableName;
  const authorityConfiguration = configuration?.residentCoordinatorAuthority;
  const authorityProfile = authorityConfiguration?.profile;
  const authorityAdapterName = authorityConfiguration?.adapterName;
  const authorityRegion = authorityConfiguration?.region;
  const authorityTableName = authorityConfiguration?.tableName;
  const renewalIntervalMs = authorityConfiguration?.renewalIntervalMs;
  const observationWindowMs = authorityConfiguration?.observationWindowMs;
  const signal = options.signal;
  const handler = options.handler;

  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    Array.isArray(dependencies)
  ) {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority dependencies must be an object.',
    );
  }
  const allowedDependencies = new Set([
    'validateTopology',
    'createProtocol',
    'createSupervisor',
  ]);
  if (Object.keys(dependencies).some((key) => !allowedDependencies.has(key))) {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority dependencies contain unsupported fields.',
    );
  }
  const dependencyValidateTopology = dependencies.validateTopology;
  const dependencyCreateProtocol = dependencies.createProtocol;
  const dependencyCreateSupervisor = dependencies.createSupervisor;
  const validateTopology =
    dependencyValidateTopology ??
    validateAwsDynamoDBCoordinatorAuthorityTableTopology;
  const createProtocol =
    dependencyCreateProtocol ?? createDynamoDBCoordinatorAuthorityProtocol;
  const createSupervisor =
    dependencyCreateSupervisor ?? createResidentCoordinatorAuthoritySupervisor;
  if (
    typeof validateTopology !== 'function' ||
    typeof createProtocol !== 'function' ||
    typeof createSupervisor !== 'function'
  ) {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority dependencies must be functions.',
    );
  }
  if (contextReadOnly) {
    throw new Error(
      'A read-only execution ledger cannot start resident coordinator authority.',
    );
  }
  if (contextAdapterName !== 'dynamodb') {
    throw new Error(
      'Resident automatic coordinator replacement requires the DynamoDB control adapter.',
    );
  }
  if (typeof ledger?.bindCoordinatorAuthority !== 'function') {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority requires a bindable execution ledger.',
    );
  }
  if (typeof handler !== 'function') {
    throw new TypeError(
      'withExecutionLedgerResidentCoordinatorAuthority.handler must be a function.',
    );
  }
  if (
    configurationAdapterName !== 'dynamodb' ||
    authorityProfile !== DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE ||
    authorityAdapterName !== 'dynamodb' ||
    typeof configurationRegion !== 'string' ||
    configurationRegion !== authorityRegion ||
    configurationTableName !== authorityTableName ||
    contextTableName !== authorityTableName ||
    typeof renewalIntervalMs !== 'number' ||
    typeof observationWindowMs !== 'number'
  ) {
    throw new Error(
      'Resident DynamoDB coordinator authority requires one exact resolved profile, Region, and execution-ledger table.',
    );
  }

  const bindCoordinatorAuthority =
    prepareExecutionLedgerCoordinatorAuthorityBinding(
      ledger,
      contextDB,
      authorityTableName,
    );

  // Construction validates the branded data client before any provider
  // topology request or authority mutation is attempted.
  const protocol = createProtocol({
    db: contextDB,
    tableName: authorityTableName,
    observationWindowMs,
  });
  const topology = await validateTopology({
    db: contextDB,
    tableName: authorityTableName,
    region: authorityRegion,
  });
  const supervisor = createSupervisor({
    protocol,
    appId,
    coordinatorId,
    renewalIntervalMs,
  });
  if (typeof supervisor?.run !== 'function') {
    throw new TypeError(
      'Resident coordinator authority supervisor must expose run().',
    );
  }
  return await supervisor.run({
    ...(signal === undefined ? {} : { signal }),
    handler: async (session) => {
      const boundLedger = bindCoordinatorAuthority(
        session.coordinatorAuthority,
      );
      return await handler(
        boundLedger,
        Object.freeze({ ...session, topology }),
      );
    },
  });
}

/**
 * Hold the resident-service ownership fence while a local manual mutation
 * uses an LMDB-backed control volume. Other adapters have no local exclusion
 * here: callers must separately bind coordinator authority for transactional
 * fencing and retain any required operator confirmations. That authority is
 * not a provider lease or proof that physical work has stopped.
 * @template T
 * @param {{appId: string, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, sessionPath: string, readOnly: boolean}, handler: (localOwner?: Record<string, any>) => Promise<T>}} options - Ownership-scoped mutation.
 * @returns {Promise<T>} - Handler result.
 */
export async function withLocalLedgerServiceMutationOwnership(options) {
  if (options.context.readOnly) {
    throw new Error(
      'A read-only execution ledger cannot acquire mutation ownership.',
    );
  }
  if (options.context.adapterName !== 'lmdb') {
    return await options.handler();
  }

  const ownership = createLedgerServiceOwnership({
    db: options.context.db,
    tableName: options.context.tableName,
  });
  const localSession = await acquireLocalLedgerServiceSession({
    appId: options.appId,
    ownership,
    sessionRoot: options.context.sessionPath,
  });

  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let handlerError;
  let handlerFailed = false;
  try {
    // The held owner session is deliberately passed only to the mutation that
    // acquired it. This lets a foreground runner host authenticated local
    // commands on a distinct endpoint without teaching unrelated operators
    // how to acquire or mutate another owner's control volume.
    result = await options.handler(localSession);
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }

  /** @type {unknown} */
  let releaseError;
  let releaseFailed = false;
  try {
    await localSession.release();
  } catch (error) {
    releaseFailed = true;
    releaseError = error;
  }
  if (handlerFailed && releaseFailed) {
    throw new AggregateError(
      [handlerError, releaseError],
      'Local ledger-service mutation and ownership release both failed.',
    );
  }
  if (handlerFailed) throw handlerError;
  if (releaseFailed) throw releaseError;
  return /** @type {T} */ (result);
}

export default withExecutionLedger;
