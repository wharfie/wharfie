import {
  assertExecutionLedgerPayloadStoreScope,
  createExecutionLedger,
  prepareExecutionLedgerCoordinatorAuthorityBinding,
} from '../../lib/db/tables/execution-ledger.js';
import {
  CoordinatorAuthorityStaleError,
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthority,
} from '../../lib/db/tables/coordinator-authority.js';
import { createLedgerServiceOwnership } from '../../lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../lib/payload-store/local.js';
import { assertReplicatedExecutionPayloadStore } from '../../lib/payload-store/replicated.js';
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
import {
  CoordinatorQuiescenceBarrierState,
  createCoordinatorQuiescenceBarrier,
} from '../../lib/db/tables/coordinator-quiescence-barrier.js';
import {
  applicationStateReadinessAuthority,
  applicationStateReadinessDestination,
  validateApplicationStateReadinessRecord,
} from '../../lib/db/tables/application-state-readiness.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../effects/application-state.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { assertDomainSeparatedSha256Id } from '../content-id.js';
import { DYNAMODB_TABLE_RESOURCE_ID_PREFIX } from '../dynamodb-coordinator-authority-topology.js';
import { validateAwsDynamoDBCoordinatorAuthorityTableTopology } from '../dynamodb-coordinator-authority-topology-provider.js';
import { acquireLocalLedgerServiceSession } from '../services/ledger-service.js';
import { createResidentCoordinatorAuthoritySupervisor } from '../services/resident-coordinator-authority.js';
import { reconstructResidentExecutionHistory } from '../services/resident-execution-reconstruction.js';
import { validateResidentReplacementInputReceipt } from '../resident-replacement-input.js';

/**
 * @typedef {import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 */
/**
 * @typedef {Record<string, any> & {storage: Readonly<{kind: string, storeId: string}>, putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}} ExecutionPayloadStore
 */

/**
 * Resolve every ambient storage input once so one command cannot drift between
 * adapters, payload roots, or ownership namespaces while it is running.
 * A still-internal replacement path may supply only the two opaque identities
 * retained in its provisioning receipt. Paths, credentials, Region, table
 * name, timers, and adapter selection remain independently resolved and must
 * agree with that receipt before authority begins.
 * @param {{tableResourceId?: string, payloadStoreId?: string}} [options] - Optional provisioning-retained replacement identities.
 * @returns {Readonly<{adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string, region?: string, residentCoordinatorAuthority?: NonNullable<ReturnType<typeof resolveResidentCoordinatorAuthorityConfiguration>>}>} - One immutable command-local store configuration.
 */
export function resolveExecutionLedgerStoreConfiguration(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Execution-ledger store configuration options must be an object.',
    );
  }
  const allowedOptions = new Set(['tableResourceId', 'payloadStoreId']);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'Execution-ledger store configuration options contain unsupported fields.',
    );
  }
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
      ...(options.tableResourceId === undefined
        ? {}
        : { tableResourceId: options.tableResourceId }),
    });
  return Object.freeze({
    adapterName,
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(
      payloadPath,
      options.payloadStoreId,
    ),
    sessionPath: resolveLedgerServiceSessionPath(controlPath),
    ...(region === undefined ? {} : { region }),
    ...(residentCoordinatorAuthority === undefined
      ? {}
      : { residentCoordinatorAuthority }),
  });
}

/**
 * Resolve the ambient routing and timers around one trusted provisioning
 * receipt. Only the opaque table and payload identities come from the receipt;
 * every locally selected route must agree before a DB client is opened.
 * @param {unknown} value - Candidate resident replacement-input receipt.
 * @returns {ReturnType<typeof resolveExecutionLedgerStoreConfiguration>} - Exact command-local configuration.
 */
