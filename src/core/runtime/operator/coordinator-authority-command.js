import { Command, InvalidArgumentError } from 'commander';

import { createControlDBClient } from '../../lib/config/db.js';
import {
  COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
  CoordinatorAuthorityAction,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../lib/db/tables/coordinator-authority.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { createCanonicalJsonSha256Id } from '../content-id.js';
import { cloneBoundedJsonObject } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';
import { resolveExecutionLedgerStoreConfiguration } from './execution-ledger-store.js';
import { readOperatorJsonObjectFile } from './json-document-file.js';
import { renderTerminalSafeJson } from './terminal-safe-json.js';

export const COORDINATOR_AUTHORITY_INSPECTION_SCHEMA_VERSION = 1;
export const COORDINATOR_AUTHORITY_INSPECTION_KIND =
  'wharfie.coordinator-authority.inspection';
export const COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION = 1;
export const COORDINATOR_AUTHORITY_TAKEOVER_KIND =
  'wharfie.coordinator-authority.takeover';
export const COORDINATOR_AUTHORITY_INSPECTION_MAX_BYTES = 64 * 1024;
export const COORDINATOR_AUTHORITY_TAKEOVER_RECEIPT_MAX_BYTES = 128 * 1024;
export const COORDINATOR_AUTHORITY_OPERATOR_RELEASE_REQUEST_DOMAIN =
  'wharfie:coordinator-authority-operator-release-request:v1';
export const COORDINATOR_AUTHORITY_OPERATOR_RELEASE_REQUEST_PREFIX = 'wcor';

const TOKEN_KEYS = Object.freeze([
  'schemaVersion',
  'appId',
  'coordinatorId',
  'authorityId',
  'epoch',
]);
const SNAPSHOT_KEYS = Object.freeze([
  ...TOKEN_KEYS,
  'status',
  'recordVersion',
  'acquisitionRequestId',
  'acquiredAt',
  'heartbeatAt',
  'releasedAt',
  'updatedAt',
  'lastRequestId',
]);
const INSPECTION_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'authority',
  'authoritative',
  'integrity',
  'scope',
  'observedAuthority',
]);
const TAKEOVER_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'action',
  'applied',
  'scope',
  'releaseRequestId',
  'observedAuthority',
  'takeoverAuthority',
  'resultAuthority',
]);

/**
 * @typedef CoordinatorAuthorityCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write one complete machine document.
 * @property {(rows: Record<string, any>[]) => void} table - Write compact human rows.
 * @property {(message: string) => void} info - Write human guidance.
 * @property {(error: Error) => void} failure - Write one safe failure.
 */

/**
 * @typedef CoordinatorAuthorityCommandProcess
 * @property {string | number | null | undefined} exitCode - Process exit status.
 */

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether the value is a non-array object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {Readonly<string[]>} keys - Exact required keys.
 * @param {string} label - Safe boundary label.
 * @returns {void} - Throws when fields are missing or unsupported.
 */
function assertExactKeys(value, keys, label) {
  const accepted = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !accepted.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
}

/**
 * @param {unknown} value - Candidate app identity.
 * @param {string} label - Safe boundary label.
 * @returns {string} - Canonical application ID.
 */
function normalizeAppId(value, label) {
  assertLogicalId(value, label);
  return /** @type {string} */ (value);
}

/**
 * Canonicalize a complete authority snapshot. The stable-token validator also
 * validates full snapshots, while the explicit key check prevents a bare
 * token from being admitted where exact takeover evidence is required.
 * @param {unknown} value - Candidate full snapshot.
 * @param {string} label - Safe boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen snapshot.
 */
function normalizeAuthoritySnapshot(value, label) {
  const snapshot = cloneBoundedJsonObject(
    value,
    COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
    label,
  );
  assertExactKeys(snapshot, SNAPSHOT_KEYS, label);
  createCoordinatorAuthorityToken(snapshot, label);
  return Object.freeze(
    Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, snapshot[key]])),
  );
}

