/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal catalog closures keep their types compact. */

import { APPLICATION_STATE_TABLE_NAME } from '../../lib/config/db.js';
import { assertDBClientAdapterIdentity } from '../../lib/db/base.js';
import { createApplicationStateTable } from '../../lib/db/tables/application-state.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
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
 * Open the closed built-in catalog over one already-owned application-state DB
 * client. The caller owns the DB lifetime; every returned adapter must settle
 * before that lifetime closes.
 * @param {{db: import('../../lib/db/base.js').DBClient, appId: string, adapterName: import('../../lib/config/db.js').DBAdapterName, tableName?: string, allowTestAdapter?: boolean, createStoreId?: () => string}} options - Trusted host configuration.
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
  });
  const identity = await table.ensureStoreIdentity();
  const storeId = identity.store_id;
  const destination = normalizeApplicationStateDestination({
    kind: APPLICATION_STATE_CAPABILITY,
    version: 1,
    bindingId: APPLICATION_STATE_BINDING_ID,
    configuration: {
      provider: adapterName,
      storeId,
      tableName,
      namespace: appId,
    },
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

  /** @param {{destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}} input - Retained delivery. @returns {Promise<Readonly<Record<string, any>> | null>} - Recovered outcome. */
  async function recoverOutcome(input) {
    assertExactObject(
      input,
      ['destinationEffectId', 'destination', 'identity', 'request'],
      [],
      'Application-state recovery input',
    );
    assertSameDestination(input.destination, destination);
    const normalized = normalizeApplicationStatePutIfAbsentRequest(
      input.request,
    );
    const contractDigest = createApplicationStateEffectContractDigest({
      destinationEffectId: input.destinationEffectId,
      identity: input.identity,
      destination,
      request: normalized.frame,
    });
    const receipt = await table.recoverPutIfAbsent({
      storeId,
      namespace: appId,
      key: normalized.input.key,
      value: normalized.input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest,
    });
    return receipt ? createApplicationStateOutcomeFromReceipt(receipt) : null;
  }

  return Object.freeze({
    storeId,
    destination,
    effectEvidenceVerifiers: APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
    resolve,
    recoverOutcome,
    readReceipt: table.readReceipt,
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
