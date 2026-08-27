/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal catalog closures keep their types compact. */

import { APPLICATION_STATE_TABLE_NAME } from '../../lib/config/db.js';
import { assertDBClientAdapterIdentity } from '../../lib/db/base.js';
import {
  ApplicationStateStoreIdentityError,
  createApplicationStateTable,
} from '../../lib/db/tables/application-state.js';
import { validateApplicationStateCoordinatorAuthorityRecord } from '../../lib/db/tables/application-state-authority.js';
import { assertCoordinatorAuthorityToken } from '../../lib/db/tables/coordinator-authority.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { assertDomainSeparatedSha256Id } from '../content-id.js';
import { executeManagedEffect } from '../managed-effect.js';
import { assertLogicalId } from '../logical-id.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_BINDING_ID,
  APPLICATION_STATE_CAPABILITY,
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
  createApplicationStateEffectContractDigest,
  createApplicationStateNotAppliedEvidence,
  createApplicationStateOutcomeFromReceipt,
  normalizeApplicationStateDestination,
  normalizeApplicationStatePutIfAbsentRequest,
} from './application-state.js';

const CATALOG_OPTION_KEYS = new Set([
  'db',
  'appId',
  'adapterName',
  'tableName',
  'allowTestAdapter',
  'createStoreId',
  'coordinatorAuthority',
  'expectedStoreId',
  'destinationAuthorityFloor',
]);
const RECOVERY_CATALOG_OPTION_KEYS = new Set([
  'db',
  'appId',
  'adapterName',
  'tableName',
  'allowTestAdapter',
]);
const RECONCILIATION_CATALOG_OPTION_KEYS = new Set([
  ...RECOVERY_CATALOG_OPTION_KEYS,
  'coordinatorAuthority',
  'expectedStoreId',
  'destinationAuthorityFloor',
]);
const FROZEN_REPLAY_PROPERTIES = [
  ...APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
];
Object.freeze(FROZEN_REPLAY_PROPERTIES);

/**
 * @typedef BuiltinManagedEffectAdapter
 * @property {{id: string, version: number}} descriptor - Exact adapter descriptor.
 * @property {{kind: string, version: number, bindingId: string, configuration: Record<string, any>}} destination - Exact destination.
 * @property {{kind: string, version: number}} verifier - Evidence verifier descriptor.
 * @property {string[]} substantiatedReplayProperties - Guaranteed replay properties.
 * @property {(input: Record<string, any>) => Promise<Readonly<Record<string, any>>>} execute - Trusted physical adapter.
 */

/**
 * @typedef BuiltinManagedEffectCatalog
 * @property {string} storeId - Physical application-state store identity.
 * @property {Readonly<Record<string, any>>} destination - Credential-free retained destination.
 * @property {typeof APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS} effectEvidenceVerifiers - Pure ledger registrations.
 * @property {(request: Record<string, any>) => Readonly<BuiltinManagedEffectAdapter>} resolve - Closed adapter selection.
 * @property {(input: {destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}) => Promise<Readonly<Record<string, any>> | null>} recoverOutcome - Receipt recovery probe.
 * @property {(destinationEffectId: string) => Promise<Readonly<Record<string, any>> | null>} readReceipt - Direct verified receipt lookup.
 */

/**
 * @typedef BuiltinManagedEffectRecoveryCatalog
 * @property {string} storeId - Existing physical application-state store identity.
 * @property {Readonly<Record<string, any>>} destination - Credential-free retained destination.
 * @property {typeof APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS} effectEvidenceVerifiers - Pure ledger registrations.
 * @property {(input: {destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}) => Promise<Readonly<Record<string, any>> | null>} recoverOutcome - Receipt recovery probe.
 * @property {(destinationEffectId: string) => Promise<Readonly<Record<string, any>> | null>} readReceipt - Direct verified receipt lookup.
 */

/**
 * @typedef BuiltinManagedEffectReconciliationCatalog
 * @property {string} storeId - Existing physical application-state store identity.
 * @property {Readonly<Record<string, any>>} destination - Credential-free retained destination.
 * @property {typeof APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS} effectEvidenceVerifiers - Pure ledger registrations.
 * @property {(input: {destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}) => Promise<Readonly<{kind: 'outcome', outcome: Readonly<Record<string, any>>} | {kind: 'not-applied', evidence: Readonly<Record<string, any>>}>>} reconcileEffect - Mutating destination resolution probe.
 * @property {(destinationEffectId: string) => Promise<Readonly<Record<string, any>> | null>} readReceipt - Direct verified receipt lookup.
 */