/**
 * @param {Readonly<Record<string, any>>} left - First canonical snapshot.
 * @param {Readonly<Record<string, any>>} right - Second canonical snapshot.
 * @returns {boolean} - Whether every exact snapshot field matches.
 */
function sameAuthoritySnapshot(left, right) {
  return SNAPSHOT_KEYS.every((key) => left[key] === right[key]);
}

/**
 * @param {Readonly<Record<string, any>>} left - First canonical snapshot.
 * @param {Readonly<Record<string, any>>} right - Second canonical snapshot.
 * @returns {boolean} - Whether both snapshots name one stable authority.
 */
function sameAuthorityToken(left, right) {
  const leftToken = createCoordinatorAuthorityToken(left);
  const rightToken = createCoordinatorAuthorityToken(right);
  return (
    leftToken.schemaVersion === rightToken.schemaVersion &&
    leftToken.appId === rightToken.appId &&
    leftToken.coordinatorId === rightToken.coordinatorId &&
    leftToken.authorityId === rightToken.authorityId &&
    leftToken.epoch === rightToken.epoch
  );
}

/**
 * Derive the release leg's durable request ID from the caller's stable
 * takeover intent. Retrying after either response is lost therefore replays
 * both kernel transitions instead of creating a new mutation.
 * @param {{appId: string, coordinatorId: string, requestId: string}} input - Canonical takeover identity.
 * @returns {string} - Stable bounded release request ID.
 */
export function createCoordinatorAuthorityOperatorReleaseRequestId(input) {
  if (!isObject(input)) {
    throw new TypeError(
      'Coordinator authority operator release request input must be an object.',
    );
  }
  const appId = normalizeAppId(
    input.appId,
    'coordinator authority operator release request appId',
  );
  const coordinatorId = assertLedgerOpaqueId(
    input.coordinatorId,
    'coordinator authority operator release request coordinatorId',
  );
  const requestId = assertLedgerOpaqueId(
    input.requestId,
    'coordinator authority operator release request takeover requestId',
  );
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_AUTHORITY_OPERATOR_RELEASE_REQUEST_DOMAIN,
    prefix: COORDINATOR_AUTHORITY_OPERATOR_RELEASE_REQUEST_PREFIX,
    value: { appId, coordinatorId, requestId },
    valuePath: 'coordinator authority operator release request identity',
  });
}

/**
 * Create the stable non-authoritative document consumed by takeover. It
 * contains the exact full store snapshot but grants no replacement authority.
 * @param {string} appId - Application scope.
 * @param {unknown} observedAuthority - Full authority snapshot or null.
 * @returns {Readonly<Record<string, any>>} - Schema-v1 inspection document.
 */
export function createCoordinatorAuthorityInspectionDocument(
  appId,
  observedAuthority,
) {
  const scopeAppId = normalizeAppId(
    appId,
    'coordinator authority inspection appId',
  );
  const snapshot =
    observedAuthority === null
      ? null
      : normalizeAuthoritySnapshot(
          observedAuthority,
          'coordinator authority inspection observedAuthority',
        );
  if (snapshot && snapshot.appId !== scopeAppId) {
    throw new TypeError(
      'Coordinator authority inspection snapshot crossed application scope.',
    );
  }
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_INSPECTION_SCHEMA_VERSION,
    kind: COORDINATOR_AUTHORITY_INSPECTION_KIND,
    authority: 'none',
    authoritative: false,
    integrity: Object.freeze({ verified: true }),
    scope: Object.freeze({ appId: scopeAppId }),
    observedAuthority: snapshot,
  });
}

/**
 * Validate one complete reusable inspection document and bind it to the
 * requested application. An absent or released observation is valid for
 * inspection output but cannot authorize takeover.
 * @param {unknown} value - Candidate inspection document.
 * @param {string} expectedAppId - Exact command application scope.
 * @param {{requireActive?: boolean}} [options] - Takeover-specific state requirement.
 * @returns {Readonly<Record<string, any>>} - Canonical inspection document.
 */