export function resolveResidentReplacementExecutionLedgerStoreConfiguration(
  value,
) {
  const receipt = validateResidentReplacementInputReceipt(value);
  const configuration = resolveExecutionLedgerStoreConfiguration({
    tableResourceId: receipt.control.tableResourceId,
    payloadStoreId: receipt.payloadStorage.storeId,
  });
  const authority = configuration.residentCoordinatorAuthority;
  if (
    configuration.adapterName !== receipt.control.adapterName ||
    configuration.region !== receipt.control.region ||
    configuration.tableName !== receipt.control.tableName ||
    configuration.payloadStoreId !== receipt.payloadStorage.storeId ||
    authority?.profile !== receipt.control.profile ||
    authority.adapterName !== receipt.control.adapterName ||
    authority.region !== receipt.control.region ||
    authority.tableName !== receipt.control.tableName ||
    authority.tableResourceId !== receipt.control.tableResourceId
  ) {
    throw new Error(
      'Resident replacement input does not match the locally resolved control and payload routing.',
    );
  }
  return configuration;
}

/**
 * Snapshot a caller-owned configuration once before any dependency can run.
 * @param {Record<string, any>} value - Candidate command-local configuration.
 * @returns {ReturnType<typeof resolveExecutionLedgerStoreConfiguration>} - Immutable shallow routing and policy snapshot.
 */
function snapshotExecutionLedgerStoreConfiguration(value) {
  const authority = value?.residentCoordinatorAuthority;
  const adapterName = value?.adapterName;
  const controlPath = value?.controlPath;
  const tableName = value?.tableName;
  const payloadPath = value?.payloadPath;
  const payloadStoreId = value?.payloadStoreId;
  const sessionPath = value?.sessionPath;
  const region = value?.region;
  const residentCoordinatorAuthority =
    authority === undefined
      ? undefined
      : Object.freeze({
          profile: authority.profile,
          adapterName: authority.adapterName,
          region: authority.region,
          tableName: authority.tableName,
          tableResourceId: authority.tableResourceId,
          renewalIntervalMs: authority.renewalIntervalMs,
          observationWindowMs: authority.observationWindowMs,
        });
  return /** @type {ReturnType<typeof resolveExecutionLedgerStoreConfiguration>} */ (
    Object.freeze({
      adapterName,
      controlPath,
      tableName,
      payloadPath,
      payloadStoreId,
      sessionPath,
      ...(region === undefined ? {} : { region }),
      ...(residentCoordinatorAuthority === undefined
        ? {}
        : { residentCoordinatorAuthority }),
    })
  );
}

/**
 * Compare one validated receipt with the exact ledger/payload/runtime scope
 * that will consume it. This executes before topology proof or authority.
 * @param {{receipt: ReturnType<typeof validateResidentReplacementInputReceipt>, appId: string, currentRevisionId: string, ledger: ExecutionLedgerStore, context: Record<string, any>, configuration: Record<string, any>}} input - Captured replacement startup scope.
 * @returns {void}
 */
function assertResidentReplacementInputScope(input) {
  const { receipt, appId, currentRevisionId, ledger, context, configuration } =
    input;
  const authority = configuration.residentCoordinatorAuthority;
  const payloadStore = context.payloadStore;
  if (
    receipt.appId !== appId ||
    receipt.currentRevisionId !== currentRevisionId
  ) {
    throw new Error(
      'Resident replacement input does not authorize this application revision.',
    );
  }
  if (
    configuration.adapterName !== receipt.control.adapterName ||
    configuration.region !== receipt.control.region ||
    configuration.tableName !== receipt.control.tableName ||
    configuration.payloadStoreId !== receipt.payloadStorage.storeId ||
    authority?.profile !== receipt.control.profile ||
    authority.adapterName !== receipt.control.adapterName ||
    authority.region !== receipt.control.region ||
    authority.tableName !== receipt.control.tableName ||
    authority.tableResourceId !== receipt.control.tableResourceId
  ) {
    throw new Error(
      'Resident replacement input does not match the captured control routing.',
    );
  }
  assertReplicatedExecutionPayloadStore(
    payloadStore,
    'Resident replacement execution payload store',
  );
  if (
    payloadStore?.storage?.kind !== receipt.payloadStorage.kind ||
    payloadStore.storage.storeId !== receipt.payloadStorage.storeId ||
    payloadStore.distribution?.kind !==
      receipt.payloadStorage.distribution.kind ||
    payloadStore.distribution.distributionId !==
      receipt.payloadStorage.distribution.distributionId ||
    payloadStore.distribution.storeId !==
      receipt.payloadStorage.distribution.storeId
  ) {
    throw new Error(
      'Resident replacement input does not match the exact replicated payload store.',
    );
  }
  assertExecutionLedgerPayloadStoreScope(
    ledger,
    context.db,
    context.tableName,
    payloadStore,
  );
}