/** @param {unknown} value - Candidate optional abort signal. @returns {void} */
function assertOptionalAbortSignal(value) {
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
        'function' ||
      typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
        'function')
  ) {
    throw new TypeError(
      'Managed-effect handler signal must be an AbortSignal.',
    );
  }
}

/** @param {unknown} value - Optional trusted coordinator binding. @param {string} appId - Catalog namespace. @param {string} label - Construction boundary. @returns {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken | undefined} - Exact immutable token. */
function normalizeCatalogCoordinatorAuthority(value, appId, label) {
  if (value === undefined) return undefined;
  const authority = assertCoordinatorAuthorityToken(
    value,
    `${label}.coordinatorAuthority`,
  );
  if (authority.appId !== appId) {
    throw new TypeError(
      `${label}.coordinatorAuthority must bind the catalog appId.`,
    );
  }
  return authority;
}

/** @param {unknown} value - Optional retained destination identity. @param {string} label - Construction boundary. @returns {string | undefined} - Validated identity without opening or initializing a store. */
function normalizeExpectedStoreId(value, label) {
  if (value === undefined) return undefined;
  assertDomainSeparatedSha256Id(value, 'was', `${label}.expectedStoreId`);
  return value;
}

/** @param {unknown} value - Optional retained ADOPTED destination floor. @param {string} label - Construction boundary. @returns {Readonly<Record<string, any>> | undefined} - Canonical immutable floor. */
function normalizeDestinationAuthorityFloor(value, label) {
  if (value === undefined) return undefined;
  try {
    return validateApplicationStateCoordinatorAuthorityRecord(value);
  } catch {
    throw new TypeError(`${label}.destinationAuthorityFloor is invalid.`);
  }
}