export function validateCoordinatorAuthorityInspectionDocument(
  value,
  expectedAppId,
  options = {},
) {
  const appId = normalizeAppId(
    expectedAppId,
    'coordinator authority expected appId',
  );
  const document = cloneBoundedJsonObject(
    value,
    COORDINATOR_AUTHORITY_INSPECTION_MAX_BYTES,
    'coordinator authority inspection document',
  );
  assertExactKeys(
    document,
    INSPECTION_KEYS,
    'Coordinator authority inspection document',
  );
  if (
    document.schemaVersion !==
      COORDINATOR_AUTHORITY_INSPECTION_SCHEMA_VERSION ||
    document.kind !== COORDINATOR_AUTHORITY_INSPECTION_KIND ||
    document.authority !== 'none' ||
    document.authoritative !== false
  ) {
    throw new TypeError(
      'Coordinator authority inspection document contract is invalid.',
    );
  }
  if (!isObject(document.integrity)) {
    throw new TypeError(
      'Coordinator authority inspection integrity is invalid.',
    );
  }
  assertExactKeys(
    document.integrity,
    ['verified'],
    'Coordinator authority inspection integrity',
  );
  if (document.integrity.verified !== true) {
    throw new TypeError(
      'Coordinator authority inspection must contain verified integrity.',
    );
  }
  if (!isObject(document.scope)) {
    throw new TypeError('Coordinator authority inspection scope is invalid.');
  }
  assertExactKeys(
    document.scope,
    ['appId'],
    'Coordinator authority inspection scope',
  );
  if (document.scope.appId !== appId) {
    throw new TypeError(
      'Coordinator authority inspection does not match the requested application.',
    );
  }
  const snapshot =
    document.observedAuthority === null
      ? null
      : normalizeAuthoritySnapshot(
          document.observedAuthority,
          'coordinator authority inspection observedAuthority',
        );
  if (snapshot && snapshot.appId !== appId) {
    throw new TypeError(
      'Coordinator authority inspection snapshot crossed application scope.',
    );
  }
  if (
    options.requireActive === true &&
    (!snapshot || snapshot.status !== CoordinatorAuthorityStatus.ACTIVE)
  ) {
    throw new TypeError(
      'Coordinator authority takeover requires an exact active predecessor inspection.',
    );
  }
  return createCoordinatorAuthorityInspectionDocument(appId, snapshot);
}

/**
 * @param {unknown} error - Candidate local read error.
 * @returns {boolean} - Whether an unopened read-only local store is absent.
 */
function isMissingReadOnlyStore(error) {
  return isObject(error) && error.code === 'WHARFIE_READ_ONLY_STORE_NOT_FOUND';
}

/**
 * Open the coordinator authority namespace in the exact execution-ledger
 * table, run one operation, and close the command-local DB client.
 * @template T
 * @param {(store: ReturnType<typeof createCoordinatorAuthority>) => Promise<T>} handler - Authority operation.
 * @param {{readOnly?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} [options] - Store routing.
 * @returns {Promise<T>} - Operation result.
 */
async function withCoordinatorAuthorityStore(handler, options = {}) {
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  const readOnly = options.readOnly === true;
  /** @type {import('../../lib/db/base.js').DBClient | undefined} */
  let db;
  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let operationError;
  try {
    db = await createControlDBClient(configuration.adapterName, {
      path: configuration.controlPath,
      readOnly,
    });
    result = await handler(
      createCoordinatorAuthority({
        db,
        tableName: configuration.tableName,
      }),
    );
  } catch (error) {
    operationError = error;
  }

  /** @type {unknown} */
  let closeError;
  try {
    await db?.close?.();
  } catch (error) {
    closeError = error;
  }
  if (operationError !== undefined && closeError !== undefined) {
    throw new AggregateError(
      [operationError, closeError],
      'Coordinator authority operation and control-store close both failed.',
    );
  }
  if (operationError !== undefined) throw operationError;
  if (closeError !== undefined) throw closeError;
  return /** @type {T} */ (result);
}