/**
 * Require the separate application-state preparation to return the exact
 * ADOPTED destination pinned by the trusted replacement receipt.
 * @param {unknown} value - Candidate readiness record returned by preparation.
 * @param {ReturnType<typeof validateResidentReplacementInputReceipt>} receipt - Captured replacement receipt.
 * @param {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken} authority - Exact replacement authority that must own readiness.
 * @returns {ReturnType<typeof validateApplicationStateReadinessRecord>} - Exact ADOPTED readiness record.
 */
function validateResidentReplacementApplicationState(
  value,
  receipt,
  authority,
) {
  const readiness = validateApplicationStateReadinessRecord(value);
  const destination = applicationStateReadinessDestination(readiness);
  const readinessAuthority = applicationStateReadinessAuthority(readiness);
  const expected = receipt.applicationStateDestination;
  if (
    readiness.status !== 'ADOPTED' ||
    readinessAuthority.schemaVersion !== authority.schemaVersion ||
    readinessAuthority.appId !== authority.appId ||
    readinessAuthority.coordinatorId !== authority.coordinatorId ||
    readinessAuthority.authorityId !== authority.authorityId ||
    readinessAuthority.epoch !== authority.epoch ||
    destination.kind !== expected.kind ||
    destination.version !== expected.version ||
    destination.bindingId !== expected.bindingId ||
    destination.configuration.provider !== expected.configuration.provider ||
    destination.configuration.storeId !== expected.configuration.storeId ||
    destination.configuration.tableName !== expected.configuration.tableName ||
    destination.configuration.namespace !== expected.configuration.namespace
  ) {
    throw new Error(
      'Resident replacement application-state handoff did not adopt the receipt destination under the exact replacement authority.',
    );
  }
  return readiness;
}