/** @param {unknown} value - Candidate exact object. @param {string[]} required - Required keys. @param {string[]} optional - Optional keys. @param {string} label - Boundary label. @returns {Record<string, any>} */
function assertExactObject(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    actual.some((key) => !required.includes(key) && !optional.includes(key)) ||
    actual.length < required.length
  ) {
    throw new TypeError(
      `${label} requires exactly ${required.join(', ')}${optional.length ? ` and optionally ${optional.join(', ')}` : ''}.`,
    );
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value - Managed-effect identity including the physical attempt. @returns {{runId: string, invocationId: string, effectId: string}} - Stable logical identity. */
function normalizeAdapterExecutionIdentity(value) {
  const identity = assertExactObject(
    value,
    ['runId', 'invocationId', 'attemptId', 'effectId'],
    [],
    'Application-state adapter identity',
  );
  assertLedgerOpaqueId(
    identity.attemptId,
    'application-state adapter attemptId',
  );
  return Object.freeze({
    runId: assertLedgerOpaqueId(
      identity.runId,
      'application-state adapter runId',
    ),
    invocationId: assertLedgerOpaqueId(
      identity.invocationId,
      'application-state adapter invocationId',
    ),
    effectId: assertLedgerOpaqueId(
      identity.effectId,
      'application-state adapter effectId',
    ),
  });
}

/** @param {Record<string, any>} left - Destination. @param {Record<string, any>} right - Expected destination. @returns {void} */
function assertSameDestination(left, right) {
  const candidate = normalizeApplicationStateDestination(left);
  if (
    candidate.kind !== right.kind ||
    candidate.version !== right.version ||
    candidate.bindingId !== right.bindingId ||
    candidate.configuration.provider !== right.configuration.provider ||
    candidate.configuration.storeId !== right.configuration.storeId ||
    candidate.configuration.tableName !== right.configuration.tableName ||
    candidate.configuration.namespace !== right.configuration.namespace
  ) {
    throw new TypeError(
      'Application-state adapter destination does not match its host binding.',
    );
  }
}

/**
 * Build the exact credential-free destination for one already-verified store
 * binding. Both execution and recovery use this constructor so recovery
 * cannot silently reinterpret provider, store, table, or app namespace.
 * @param {{adapterName: import('../../lib/config/db.js').DBAdapterName, storeId: string, tableName: string, appId: string}} options - Verified binding inputs.
 * @returns {ReturnType<typeof normalizeApplicationStateDestination>} - Exact retained destination.
 */
function createApplicationStateDestination(options) {
  return normalizeApplicationStateDestination({
    kind: APPLICATION_STATE_CAPABILITY,
    version: 2,
    bindingId: APPLICATION_STATE_BINDING_ID,
    configuration: {
      provider: options.adapterName,
      storeId: options.storeId,
      tableName: options.tableName,
      namespace: options.appId,
    },
  });
}

/**
 * Create the read-only recovery methods shared by the executable catalog and
 * the deliberately execution-free recovery catalog.
 * @param {{table: ReturnType<typeof createApplicationStateTable>, storeId: string, appId: string, destination: Readonly<Record<string, any>>}} options - Existing store binding.
 * @returns {{recoverOutcome: BuiltinManagedEffectRecoveryCatalog['recoverOutcome'], readReceipt: BuiltinManagedEffectRecoveryCatalog['readReceipt']}} - Exact recovery surface.
 */
function createApplicationStateRecoverySurface(options) {
  /** @param {{destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}} input - Retained delivery. @returns {Promise<Readonly<Record<string, any>> | null>} - Recovered outcome. */
  async function recoverOutcome(input) {
    assertExactObject(
      input,
      ['destinationEffectId', 'destination', 'identity', 'request'],
      [],
      'Application-state recovery input',
    );
    assertSameDestination(input.destination, options.destination);
    const normalized = normalizeApplicationStatePutIfAbsentRequest(
      input.request,
    );
    const contractDigest = createApplicationStateEffectContractDigest({
      destinationEffectId: input.destinationEffectId,
      identity: input.identity,
      destination: options.destination,
      request: normalized.frame,
    });
    const receipt = await options.table.recoverPutIfAbsent({
      storeId: options.storeId,
      namespace: options.appId,
      key: normalized.input.key,
      value: normalized.input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest,
    });
    return receipt ? createApplicationStateOutcomeFromReceipt(receipt) : null;
  }

  return Object.freeze({
    recoverOutcome,
    readReceipt: options.table.readReceipt,
  });
}

/**
 * Create the deliberately writable destination-resolution method.
 * @param {{table: ReturnType<typeof createApplicationStateTable>, storeId: string, appId: string, destination: Readonly<Record<string, any>>}} options - Existing store binding.
 * @returns {{reconcileEffect: BuiltinManagedEffectReconciliationCatalog['reconcileEffect'], readReceipt: BuiltinManagedEffectReconciliationCatalog['readReceipt']}} - Exact reconciliation surface.
 */
function createApplicationStateReconciliationSurface(options) {
  /** @param {{destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}} input - Retained delivery. @returns {Promise<Readonly<{kind: 'outcome', outcome: Readonly<Record<string, any>>} | {kind: 'not-applied', evidence: Readonly<Record<string, any>>}>>} - Permanent destination disposition. */
  async function reconcileEffect(input) {
    assertExactObject(
      input,
      ['destinationEffectId', 'destination', 'identity', 'request'],
      [],
      'Application-state reconciliation input',
    );
    assertSameDestination(input.destination, options.destination);
    const normalized = normalizeApplicationStatePutIfAbsentRequest(
      input.request,
    );
    const contractDigest = createApplicationStateEffectContractDigest({
      destinationEffectId: input.destinationEffectId,
      identity: input.identity,
      destination: options.destination,
      request: normalized.frame,
    });
    const receipt = await options.table.recoverPutIfAbsent({
      storeId: options.storeId,
      namespace: options.appId,
      key: normalized.input.key,
      value: normalized.input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest,
    });
    if (receipt) {
      return Object.freeze({
        kind: 'outcome',
        outcome: createApplicationStateOutcomeFromReceipt(receipt),
      });
    }
    const resolved = await options.table.resolvePutIfAbsentNotApplied({
      storeId: options.storeId,
      namespace: options.appId,
      key: normalized.input.key,
      value: normalized.input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest,
    });
    return resolved.kind === 'outcome'
      ? Object.freeze({
          kind: 'outcome',
          outcome: createApplicationStateOutcomeFromReceipt(resolved.receipt),
        })
      : Object.freeze({
          kind: 'not-applied',
          evidence: createApplicationStateNotAppliedEvidence(
            resolved.resolution,
          ),
        });
  }

  return Object.freeze({
    reconcileEffect,
    readReceipt: options.table.readReceipt,
  });
}

/**
 * Open the closed built-in catalog over one already-owned application-state DB
 * client. The caller owns the DB lifetime; every returned adapter must settle
 * before that lifetime closes.
 * A retained expectedStoreId pins an existing physical destination and forbids
 * bootstrapping a replacement before authority adoption.
 * @param {{db: import('../../lib/db/base.js').DBClient, appId: string, adapterName: import('../../lib/config/db.js').DBAdapterName, tableName?: string, allowTestAdapter?: boolean, createStoreId?: () => string, coordinatorAuthority?: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken | import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot, expectedStoreId?: string, destinationAuthorityFloor?: unknown}} options - Trusted host configuration.
 * @returns {Promise<Readonly<BuiltinManagedEffectCatalog>>} - Finite catalog.
 */
export async function createBuiltinManagedEffectCatalog(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Built-in managed-effect catalog requires options.');
  }
  for (const key of Object.keys(options)) {
    if (!CATALOG_OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Built-in managed-effect catalog.${key} is unsupported.`,
      );
    }
  }
  // Snapshot every caller-owned option before the first await. Returned
  // adapters must never observe later mutation of the construction object.
  const db = options.db;
  const appId = options.appId;
  const adapterName = options.adapterName;
  const configuredTableName = options.tableName;
  const allowTestAdapter = options.allowTestAdapter;
  const createStoreId = options.createStoreId;
  if (!db || typeof db.transactionWrite !== 'function') {
    throw new TypeError(
      'Built-in managed-effect catalog requires a transactional DB client.',
    );
  }
  assertLogicalId(appId, 'built-in managed-effect catalog appId');
  const coordinatorAuthority = normalizeCatalogCoordinatorAuthority(
    options.coordinatorAuthority,
    appId,
    'Built-in managed-effect catalog',
  );
  const expectedStoreId = normalizeExpectedStoreId(
    options.expectedStoreId,
    'Built-in managed-effect catalog',
  );
  const destinationAuthorityFloor = normalizeDestinationAuthorityFloor(
    options.destinationAuthorityFloor,
    'Built-in managed-effect catalog',
  );
  if (
    destinationAuthorityFloor !== undefined &&
    (coordinatorAuthority === undefined ||
      expectedStoreId === undefined ||
      destinationAuthorityFloor.store_id !== expectedStoreId ||
      destinationAuthorityFloor.namespace !== appId)
  ) {
    throw new TypeError(
      'Built-in managed-effect catalog destinationAuthorityFloor requires matching coordinatorAuthority, expectedStoreId, and appId.',
    );
  }
  const tableName = configuredTableName ?? APPLICATION_STATE_TABLE_NAME;
  if (tableName !== APPLICATION_STATE_TABLE_NAME) {
    throw new TypeError(
      `Built-in managed-effect catalog tableName must be ${APPLICATION_STATE_TABLE_NAME}.`,
    );
  }
  if (allowTestAdapter !== undefined && typeof allowTestAdapter !== 'boolean') {
    throw new TypeError('allowTestAdapter must be a boolean when provided.');
  }
  if (createStoreId !== undefined && typeof createStoreId !== 'function') {
    throw new TypeError('createStoreId must be a function when provided.');
  }
  const testAdapterAllowed = allowTestAdapter === true;
  if (
    adapterName !== 'lmdb' &&
    !(testAdapterAllowed && adapterName === 'vanilla')
  ) {
    throw new TypeError(
      'Built-in application-state effects require LMDB; vanilla is available only through allowTestAdapter for semantic tests.',
    );
  }
  assertDBClientAdapterIdentity(db, adapterName);
  const table = createApplicationStateTable({
    db,
    tableName,
    ...(createStoreId ? { createStoreId } : {}),
    ...(coordinatorAuthority === undefined ? {} : { coordinatorAuthority }),
  });
  const identity =
    expectedStoreId === undefined
      ? await table.ensureStoreIdentity()
      : await table.assertStoreIdentity(expectedStoreId);
  const storeId = identity.store_id;
  if (coordinatorAuthority !== undefined) {
    // The writable host explicitly advances the destination's own fence. This
    // is not a control-store takeover and cannot fence another DB atomically.
    await table.adoptCoordinatorAuthority(
      { storeId, namespace: appId },
      destinationAuthorityFloor === undefined
        ? undefined
        : { destinationAuthorityFloor },
    );
  }
  const destination = createApplicationStateDestination({
    adapterName,
    storeId,
    tableName,
    appId,
  });
  const recovery = createApplicationStateRecoverySurface({
    table,
    storeId,
    appId,
    destination,
  });

  /** @param {Record<string, any>} request - Host-accepted component request. @returns {Readonly<BuiltinManagedEffectAdapter>} - Exact five-key managed-effect adapter. */
  function resolve(request) {
    normalizeApplicationStatePutIfAbsentRequest(request);
    return Object.freeze({
      descriptor: APPLICATION_STATE_ADAPTER_DESCRIPTOR,
      destination,
      verifier: APPLICATION_STATE_VERIFIER_DESCRIPTOR,
      substantiatedReplayProperties: FROZEN_REPLAY_PROPERTIES,
      execute: async (/** @type {Record<string, any>} */ input) => {
        assertExactObject(
          input,
          ['destinationEffectId', 'destination', 'identity', 'request'],
          ['signal'],
          'Application-state adapter input',
        );
        assertOptionalAbortSignal(input.signal);
        assertSameDestination(input.destination, destination);
        const normalized = normalizeApplicationStatePutIfAbsentRequest(
          input.request,
        );
        assertLedgerOpaqueId(
          input.destinationEffectId,
          'application-state destinationEffectId',
        );
        const logicalIdentity = normalizeAdapterExecutionIdentity(
          input.identity,
        );
        const contractDigest = createApplicationStateEffectContractDigest({
          destinationEffectId: input.destinationEffectId,
          identity: logicalIdentity,
          destination,
          request: normalized.frame,
        });
        // Once executeManagedEffect wins durable STARTED authorization, the
        // local atomic transaction must settle even if cancellation arrives.
        // The operation is short, trusted, and receipt-recoverable; rejecting
        // merely because signal aborted would manufacture uncertainty.
        const receipt = await table.putIfAbsent({
          storeId,
          namespace: appId,
          key: normalized.input.key,
          value: normalized.input.value,
          destinationEffectId: input.destinationEffectId,
          contractDigest,
        });
        return createApplicationStateOutcomeFromReceipt(receipt);
      },
    });
  }

  return Object.freeze({
    storeId,
    destination,
    effectEvidenceVerifiers: APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
    resolve,
    ...recovery,
  });
}

/**
 * Open only the receipt-recovery half of the finite built-in catalog over an
 * already-owned application-state DB client. This path reads an existing
 * store identity and never calls `ensureStoreIdentity`, so a missing or
 * replacement store fails closed without creating operator-visible state.
 * No adapter resolver or executable callback is returned.
 * @param {{db: import('../../lib/db/base.js').DBClient, appId: string, adapterName: import('../../lib/config/db.js').DBAdapterName, tableName?: string, allowTestAdapter?: boolean}} options - Trusted host recovery configuration.
 * @returns {Promise<Readonly<BuiltinManagedEffectRecoveryCatalog>>} - Recovery-only catalog.
 */
export async function createBuiltinManagedEffectRecoveryCatalog(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Built-in managed-effect recovery catalog requires options.',
    );
  }
  for (const key of Object.keys(options)) {
    if (!RECOVERY_CATALOG_OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Built-in managed-effect recovery catalog.${key} is unsupported.`,
      );
    }
  }

  // Snapshot every caller-owned route before the first read. The returned
  // recovery closure must remain bound to this exact provider and namespace.
  const db = options.db;
  const appId = options.appId;
  const adapterName = options.adapterName;
  const configuredTableName = options.tableName;
  const allowTestAdapter = options.allowTestAdapter;
  if (!db || typeof db.transactionWrite !== 'function') {
    throw new TypeError(
      'Built-in managed-effect recovery catalog requires a transactional DB client.',
    );
  }
  assertLogicalId(appId, 'built-in managed-effect recovery catalog appId');
  const tableName = configuredTableName ?? APPLICATION_STATE_TABLE_NAME;
  if (tableName !== APPLICATION_STATE_TABLE_NAME) {
    throw new TypeError(
      `Built-in managed-effect recovery catalog tableName must be ${APPLICATION_STATE_TABLE_NAME}.`,
    );
  }
  if (allowTestAdapter !== undefined && typeof allowTestAdapter !== 'boolean') {
    throw new TypeError('allowTestAdapter must be a boolean when provided.');
  }
  const testAdapterAllowed = allowTestAdapter === true;
  if (
    adapterName !== 'lmdb' &&
    !(testAdapterAllowed && adapterName === 'vanilla')
  ) {
    throw new TypeError(
      'Built-in application-state effect recovery requires LMDB; vanilla is available only through allowTestAdapter for semantic tests.',
    );
  }
  assertDBClientAdapterIdentity(db, adapterName);
  const table = createApplicationStateTable({ db, tableName });
  const identity = await table.readStoreIdentity();
  if (!identity) {
    throw new ApplicationStateStoreIdentityError(
      'Application-state recovery requires an existing verified store identity.',
    );
  }
  const storeId = identity.store_id;
  const destination = createApplicationStateDestination({
    adapterName,
    storeId,
    tableName,
    appId,
  });
  const recovery = createApplicationStateRecoverySurface({
    table,
    storeId,
    appId,
    destination,
  });
  return Object.freeze({
    storeId,
    destination,
    effectEvidenceVerifiers: APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
    ...recovery,
  });
}