/**
 * Strongly inspect one app's current coordinator authority without creating a
 * missing local store.
 * @param {{appId: string, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} input - Exact app scope and optional store routing.
 * @returns {Promise<Readonly<Record<string, any>>>} - Schema-v1 inspection document.
 */
export async function inspectCoordinatorAuthority(input) {
  if (!isObject(input)) {
    throw new TypeError('inspectCoordinatorAuthority input must be an object.');
  }
  const appId = normalizeAppId(
    input.appId,
    'inspectCoordinatorAuthority.appId',
  );
  try {
    const snapshot = await withCoordinatorAuthorityStore(
      async (store) => await store.get({ appId }),
      {
        readOnly: true,
        ...(input.configuration === undefined
          ? {}
          : { configuration: input.configuration }),
      },
    );
    return createCoordinatorAuthorityInspectionDocument(appId, snapshot);
  } catch (error) {
    if (isMissingReadOnlyStore(error)) {
      return createCoordinatorAuthorityInspectionDocument(appId, null);
    }
    throw error;
  }
}

/**
 * Fence one exact active predecessor with a caller-confirmed takeover, then
 * release the temporary successor so the next fresh resident session can
 * acquire normally. The release request ID is deterministically derived from
 * takeover intent, making both legs safe to retry after an ambiguous response.
 * `resultAuthority` deliberately does not claim that a later resident has not
 * already acquired after the retained release receipt was replayed.
 * @param {{appId: string, coordinatorId: string, requestId: string, inspection: unknown, confirmAuthorityReplacement: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} input - Exact takeover request.
 * @returns {Promise<Readonly<Record<string, any>>>} - Stable takeover receipt.
 */
export async function takeoverCoordinatorAuthority(input) {
  if (!isObject(input)) {
    throw new TypeError(
      'takeoverCoordinatorAuthority input must be an object.',
    );
  }
  const appId = normalizeAppId(
    input.appId,
    'takeoverCoordinatorAuthority.appId',
  );
  const coordinatorId = assertLedgerOpaqueId(
    input.coordinatorId,
    'takeoverCoordinatorAuthority.coordinatorId',
  );
  const requestId = assertLedgerOpaqueId(
    input.requestId,
    'takeoverCoordinatorAuthority.requestId',
  );
  if (input.confirmAuthorityReplacement !== true) {
    throw new TypeError(
      'takeoverCoordinatorAuthority.confirmAuthorityReplacement must be true.',
    );
  }
  const inspection = validateCoordinatorAuthorityInspectionDocument(
    input.inspection,
    appId,
    { requireActive: true },
  );
  const observedAuthority = inspection.observedAuthority;
  const releaseRequestId = createCoordinatorAuthorityOperatorReleaseRequestId({
    appId,
    coordinatorId,
    requestId,
  });
  const transitions = await withCoordinatorAuthorityStore(
    async (store) => {
      const takeover = await store.takeover({
        appId,
        coordinatorId,
        requestId,
        observedAuthority,
        confirmAuthorityReplacement: true,
      });
      if (
        !isObject(takeover) ||
        typeof takeover.applied !== 'boolean' ||
        takeover.action !== CoordinatorAuthorityAction.TAKEOVER
      ) {
        throw new TypeError(
          'Coordinator authority takeover transition is invalid.',
        );
      }
      const takeoverAuthority = normalizeAuthoritySnapshot(
        takeover.authority,
        'coordinator authority takeover authority',
      );
      if (
        takeoverAuthority.appId !== appId ||
        takeoverAuthority.coordinatorId !== coordinatorId ||
        takeoverAuthority.acquisitionRequestId !== requestId ||
        takeoverAuthority.status !== CoordinatorAuthorityStatus.ACTIVE
      ) {
        throw new TypeError(
          'Coordinator authority takeover transition does not match the requested temporary successor.',
        );
      }
      const release = await store.release({
        authority: createCoordinatorAuthorityToken(takeoverAuthority),
        requestId: releaseRequestId,
      });
      if (
        !isObject(release) ||
        typeof release.applied !== 'boolean' ||
        release.action !== CoordinatorAuthorityAction.RELEASE
      ) {
        throw new TypeError(
          'Coordinator authority operator release transition is invalid.',
        );
      }
      const resultAuthority = normalizeAuthoritySnapshot(
        release.authority,
        'coordinator authority takeover resultAuthority',
      );
      if (
        !sameAuthorityToken(takeoverAuthority, resultAuthority) ||
        resultAuthority.status !== CoordinatorAuthorityStatus.RELEASED ||
        resultAuthority.recordVersion !== takeoverAuthority.recordVersion + 1 ||
        resultAuthority.lastRequestId !== releaseRequestId ||
        resultAuthority.releasedAt === null
      ) {
        throw new TypeError(
          'Coordinator authority operator release does not match the temporary successor.',
        );
      }
      return {
        takeoverApplied: takeover.applied,
        releaseApplied: release.applied,
        takeoverAuthority,
        resultAuthority,
      };
    },
    input.configuration === undefined
      ? {}
      : { configuration: input.configuration },
  );
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION,
    kind: COORDINATOR_AUTHORITY_TAKEOVER_KIND,
    action: 'takeover-and-release',
    applied: transitions.takeoverApplied || transitions.releaseApplied,
    scope: Object.freeze({ appId }),
    releaseRequestId,
    observedAuthority,
    takeoverAuthority: transitions.takeoverAuthority,
    resultAuthority: transitions.resultAuthority,
  });
}