/**
 * Open the durable control store for one operation and always close it.
 * Read-only mode is used by inspection and recovery preflight so exact missing
 * lookups cannot materialize a local control store.
 * @template T
 * @param {(ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, sessionPath: string, readOnly: boolean, payloadStore: ExecutionPayloadStore}) => Promise<T>} handler - Work to run against the ledger.
 * @param {{readOnly?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, payloadStore?: ExecutionPayloadStore}} [options] - Store access options and optional exact replicated payload store.
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
    const candidatePayloadStore =
      options.payloadStore === undefined
        ? createLocalExecutionPayloadStore({
            path: configuration.payloadPath,
            storeId: configuration.payloadStoreId,
          })
        : options.payloadStore;
    if (options.payloadStore !== undefined) {
      assertReplicatedExecutionPayloadStore(
        candidatePayloadStore,
        'Injected execution payload store',
      );
    }
    if (
      !candidatePayloadStore ||
      typeof candidatePayloadStore !== 'object' ||
      typeof candidatePayloadStore.putJson !== 'function' ||
      typeof candidatePayloadStore.readBytes !== 'function' ||
      candidatePayloadStore.storage?.storeId !== configuration.payloadStoreId
    ) {
      throw new TypeError(
        'Execution ledger requires an exact configured immutable payload store.',
      );
    }
    const payloadStore = /** @type {ExecutionPayloadStore} */ (
      candidatePayloadStore
    );
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
      payloadStore,
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
  const expectedTableResourceId = authorityConfiguration?.tableResourceId;
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
  let expectedTableResourceIdIsValid = true;
  try {
    assertDomainSeparatedSha256Id(
      expectedTableResourceId,
      DYNAMODB_TABLE_RESOURCE_ID_PREFIX,
      'Resident DynamoDB coordinator authority tableResourceId',
    );
  } catch {
    expectedTableResourceIdIsValid = false;
  }
  if (
    configurationAdapterName !== 'dynamodb' ||
    authorityProfile !== DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE ||
    authorityAdapterName !== 'dynamodb' ||
    typeof configurationRegion !== 'string' ||
    configurationRegion !== authorityRegion ||
    configurationTableName !== authorityTableName ||
    contextTableName !== authorityTableName ||
    !expectedTableResourceIdIsValid ||
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

  const topology = await validateTopology({
    db: contextDB,
    tableName: authorityTableName,
    region: authorityRegion,
    expectedTableResourceId,
  });
  if (topology?.tableResourceId !== expectedTableResourceId) {
    throw new Error(
      'Resident DynamoDB coordinator authority topology does not match the configured table resource.',
    );
  }

  // Construct the authority protocol only after the exact data client has
  // pinned and matched the shared resource identity. No authority request can
  // be issued against a same-named table in another account or incarnation.
  const protocol = createProtocol({
    db: contextDB,
    tableName: authorityTableName,
    observationWindowMs,
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
 * Compose the still-internal DynamoDB resident startup boundary. Complete
 * source-free history reconstruction and ready-work convergence happen first;
 * the caller's separate application-state handoff happens second; only then
 * may its resident dispatcher body start. The existing supervisor continues
 * renewing authority for the entire body and aborts the shared signal on
 * loss. This helper deliberately has no public service or CLI call site and
 * does not lift the LMDB-only resident product gates.
 * @template T
 * @template P
 * @param {{appId: string, currentRevisionId: string, coordinatorId: string, ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, tableName: string, readOnly: boolean, payloadStore: Record<string, any>}, configuration: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, replacementInput: unknown, signal?: AbortSignal, prepareApplicationState: (ledger: ExecutionLedgerStore, session: Readonly<Record<string, any>>) => Promise<P> | P, handler: (ledger: ExecutionLedgerStore, session: Readonly<Record<string, any>>) => Promise<T> | T}} options - Exact reconstructed resident authority session.
 * @param {{validateTopology?: typeof validateAwsDynamoDBCoordinatorAuthorityTableTopology, createProtocol?: typeof createDynamoDBCoordinatorAuthorityProtocol, createSupervisor?: typeof createResidentCoordinatorAuthoritySupervisor, reconstructHistory?: typeof reconstructResidentExecutionHistory, createAdmissionBarrier?: typeof createCoordinatorQuiescenceBarrier}} [dependencies] - Focused internal seams.
 * @returns {Promise<T>} - Resident body result after supervised drain and release.
 */
export async function withReconstructedExecutionLedgerResidentAuthority(
  options,
  dependencies = {},
) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority requires options.',
    );
  }
  const allowedOptions = new Set([
    'appId',
    'currentRevisionId',
    'coordinatorId',
    'ledger',
    'context',
    'configuration',
    'replacementInput',
    'signal',
    'prepareApplicationState',
    'handler',
  ]);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority options contain unsupported fields.',
    );
  }
  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    Array.isArray(dependencies)
  ) {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority dependencies must be an object.',
    );
  }
  const allowedDependencies = new Set([
    'validateTopology',
    'createProtocol',
    'createSupervisor',
    'reconstructHistory',
    'createAdmissionBarrier',
  ]);
  if (Object.keys(dependencies).some((key) => !allowedDependencies.has(key))) {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority dependencies contain unsupported fields.',
    );
  }

  // Snapshot every caller-controlled port before topology, authority, or
  // reconstruction can invoke external code.
  const appId = options.appId;
  const currentRevisionId = options.currentRevisionId;
  const coordinatorId = options.coordinatorId;
  const ledger = options.ledger;
  const inputContext = options.context;
  const context = Object.freeze({
    db: inputContext?.db,
    adapterName: inputContext?.adapterName,
    tableName: inputContext?.tableName,
    readOnly: inputContext?.readOnly,
    payloadStore: inputContext?.payloadStore,
  });
  const configuration = snapshotExecutionLedgerStoreConfiguration(
    options.configuration,
  );
  const replacementInput = validateResidentReplacementInputReceipt(
    options.replacementInput,
  );
  const signal = options.signal;
  const prepareApplicationState = options.prepareApplicationState;
  const handler = options.handler;
  const dependencyValidateTopology = dependencies.validateTopology;
  const dependencyCreateProtocol = dependencies.createProtocol;
  const dependencyCreateSupervisor = dependencies.createSupervisor;
  const dependencyReconstructHistory = dependencies.reconstructHistory;
  const dependencyCreateAdmissionBarrier = dependencies.createAdmissionBarrier;
  const reconstructHistory =
    dependencyReconstructHistory ?? reconstructResidentExecutionHistory;
  const createAdmissionBarrier =
    dependencyCreateAdmissionBarrier ?? createCoordinatorQuiescenceBarrier;
  const authorityDependencies = {
    ...(dependencyValidateTopology === undefined
      ? {}
      : { validateTopology: dependencyValidateTopology }),
    ...(dependencyCreateProtocol === undefined
      ? {}
      : { createProtocol: dependencyCreateProtocol }),
    ...(dependencyCreateSupervisor === undefined
      ? {}
      : { createSupervisor: dependencyCreateSupervisor }),
  };

  assertApplicationRevisionId(
    currentRevisionId,
    'reconstructed resident currentRevisionId',
  );
  assertResidentReplacementInputScope({
    receipt: replacementInput,
    appId,
    currentRevisionId,
    ledger,
    context,
    configuration,
  });
  if (typeof reconstructHistory !== 'function') {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority.reconstructHistory must be a function.',
    );
  }
  if (typeof createAdmissionBarrier !== 'function') {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority.createAdmissionBarrier must be a function.',
    );
  }
  if (typeof prepareApplicationState !== 'function') {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority.prepareApplicationState must be a function.',
    );
  }
  if (typeof handler !== 'function') {
    throw new TypeError(
      'withReconstructedExecutionLedgerResidentAuthority.handler must be a function.',
    );
  }

  return await withExecutionLedgerResidentCoordinatorAuthority(
    {
      appId,
      coordinatorId,
      ledger,
      context,
      configuration,
      ...(signal === undefined ? {} : { signal }),
      handler: async (boundLedger, session) => {
        // Capture the exact freshly constructed ledger assertion before any
        // injected startup phase can mutate its public method surface.
        const assertCurrentCoordinatorAuthority =
          boundLedger.assertCurrentCoordinatorAuthority.bind(boundLedger);
        const currentAuthority = assertCoordinatorAuthorityToken(
          session.coordinatorAuthority,
          'reconstructed resident coordinator authority',
        );
        const admissionBarrier = createAdmissionBarrier({
          db: context.db,
          tableName: context.tableName,
        });
        const getAdmissionBarrierMethod = admissionBarrier?.get;
        const closeAdmissionBarrierMethod = admissionBarrier?.close;
        const adoptAdmissionBarrierMethod = admissionBarrier?.adopt;
        const reopenAdmissionBarrierMethod = admissionBarrier?.reopen;
        if (
          typeof getAdmissionBarrierMethod !== 'function' ||
          typeof closeAdmissionBarrierMethod !== 'function' ||
          typeof adoptAdmissionBarrierMethod !== 'function' ||
          typeof reopenAdmissionBarrierMethod !== 'function'
        ) {
          throw new TypeError(
            'Resident admission barrier must expose get(), close(), adopt(), and reopen().',
          );
        }
        // Bind every barrier method before reconstruction or application-state
        // callbacks can replace the factory result's public method surface.
        const getAdmissionBarrier =
          getAdmissionBarrierMethod.bind(admissionBarrier);
        const closeAdmissionBarrier =
          closeAdmissionBarrierMethod.bind(admissionBarrier);
        const adoptAdmissionBarrier =
          adoptAdmissionBarrierMethod.bind(admissionBarrier);
        const reopenAdmissionBarrier =
          reopenAdmissionBarrierMethod.bind(admissionBarrier);
        const predecessor = await getAdmissionBarrier({ appId });
        const predecessorVersion = predecessor?.version ?? 0;
        const predecessorAuthority = predecessor?.authority;
        const predecessorOwnedByCurrentAuthority =
          predecessorAuthority !== undefined &&
          predecessorAuthority.schemaVersion ===
            currentAuthority.schemaVersion &&
          predecessorAuthority.appId === currentAuthority.appId &&
          predecessorAuthority.coordinatorId ===
            currentAuthority.coordinatorId &&
          predecessorAuthority.authorityId === currentAuthority.authorityId &&
          predecessorAuthority.epoch === currentAuthority.epoch;
        let closedBarrier;
        if (
          predecessor?.state === CoordinatorQuiescenceBarrierState.CLOSED &&
          predecessorOwnedByCurrentAuthority
        ) {
          // A repeated startup callback under the exact authority retains its
          // already-closed generation without advancing or rewriting it.
          closedBarrier = predecessor;
        } else if (
          predecessor?.state === CoordinatorQuiescenceBarrierState.CLOSED
        ) {
          const adoptResult = await adoptAdmissionBarrier({
            authority: currentAuthority,
            requestId: `resident-quiescence:adopt:${currentAuthority.authorityId}:predecessor:${predecessorVersion}`,
            predecessor,
          });
          closedBarrier = adoptResult?.barrier;
        } else {
          const closeResult = await closeAdmissionBarrier({
            authority: currentAuthority,
            requestId: `resident-quiescence:close:${currentAuthority.authorityId}:predecessor:${predecessorVersion}`,
            predecessor,
          });
          closedBarrier = closeResult?.barrier;
        }
        if (
          !closedBarrier ||
          closedBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED
        ) {
          throw new TypeError(
            'Resident admission barrier selection must return one exact CLOSED barrier.',
          );
        }
        if (session.signal.aborted) {
          throw (
            session.signal.reason ??
            new Error('Resident authority ended after admission closed.')
          );
        }
        const reconstruction = await reconstructHistory({
          ledger: boundLedger,
          appId,
          currentRevisionId,
          coordinatorAuthority: currentAuthority,
          signal: session.signal,
        });
        if (session.signal.aborted) {
          throw (
            session.signal.reason ??
            new Error('Resident authority ended after reconstruction.')
          );
        }
        const reconstructionSession = Object.freeze({
          ...session,
          replacementInput,
          reconstruction,
        });
        const preparedApplicationState = await prepareApplicationState(
          boundLedger,
          reconstructionSession,
        );
        if (session.signal.aborted) {
          throw (
            session.signal.reason ??
            new Error(
              'Resident authority ended during application-state preparation.',
            )
          );
        }
        const applicationState = validateResidentReplacementApplicationState(
          preparedApplicationState,
          replacementInput,
          currentAuthority,
        );
        await assertCurrentCoordinatorAuthority();
        await reopenAdmissionBarrier({
          authority: currentAuthority,
          requestId: `resident-quiescence:reopen:${currentAuthority.authorityId}:predecessor:${closedBarrier.version}`,
          predecessor: closedBarrier,
        });
        await assertCurrentCoordinatorAuthority();
        if (session.signal.aborted) {
          throw (
            session.signal.reason ??
            new Error('Resident authority ended before dispatcher admission.')
          );
        }
        return await handler(
          boundLedger,
          Object.freeze({
            ...reconstructionSession,
            applicationState,
          }),
        );
      },
    },
    authorityDependencies,
  );
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