/**
 * Open only the explicitly writable destination-reconciliation surface over
 * an existing application-state store. It never initializes a missing store
 * and exposes neither normal execution nor the read-only recovery probe.
 * A supplied authority explicitly adopts the existing destination; an unbound
 * construction remains mutation-free for read-only destination preflight.
 * @param {{db: import('../../lib/db/base.js').DBClient, appId: string, adapterName: import('../../lib/config/db.js').DBAdapterName, tableName?: string, allowTestAdapter?: boolean, coordinatorAuthority?: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken | import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot, expectedStoreId?: string, destinationAuthorityFloor?: unknown}} options - Trusted host reconciliation configuration.
 * @returns {Promise<Readonly<BuiltinManagedEffectReconciliationCatalog>>} - Reconciliation-only catalog.
 */
export async function createBuiltinManagedEffectReconciliationCatalog(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Built-in managed-effect reconciliation catalog requires options.',
    );
  }
  for (const key of Object.keys(options)) {
    if (!RECONCILIATION_CATALOG_OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Built-in managed-effect reconciliation catalog.${key} is unsupported.`,
      );
    }
  }
  const db = options.db;
  const appId = options.appId;
  const adapterName = options.adapterName;
  const tableName = options.tableName ?? APPLICATION_STATE_TABLE_NAME;
  const allowTestAdapter = options.allowTestAdapter;
  if (!db || typeof db.transactionWrite !== 'function') {
    throw new TypeError(
      'Built-in managed-effect reconciliation catalog requires a transactional DB client.',
    );
  }
  assertLogicalId(
    appId,
    'built-in managed-effect reconciliation catalog appId',
  );
  const coordinatorAuthority = normalizeCatalogCoordinatorAuthority(
    options.coordinatorAuthority,
    appId,
    'Built-in managed-effect reconciliation catalog',
  );
  const expectedStoreId = normalizeExpectedStoreId(
    options.expectedStoreId,
    'Built-in managed-effect reconciliation catalog',
  );
  const destinationAuthorityFloor = normalizeDestinationAuthorityFloor(
    options.destinationAuthorityFloor,
    'Built-in managed-effect reconciliation catalog',
  );
  if (
    destinationAuthorityFloor !== undefined &&
    (coordinatorAuthority === undefined ||
      expectedStoreId === undefined ||
      destinationAuthorityFloor.store_id !== expectedStoreId ||
      destinationAuthorityFloor.namespace !== appId)
  ) {
    throw new TypeError(
      'Built-in managed-effect reconciliation catalog destinationAuthorityFloor requires matching coordinatorAuthority, expectedStoreId, and appId.',
    );
  }
  if (tableName !== APPLICATION_STATE_TABLE_NAME) {
    throw new TypeError(
      `Built-in managed-effect reconciliation catalog tableName must be ${APPLICATION_STATE_TABLE_NAME}.`,
    );
  }
  if (allowTestAdapter !== undefined && typeof allowTestAdapter !== 'boolean') {
    throw new TypeError('allowTestAdapter must be a boolean when provided.');
  }
  if (
    adapterName !== 'lmdb' &&
    !(allowTestAdapter === true && adapterName === 'vanilla')
  ) {
    throw new TypeError(
      'Built-in application-state effect reconciliation requires LMDB; vanilla is available only through allowTestAdapter for semantic tests.',
    );
  }
  assertDBClientAdapterIdentity(db, adapterName);
  const table = createApplicationStateTable({
    db,
    tableName,
    ...(coordinatorAuthority === undefined ? {} : { coordinatorAuthority }),
  });
  const identity =
    expectedStoreId === undefined
      ? await table.readStoreIdentity()
      : await table.assertStoreIdentity(expectedStoreId);
  if (!identity) {
    throw new ApplicationStateStoreIdentityError(
      'Application-state reconciliation requires an existing verified store identity.',
    );
  }
  const storeId = identity.store_id;
  if (coordinatorAuthority !== undefined) {
    await table.adoptCoordinatorAuthority(
      { storeId, namespace: appId },
      destinationAuthorityFloor === undefined
        ? undefined
        : { destinationAuthorityFloor },
    );
  }
  const destination = createApplicationStateDestination({
    adapterName,
    storeId,
    tableName,
    appId,
  });
  return Object.freeze({
    storeId,
    destination,
    effectEvidenceVerifiers: APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
    ...createApplicationStateReconciliationSurface({
      table,
      storeId,
      appId,
      destination,
    }),
  });
}

/**
 * Bind the finite catalog to one durable run/invocation. Component code sees
 * only Activity Protocol frames; credentials, DB clients, and destinations
 * remain in this host closure.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, catalog: BuiltinManagedEffectCatalog, actor?: {kind: string, id: string}}} options - Durable handler inputs.
 * @returns {(request: Readonly<Record<string, any>>, controls: {signal: AbortSignal}) => Promise<Readonly<Record<string, any>>>} - Worker transport handler.
 */
export function createBuiltinManagedEffectHandler(options) {
  assertExactObject(
    options,
    ['ledger', 'runId', 'invocationId', 'catalog'],
    ['actor'],
    'Built-in managed-effect handler options',
  );
  const ledger = options.ledger;
  if (!ledger || typeof ledger.rebuildRun !== 'function') {
    throw new TypeError('Built-in managed-effect handler requires ledger.');
  }
  const runId = assertLedgerOpaqueId(
    options.runId,
    'built-in managed-effect handler runId',
  );
  const invocationId = assertLedgerOpaqueId(
    options.invocationId,
    'built-in managed-effect handler invocationId',
  );
  if (!options.catalog || typeof options.catalog.resolve !== 'function') {
    throw new TypeError('Built-in managed-effect handler requires catalog.');
  }
  const catalog = options.catalog;
  /** @type {{kind: string, id: string} | undefined} */
  let actor;
  if (options.actor !== undefined) {
    const candidate = assertExactObject(
      options.actor,
      ['kind', 'id'],
      [],
      'Built-in managed-effect handler actor',
    );
    actor = Object.freeze({
      kind: assertLedgerOpaqueId(
        candidate.kind,
        'built-in managed-effect handler actor.kind',
      ),
      id: assertLedgerOpaqueId(
        candidate.id,
        'built-in managed-effect handler actor.id',
      ),
    });
  }
  return async (request, controls) => {
    assertExactObject(
      controls,
      ['signal'],
      [],
      'Built-in managed-effect handler controls',
    );
    assertOptionalAbortSignal(controls?.signal);
    return await executeManagedEffect({
      ledger,
      runId,
      invocationId,
      request,
      adapter: catalog.resolve(request),
      ...(actor ? { actor } : {}),
      ...(controls?.signal ? { signal: controls.signal } : {}),
    });
  };
}

export default createBuiltinManagedEffectCatalog;