/**
 * Validate and canonicalize a fence-and-release receipt before rendering it.
 * This prevents an injected or remote operation from expanding the public
 * schema or substituting a different predecessor/successor transition.
 * @param {unknown} value - Candidate receipt.
 * @param {{appId: string, coordinatorId: string, requestId: string, inspection: unknown}} expected - Exact admitted request.
 * @returns {Readonly<Record<string, any>>} - Exact schema-v1 receipt.
 */
export function validateCoordinatorAuthorityTakeoverReceipt(value, expected) {
  if (!isObject(expected)) {
    throw new TypeError(
      'Coordinator authority takeover receipt expectation must be an object.',
    );
  }
  const appId = normalizeAppId(
    expected.appId,
    'coordinator authority takeover receipt expected appId',
  );
  const coordinatorId = assertLedgerOpaqueId(
    expected.coordinatorId,
    'coordinator authority takeover receipt expected coordinatorId',
  );
  const requestId = assertLedgerOpaqueId(
    expected.requestId,
    'coordinator authority takeover receipt expected requestId',
  );
  const inspection = validateCoordinatorAuthorityInspectionDocument(
    expected.inspection,
    appId,
    { requireActive: true },
  );
  const receipt = cloneBoundedJsonObject(
    value,
    COORDINATOR_AUTHORITY_TAKEOVER_RECEIPT_MAX_BYTES,
    'coordinator authority takeover receipt',
  );
  assertExactKeys(
    receipt,
    TAKEOVER_RECEIPT_KEYS,
    'Coordinator authority takeover receipt',
  );
  if (
    receipt.schemaVersion !== COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION ||
    receipt.kind !== COORDINATOR_AUTHORITY_TAKEOVER_KIND ||
    receipt.action !== 'takeover-and-release' ||
    typeof receipt.applied !== 'boolean'
  ) {
    throw new TypeError('Coordinator authority takeover receipt is invalid.');
  }
  if (!isObject(receipt.scope)) {
    throw new TypeError(
      'Coordinator authority takeover receipt scope is invalid.',
    );
  }
  assertExactKeys(
    receipt.scope,
    ['appId'],
    'Coordinator authority takeover receipt scope',
  );
  if (receipt.scope.appId !== appId) {
    throw new TypeError(
      'Coordinator authority takeover receipt crossed application scope.',
    );
  }
  const releaseRequestId = createCoordinatorAuthorityOperatorReleaseRequestId({
    appId,
    coordinatorId,
    requestId,
  });
  if (receipt.releaseRequestId !== releaseRequestId) {
    throw new TypeError(
      'Coordinator authority takeover receipt release request is invalid.',
    );
  }
  const observedAuthority = normalizeAuthoritySnapshot(
    receipt.observedAuthority,
    'coordinator authority takeover receipt observedAuthority',
  );
  const takeoverAuthority = normalizeAuthoritySnapshot(
    receipt.takeoverAuthority,
    'coordinator authority takeover receipt takeoverAuthority',
  );
  const resultAuthority = normalizeAuthoritySnapshot(
    receipt.resultAuthority,
    'coordinator authority takeover receipt resultAuthority',
  );
  if (
    !sameAuthoritySnapshot(observedAuthority, inspection.observedAuthority) ||
    takeoverAuthority.appId !== appId ||
    takeoverAuthority.coordinatorId !== coordinatorId ||
    takeoverAuthority.acquisitionRequestId !== requestId ||
    takeoverAuthority.status !== CoordinatorAuthorityStatus.ACTIVE ||
    takeoverAuthority.epoch !== observedAuthority.epoch + 1 ||
    !sameAuthorityToken(takeoverAuthority, resultAuthority) ||
    resultAuthority.status !== CoordinatorAuthorityStatus.RELEASED ||
    resultAuthority.recordVersion !== takeoverAuthority.recordVersion + 1 ||
    resultAuthority.lastRequestId !== releaseRequestId ||
    resultAuthority.releasedAt === null
  ) {
    throw new TypeError(
      'Coordinator authority takeover receipt does not match the admitted transition.',
    );
  }
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION,
    kind: COORDINATOR_AUTHORITY_TAKEOVER_KIND,
    action: 'takeover-and-release',
    applied: receipt.applied,
    scope: Object.freeze({ appId }),
    releaseRequestId,
    observedAuthority,
    takeoverAuthority,
    resultAuthority,
  });
}

/**
 * @param {unknown} provided - Optional output overrides.
 * @returns {CoordinatorAuthorityCommandOutput} - Complete output port.
 */
function resolveOutput(provided) {
  if (provided !== undefined && !isObject(provided)) {
    throw new TypeError(
      'Coordinator authority command output must be an object.',
    );
  }
  const candidate = provided ?? {};
  for (const key of ['json', 'table', 'info', 'failure']) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'function') {
      throw new TypeError(
        `Coordinator authority command output.${key} must be a function.`,
      );
    }
  }
  return {
    json:
      candidate.json || ((value) => console.log(renderTerminalSafeJson(value))),
    table: candidate.table || ((rows) => console.table(rows)),
    info: candidate.info || ((message) => console.log(message)),
    failure:
      candidate.failure ||
      ((error) => console.error(renderTerminalSafeJson(error.message))),
  };
}

/**
 * Reject ambiguous repeated scalar options at Commander admission.
 * @param {string} optionName - Public option name.
 * @returns {(value: string, previous: string|undefined) => string} - Scalar parser.
 */
function parseSingleOption(optionName) {
  return (value, previous) => {
    if (previous !== undefined) {
      throw new InvalidArgumentError(
        `${optionName} may be specified only once.`,
      );
    }
    return value;
  };
}

/**
 * @param {unknown} value - Identity resolver result.
 * @returns {{appId: string}} - Exact app scope.
 */
function normalizeIdentity(value) {
  if (!isObject(value)) {
    throw new TypeError(
      'Coordinator authority command identity must be an object.',
    );
  }
  return {
    appId: normalizeAppId(
      value.appId,
      'coordinator authority command identity.appId',
    ),
  };
}

/**
 * @param {Readonly<Record<string, any>>} document - Valid inspection document.
 * @returns {Record<string, any>[]} - Safe human inspection row.
 */
function inspectionRows(document) {
  const snapshot = document.observedAuthority;
  if (!snapshot) {
    return [{ app_id: document.scope.appId, status: 'ABSENT' }];
  }
  return [
    {
      app_id: document.scope.appId,
      status: snapshot.status,
      coordinator_id_json: renderTerminalSafeJson(snapshot.coordinatorId),
      authority_id: snapshot.authorityId,
      epoch: snapshot.epoch,
      record_version: snapshot.recordVersion,
      acquired_at: snapshot.acquiredAt,
      heartbeat_at: snapshot.heartbeatAt,
      updated_at: snapshot.updatedAt,
    },
  ];
}

/**
 * @param {Readonly<Record<string, any>>} receipt - Valid takeover receipt.
 * @returns {Record<string, any>[]} - Safe human transition row.
 */
function takeoverRows(receipt) {
  return [
    {
      app_id: receipt.scope.appId,
      action: receipt.action,
      applied: receipt.applied,
      predecessor_authority: receipt.observedAuthority.authorityId,
      predecessor_epoch: receipt.observedAuthority.epoch,
      temporary_coordinator_json: renderTerminalSafeJson(
        receipt.takeoverAuthority.coordinatorId,
      ),
      takeover_authority: receipt.takeoverAuthority.authorityId,
      result_epoch: receipt.resultAuthority.epoch,
      result_status: receipt.resultAuthority.status,
      result_record_version: receipt.resultAuthority.recordVersion,
      release_request_id: receipt.releaseRequestId,
    },
  ];
}

/**
 * Create the shared source or packaged coordinator-authority command tree.
 * The source wrapper enables an explicit app ID; packaged callers resolve app
 * identity from immutable embedded metadata.
 * @param {{resolveIdentity: (selection: {appId?: string}) => unknown|Promise<unknown>, includeAppIdOption?: boolean, inspectAuthority?: typeof inspectCoordinatorAuthority, takeoverAuthority?: typeof takeoverCoordinatorAuthority, readJsonObjectFile?: typeof readOperatorJsonObjectFile, output?: Partial<CoordinatorAuthorityCommandOutput>, processRef?: CoordinatorAuthorityCommandProcess}} options - Host behavior and test seams.
 * @returns {Command} - Fresh `coordinator` parent command.
 */
export function createCoordinatorAuthorityCommand(options) {
  if (!isObject(options) || typeof options.resolveIdentity !== 'function') {
    throw new TypeError(
      'createCoordinatorAuthorityCommand requires resolveIdentity.',
    );
  }
  const includeAppIdOption = options.includeAppIdOption === true;
  const inspectAuthority =
    options.inspectAuthority === undefined
      ? inspectCoordinatorAuthority
      : options.inspectAuthority;
  const takeoverAuthority =
    options.takeoverAuthority === undefined
      ? takeoverCoordinatorAuthority
      : options.takeoverAuthority;
  const readJsonObjectFile =
    options.readJsonObjectFile === undefined
      ? readOperatorJsonObjectFile
      : options.readJsonObjectFile;
  if (
    typeof inspectAuthority !== 'function' ||
    typeof takeoverAuthority !== 'function' ||
    typeof readJsonObjectFile !== 'function'
  ) {
    throw new TypeError(
      'Coordinator authority command operations and JSON reader must be functions.',
    );
  }
  const output = resolveOutput(options.output);
  const processRef =
    options.processRef === undefined ? process : options.processRef;
  if (!isObject(processRef)) {
    throw new TypeError(
      'Coordinator authority command processRef must be an object.',
    );
  }

  /**
   * @param {Record<string, any>} commandOptions - Leaf options.
   * @returns {Promise<{appId: string}>} - Exact resolved application scope.
   */
  const resolveCommandIdentity = async (commandOptions) =>
    normalizeIdentity(
      await options.resolveIdentity(
        includeAppIdOption ? { appId: commandOptions.appId } : {},
      ),
    );

  const inspect = new Command('inspect').description(
    "Inspect one application's exact coordinator authority",
  );
  if (includeAppIdOption) {
    inspect.requiredOption(
      '--app-id <appId>',
      'Exact application ID',
      parseSingleOption('--app-id'),
    );
  }
  inspect
    .option('--json', 'Write one reusable schema-v1 inspection document')
    .action(async (commandOptions) => {
      try {
        const identity = await resolveCommandIdentity(commandOptions);
        const document = validateCoordinatorAuthorityInspectionDocument(
          await inspectAuthority({ appId: identity.appId }),
          identity.appId,
        );
        if (commandOptions.json === true) output.json(document);
        else {
          output.table(inspectionRows(document));
          output.info(
            'Heartbeat timestamps are diagnostic only and do not authorize takeover. Use --json to retain the exact predecessor inspection.',
          );
        }
      } catch (error) {
        output.failure(
          error instanceof Error ? error : new Error(String(error)),
        );
        processRef.exitCode = 1;
      }
    });

  const takeover = new Command('takeover').description(
    'Fence one exact active authority, then release the temporary successor',
  );
  if (includeAppIdOption) {
    takeover.requiredOption(
      '--app-id <appId>',
      'Exact application ID',
      parseSingleOption('--app-id'),
    );
  }
  takeover
    .requiredOption(
      '--inspection-file <path>',
      'Complete JSON emitted by coordinator inspect --json',
      parseSingleOption('--inspection-file'),
    )
    .requiredOption(
      '--coordinator-id <coordinatorId>',
      'Temporary successor identity used only for fencing',
      parseSingleOption('--coordinator-id'),
    )
    .requiredOption(
      '--request-id <requestId>',
      'Stable takeover request ID; also derives the stable release request',
      parseSingleOption('--request-id'),
    )
    .option(
      '--confirm-authority-replacement',
      'Explicitly affirm replacement of the inspected authority',
    )
    .option('--json', 'Write one schema-v1 takeover receipt');
  takeover.action(async (commandOptions) => {
    if (commandOptions.confirmAuthorityReplacement !== true) {
      output.failure(
        new Error(
          'coordinator takeover requires --confirm-authority-replacement before it can change durable state.',
        ),
      );
      processRef.exitCode = 1;
      return;
    }
    try {
      const coordinatorId = assertLedgerOpaqueId(
        commandOptions.coordinatorId,
        'coordinator takeover --coordinator-id',
      );
      const requestId = assertLedgerOpaqueId(
        commandOptions.requestId,
        'coordinator takeover --request-id',
      );
      const identity = await resolveCommandIdentity(commandOptions);
      const inspection = validateCoordinatorAuthorityInspectionDocument(
        await readJsonObjectFile(
          commandOptions.inspectionFile,
          'coordinator authority inspection',
        ),
        identity.appId,
        { requireActive: true },
      );
      const receipt = validateCoordinatorAuthorityTakeoverReceipt(
        await takeoverAuthority({
          appId: identity.appId,
          coordinatorId,
          requestId,
          inspection,
          confirmAuthorityReplacement: true,
        }),
        {
          appId: identity.appId,
          coordinatorId,
          requestId,
          inspection,
        },
      );
      if (commandOptions.json === true) output.json(receipt);
      else {
        output.table(takeoverRows(receipt));
        output.info(
          'The temporary successor is released; a fresh resident session may now acquire authority.',
        );
      }
    } catch (error) {
      output.failure(error instanceof Error ? error : new Error(String(error)));
      processRef.exitCode = 1;
    }
  });

  return new Command('coordinator')
    .description(
      'Inspect authority or explicitly fence it for a replacement resident',
    )
    .addCommand(inspect)
    .addCommand(takeover);
}

export default createCoordinatorAuthorityCommand;
