/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This pure adapter keeps its exact injected command port and decoded service-status contract inline. */

import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertApplicationRevisionId } from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { validateAwsSingleNodeHostActivationRequest } from './deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from './deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
  validateAwsSingleNodeHostArtifactProjectionEvidence,
} from './deployment-aws-host-artifact-projection.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_KIND =
  'awsSingleNodeHostServiceConvergenceEvidence';
export const AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_MAX_BYTES =
  16 * 1024;
export const AWS_SINGLE_NODE_HOST_SERVICE_STATUS_MAX_BYTES = 64 * 1024;
export const AWS_SINGLE_NODE_HOST_SERVICE_RUNTIME_USER = 'wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_SERVICE_RUNTIME_GROUP = 'wharfie-runtime';

const SERVICE_CONVERGENCE_STEP = 'service-convergence';
const ARTIFACT_PROJECTION_STEP = 'artifact-projection';
const SERVICE_STATUS_SCHEMA_VERSION = 3;
const SERVICE_STATUS_KIND = 'wharfie.service.status';
const DESIRED_CONVERGENCE_SCHEMA_VERSION = 1;
const DESIRED_CONVERGENCE_KIND = 'wharfie.service.desired-convergence';
const RUNTIME_HOME = '/var/lib/wharfie-runtime';

const FACTORY_KEYS = new Set(['command', 'root', 'testOnlyRoot']);
const COMMAND_KEYS = new Set(['inspectExactService', 'convergeExactService']);
const ROOT_OPTION_KEYS = new Set(['root', 'testOnlyRoot']);
const CONTEXT_KEYS = new Set(['request', 'step', 'priorEvidence']);
const STEP_KEYS = new Set(['intentId', 'kind', 'attemptGeneration']);
const PRIOR_EVIDENCE_KEYS = new Set([
  'runtime-identity',
  'application-storage',
  'control-storage',
  'artifact-projection',
]);
const ARTIFACT_PRIOR_EVIDENCE_KEYS = new Set([
  'runtime-identity',
  'application-storage',
  'control-storage',
]);
const EVIDENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'requestId',
  'deploymentInstanceId',
  'appId',
  'artifactId',
  'revisionId',
  'targetId',
  'artifactPath',
  'runtimeUser',
  'runtimeGroup',
  'unitName',
  'outcome',
  'health',
  'bootPersistent',
]);
const STATUS_COMMON_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'unit',
  'installation',
  'systemd',
  'runtime',
  'wiring',
  'health',
  'activation',
  'desiredConvergence',
]);
const STATUS_OPTIONAL_KEYS = new Set(['integrity', 'persistence']);
const DESIRED_CONVERGENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'unit',
  'desired',
  'disposition',
  'basis',
]);
const DESIRED_CONVERGENCE_DISPOSITIONS = new Set([
  'authorized',
  'conflict',
  'unknown',
]);
const DESIRED_CONVERGENCE_AUTHORIZED_BASES = new Set([
  'physical-absence',
  'durable-install',
  'durable-change',
  'durable-active',
]);
const SYSTEMD_KEYS = new Set([
  'loadState',
  'unitFileState',
  'activeState',
  'subState',
  'result',
  'mainPid',
  'execMainStatus',
  'fragmentPath',
  'dropInPaths',
  'needDaemonReload',
]);
const WIRING_KEYS = new Set([
  'state',
  'unitFile',
  'selection',
  'effectiveUnit',
  'cleanupPending',
]);
const ACTIVATION_KEYS = new Set([
  'phase',
  'action',
  'desired',
  'selected',
  'rollback',
  'lastOutcome',
]);
const RELEASE_KEYS = new Set(['artifactId', 'revisionId']);
const INSTALLED_KEYS = new Set([
  'state',
  'activeArtifactId',
  'activeRevisionId',
  'previousArtifactId',
  'previousRevisionId',
]);
const ABSENT_KEYS = new Set(['state']);
const UNINSTALLED_KEYS = new Set(['state', 'lastArtifactId', 'lastRevisionId']);
const INTEGRITY_VERIFIED_KEYS = new Set(['status', 'artifactId', 'revisionId']);
const INTEGRITY_INVALID_KEYS = new Set(['status']);
const PERSISTENCE_KEYS = new Set(['linger', 'unitEnabled', 'bootEnabled']);
const RUNTIME_KEYS = new Set([
  'status',
  'artifactId',
  'revisionId',
  'generation',
  'ownerKind',
  'ownerGeneration',
  'session',
  'processId',
  'currentOwner',
]);
const RUNTIME_REQUIRED_KEYS = new Set(['status', 'session']);
const ACTIVE_RUNTIME_KEYS = new Set(RUNTIME_KEYS);
const RUNTIME_STATUSES = new Set([
  'UNAVAILABLE',
  'UNKNOWN',
  'STARTING',
  'READY',
  'STOPPING',
  'STOPPED',
]);
const RUNTIME_SESSIONS = new Set(['unknown', 'active', 'absent', 'manual']);
const RUNTIME_OWNER_KINDS = new Set(['resident', 'manual']);
const ACTIVATION_PHASES = new Set([
  'QUIESCING',
  'QUIESCENT',
  'SELECTED',
  'ACTIVATING',
  'ACTIVE',
]);
const ACTIVATION_ACTIONS = new Set(['install', 'update', 'rollback']);
const ACTIVATION_OUTCOMES = new Set([
  'target-active',
  'source-retained',
  'source-restored',
]);
const SERVICE_HEALTH_STATES = new Set([
  'absent',
  'healthy',
  'starting',
  'stopped',
  'failed',
  'degraded',
]);
/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactPlainObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertSupportedKeys(value, keys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertRequiredKeys(value, keys, valuePath) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {Record<string, any>} value @param {Set<string>} keys @returns {boolean} */
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function positiveSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsolutePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${valuePath} must be a canonical absolute path.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {any} */
function ownDataValue(value, key, valuePath) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${valuePath}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {Function} */
function ownDataFunction(value, key, valuePath) {
  const candidate = ownDataValue(value, key, valuePath);
  if (typeof candidate !== 'function') {
    throw new TypeError(`${valuePath}.${key} must be a function.`);
  }
  return candidate;
}

/** @param {unknown} optionsValue @param {string} valuePath @returns {string} */
function validateArtifactRootOptions(optionsValue, valuePath) {
  const options =
    optionsValue === undefined ? {} : exactPlainObject(optionsValue, valuePath);
  assertSupportedKeys(options, ROOT_OPTION_KEYS, valuePath);
  const hasRoot = Object.hasOwn(options, 'root');
  const hasTestOnlyRoot = Object.hasOwn(options, 'testOnlyRoot');
  const root = hasRoot
    ? canonicalAbsolutePath(
        ownDataValue(options, 'root', valuePath),
        `${valuePath}.root`,
      )
    : AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT;

  if (root === AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT) {
    if (hasTestOnlyRoot) {
      throw new TypeError(
        `${valuePath}.testOnlyRoot is not supported with the production root.`,
      );
    }
    return root;
  }
  if (
    !hasTestOnlyRoot ||
    ownDataValue(options, 'testOnlyRoot', valuePath) !== true
  ) {
    throw new TypeError(
      `${valuePath}.testOnlyRoot must be true for a custom root.`,
    );
  }
  const temporaryRoot = canonicalAbsolutePath(tmpdir(), `${valuePath}.tmpdir`);
  const relative = path.relative(temporaryRoot, root);
  if (
    relative.length === 0 ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new TypeError(
      `${valuePath}.root must be strictly beneath the platform temporary directory.`,
    );
  }
  return root;
}

/** @param {Readonly<Record<string, any>>} request @returns {string} */
function getUnitName(request) {
  return `wharfie-${request.appId}.service`;
}

/** @param {Readonly<Record<string, any>>} request @returns {string} */
function getUnitPath(request) {
  return path.join(
    RUNTIME_HOME,
    '.config',
    'systemd',
    'user',
    getUnitName(request),
  );
}

/**
 * Revalidate the exact V66 service-convergence context and the strict V71
 * artifact receipt before any injected command method is reached.
 * @param {unknown} value - Candidate effect context.
 * @param {string} root - Validated artifact projection root.
 * @returns {Readonly<{request: Readonly<Record<string, any>>, intentId: string, attemptGeneration: number, artifactEvidence: Readonly<Record<string, any>>}>}
 */
function validateContext(value, root) {
  const context = exactPlainObject(
    value,
    'awsSingleNodeHostServiceConvergence context',
  );
  assertExactKeys(
    context,
    CONTEXT_KEYS,
    'awsSingleNodeHostServiceConvergence context',
  );
  const request = validateAwsSingleNodeHostActivationRequest(
    context.request,
    'awsSingleNodeHostServiceConvergence context.request',
  );
  const step = exactPlainObject(
    context.step,
    'awsSingleNodeHostServiceConvergence context.step',
  );
  assertExactKeys(
    step,
    STEP_KEYS,
    'awsSingleNodeHostServiceConvergence context.step',
  );
  if (step.kind !== SERVICE_CONVERGENCE_STEP) {
    throw new TypeError(
      `awsSingleNodeHostServiceConvergence context.step.kind must be '${SERVICE_CONVERGENCE_STEP}'.`,
    );
  }
  const intentId = getAwsSingleNodeHostActivationIntentId(
    request,
    SERVICE_CONVERGENCE_STEP,
  );
  if (step.intentId !== intentId) {
    throw new Error(
      'awsSingleNodeHostServiceConvergence context.step.intentId does not match its exact request.',
    );
  }
  const attemptGeneration = nonnegativeSafeInteger(
    step.attemptGeneration,
    'awsSingleNodeHostServiceConvergence context.step.attemptGeneration',
  );
  const priorEvidence = exactPlainObject(
    context.priorEvidence,
    'awsSingleNodeHostServiceConvergence context.priorEvidence',
  );
  assertExactKeys(
    priorEvidence,
    PRIOR_EVIDENCE_KEYS,
    'awsSingleNodeHostServiceConvergence context.priorEvidence',
  );
  /** @type {Record<string, any>} */
  const artifactPriorEvidence = {};
  for (const key of ARTIFACT_PRIOR_EVIDENCE_KEYS) {
    artifactPriorEvidence[key] = ownDataValue(
      priorEvidence,
      key,
      `awsSingleNodeHostServiceConvergence context.priorEvidence.${key}`,
    );
  }
  const artifactEvidence = validateAwsSingleNodeHostArtifactProjectionEvidence(
    priorEvidence[ARTIFACT_PROJECTION_STEP],
    {
      request,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          request,
          ARTIFACT_PROJECTION_STEP,
        ),
        kind: ARTIFACT_PROJECTION_STEP,
        attemptGeneration: 0,
      },
      priorEvidence: artifactPriorEvidence,
    },
    root,
  );
  return Object.freeze({
    request,
    intentId,
    attemptGeneration,
    artifactEvidence,
  });
}

/** @param {Readonly<Record<string, any>>} validated @returns {Readonly<Record<string, any>>} */
function createPortInput(validated) {
  const { request, intentId, attemptGeneration, artifactEvidence } = validated;
  return deepFreeze(
    sortCanonicalJsonValue({
      requestId: request.requestId,
      intentId,
      attemptGeneration,
      deploymentInstanceId: request.deploymentInstanceId,
      appId: request.appId,
      artifactId: request.artifactId,
      revisionId: request.revisionId,
      targetId: request.targetId,
      artifactPath: artifactEvidence.artifactPath,
      contentLength: artifactEvidence.contentLength,
      byteDigest: artifactEvidence.byteDigest,
    }),
  );
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} artifactEvidence @returns {Readonly<Record<string, any>>} */
function createEvidence(request, artifactEvidence) {
  const evidence = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_KIND,
      requestId: request.requestId,
      deploymentInstanceId: request.deploymentInstanceId,
      appId: request.appId,
      artifactId: request.artifactId,
      revisionId: request.revisionId,
      targetId: request.targetId,
      artifactPath: artifactEvidence.artifactPath,
      runtimeUser: AWS_SINGLE_NODE_HOST_SERVICE_RUNTIME_USER,
      runtimeGroup: AWS_SINGLE_NODE_HOST_SERVICE_RUNTIME_GROUP,
      unitName: getUnitName(request),
      outcome: 'target-active',
      health: 'healthy',
      bootPersistent: true,
    }),
  );
  assertManifestIsSecretFree(
    evidence,
    'awsSingleNodeHostServiceConvergenceEvidence',
  );
  return evidence;
}

/** @param {unknown} value @param {string} valuePath @returns {{artifactId: string, revisionId: string}} */
function parseRelease(value, valuePath) {
  const release = exactPlainObject(value, valuePath);
  assertExactKeys(release, RELEASE_KEYS, valuePath);
  assertArtifactId(release.artifactId, `${valuePath}.artifactId`);
  assertApplicationRevisionId(release.revisionId, `${valuePath}.revisionId`);
  return {
    artifactId: release.artifactId,
    revisionId: release.revisionId,
  };
}

/** @param {unknown} value @param {string} valuePath @returns {{artifactId: string, revisionId: string} | null} */
function parseNullableRelease(value, valuePath) {
  return value === null ? null : parseRelease(value, valuePath);
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function parseDesiredConvergence(value, valuePath) {
  const proof = exactPlainObject(value, valuePath);
  assertExactKeys(proof, DESIRED_CONVERGENCE_KEYS, valuePath);
  if (
    proof.schemaVersion !== DESIRED_CONVERGENCE_SCHEMA_VERSION ||
    proof.kind !== DESIRED_CONVERGENCE_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  if (typeof proof.appId !== 'string' || typeof proof.unit !== 'string') {
    throw new TypeError(`${valuePath} service identity must be strings.`);
  }
  if (!DESIRED_CONVERGENCE_DISPOSITIONS.has(proof.disposition)) {
    throw new TypeError(`${valuePath}.disposition is not supported.`);
  }
  if (
    proof.disposition === 'authorized'
      ? !DESIRED_CONVERGENCE_AUTHORIZED_BASES.has(proof.basis)
      : proof.basis !== null
  ) {
    throw new TypeError(`${valuePath}.basis does not match its disposition.`);
  }
  return Object.freeze({
    schemaVersion: proof.schemaVersion,
    kind: proof.kind,
    appId: proof.appId,
    unit: proof.unit,
    desired: parseRelease(proof.desired, `${valuePath}.desired`),
    disposition: proof.disposition,
    basis: proof.basis,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>> | null} */
function parseActivation(value, valuePath) {
  if (value === null) return null;
  const activation = exactPlainObject(value, valuePath);
  assertExactKeys(activation, ACTIVATION_KEYS, valuePath);
  if (!ACTIVATION_PHASES.has(activation.phase)) {
    throw new TypeError(`${valuePath}.phase is not supported.`);
  }
  if (
    activation.action !== null &&
    !ACTIVATION_ACTIONS.has(activation.action)
  ) {
    throw new TypeError(`${valuePath}.action is not supported.`);
  }
  if (
    activation.lastOutcome !== null &&
    !ACTIVATION_OUTCOMES.has(activation.lastOutcome)
  ) {
    throw new TypeError(`${valuePath}.lastOutcome is not supported.`);
  }
  const desired = parseNullableRelease(
    activation.desired,
    `${valuePath}.desired`,
  );
  const selected = parseNullableRelease(
    activation.selected,
    `${valuePath}.selected`,
  );
  const rollback = parseNullableRelease(
    activation.rollback,
    `${valuePath}.rollback`,
  );
  if (
    activation.phase === 'ACTIVE'
      ? activation.action !== null ||
        desired === null ||
        selected === null ||
        activation.lastOutcome === null
      : activation.action === null || desired === null
  ) {
    throw new TypeError(`${valuePath} has an invalid phase/action shape.`);
  }
  return Object.freeze({
    phase: activation.phase,
    action: activation.action,
    desired,
    selected,
    rollback,
    lastOutcome: activation.lastOutcome,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function parseSystemd(value, valuePath) {
  const systemd = exactPlainObject(value, valuePath);
  assertExactKeys(systemd, SYSTEMD_KEYS, valuePath);
  for (const key of [
    'loadState',
    'unitFileState',
    'activeState',
    'subState',
    'result',
    'fragmentPath',
    'dropInPaths',
  ]) {
    if (typeof systemd[key] !== 'string') {
      throw new TypeError(`${valuePath}.${key} must be a string.`);
    }
  }
  nonnegativeSafeInteger(systemd.mainPid, `${valuePath}.mainPid`);
  if (!Number.isSafeInteger(systemd.execMainStatus)) {
    throw new TypeError(`${valuePath}.execMainStatus must be a safe integer.`);
  }
  if (typeof systemd.needDaemonReload !== 'boolean') {
    throw new TypeError(`${valuePath}.needDaemonReload must be a boolean.`);
  }
  return systemd;
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function parseWiring(value, valuePath) {
  const wiring = exactPlainObject(value, valuePath);
  assertExactKeys(wiring, WIRING_KEYS, valuePath);
  for (const key of ['state', 'unitFile', 'selection', 'effectiveUnit']) {
    if (typeof wiring[key] !== 'string') {
      throw new TypeError(`${valuePath}.${key} must be a string.`);
    }
  }
  if (typeof wiring.cleanupPending !== 'boolean') {
    throw new TypeError(`${valuePath}.cleanupPending must be a boolean.`);
  }
  return wiring;
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function parseInstallation(value, valuePath) {
  const installation = exactPlainObject(value, valuePath);
  if (installation.state === 'installed') {
    assertExactKeys(installation, INSTALLED_KEYS, valuePath);
    assertArtifactId(
      installation.activeArtifactId,
      `${valuePath}.activeArtifactId`,
    );
    assertApplicationRevisionId(
      installation.activeRevisionId,
      `${valuePath}.activeRevisionId`,
    );
    const previousArtifactId = installation.previousArtifactId;
    const previousRevisionId = installation.previousRevisionId;
    if ((previousArtifactId === null) !== (previousRevisionId === null)) {
      throw new TypeError(
        `${valuePath} previous artifact and revision must be paired.`,
      );
    }
    if (previousArtifactId !== null) {
      assertArtifactId(previousArtifactId, `${valuePath}.previousArtifactId`);
      assertApplicationRevisionId(
        previousRevisionId,
        `${valuePath}.previousRevisionId`,
      );
    }
    return installation;
  }
  if (installation.state === 'absent') {
    assertExactKeys(installation, ABSENT_KEYS, valuePath);
    return installation;
  }
  if (installation.state === 'uninstalled') {
    assertExactKeys(installation, UNINSTALLED_KEYS, valuePath);
    assertArtifactId(
      installation.lastArtifactId,
      `${valuePath}.lastArtifactId`,
    );
    assertApplicationRevisionId(
      installation.lastRevisionId,
      `${valuePath}.lastRevisionId`,
    );
    return installation;
  }
  throw new TypeError(`${valuePath}.state is not supported.`);
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function parseIntegrity(value, valuePath) {
  const integrity = exactPlainObject(value, valuePath);
  if (integrity.status === 'verified') {
    assertExactKeys(integrity, INTEGRITY_VERIFIED_KEYS, valuePath);
    assertArtifactId(integrity.artifactId, `${valuePath}.artifactId`);
    assertApplicationRevisionId(
      integrity.revisionId,
      `${valuePath}.revisionId`,
    );
    return integrity;
  }
  if (integrity.status === 'invalid') {
    assertExactKeys(integrity, INTEGRITY_INVALID_KEYS, valuePath);
    return integrity;
  }
  throw new TypeError(`${valuePath}.status is not supported.`);
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function parsePersistence(value, valuePath) {
  const persistence = exactPlainObject(value, valuePath);
  assertExactKeys(persistence, PERSISTENCE_KEYS, valuePath);
  for (const key of PERSISTENCE_KEYS) {
    if (typeof persistence[key] !== 'boolean') {
      throw new TypeError(`${valuePath}.${key} must be a boolean.`);
    }
  }
  return persistence;
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>> | null} */
function parseRuntime(value, valuePath) {
  if (value === null) return null;
  const runtime = exactPlainObject(value, valuePath);
  assertSupportedKeys(runtime, RUNTIME_KEYS, valuePath);
  assertRequiredKeys(runtime, RUNTIME_REQUIRED_KEYS, valuePath);
  for (const key of [
    'status',
    'artifactId',
    'revisionId',
    'ownerKind',
    'session',
  ]) {
    if (Object.hasOwn(runtime, key) && typeof runtime[key] !== 'string') {
      throw new TypeError(`${valuePath}.${key} must be a string.`);
    }
  }
  for (const key of ['generation', 'ownerGeneration', 'processId']) {
    if (Object.hasOwn(runtime, key)) {
      nonnegativeSafeInteger(runtime[key], `${valuePath}.${key}`);
    }
  }
  if (
    Object.hasOwn(runtime, 'currentOwner') &&
    typeof runtime.currentOwner !== 'boolean'
  ) {
    throw new TypeError(`${valuePath}.currentOwner must be a boolean.`);
  }
  if (
    Object.hasOwn(runtime, 'artifactId') !==
    Object.hasOwn(runtime, 'revisionId')
  ) {
    throw new TypeError(
      `${valuePath} artifact and revision identity must be paired.`,
    );
  }
  if (Object.hasOwn(runtime, 'artifactId')) {
    assertArtifactId(runtime.artifactId, `${valuePath}.artifactId`);
    assertApplicationRevisionId(runtime.revisionId, `${valuePath}.revisionId`);
  }
  if (
    !RUNTIME_STATUSES.has(runtime.status) ||
    !RUNTIME_SESSIONS.has(runtime.session) ||
    (Object.hasOwn(runtime, 'ownerKind') &&
      !RUNTIME_OWNER_KINDS.has(runtime.ownerKind))
  ) {
    throw new TypeError(`${valuePath} has an unsupported runtime state.`);
  }
  if (
    Object.hasOwn(runtime, 'processId') &&
    (runtime.processId < 1 || runtime.session !== 'active')
  ) {
    throw new TypeError(`${valuePath}.processId requires an active session.`);
  }
  return runtime;
}

/** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {boolean} */
function sameRelease(left, right) {
  return (
    left.artifactId === right.artifactId && left.revisionId === right.revisionId
  );
}

/** @param {Readonly<Record<string, any>> | null} left @param {Readonly<Record<string, any>> | null} right @returns {boolean} */
function sameNullableRelease(left, right) {
  return (
    (left === null && right === null) ||
    (left !== null && right !== null && sameRelease(left, right))
  );
}

/** @param {Readonly<Record<string, any>>} installation @returns {{artifactId: string, revisionId: string}} */
function installedRelease(installation) {
  return {
    artifactId: installation.activeArtifactId,
    revisionId: installation.activeRevisionId,
  };
}

/**
 * @param {Readonly<Record<string, any>> | null} runtime - Observed runtime.
 * @param {Readonly<Record<string, any>>[]} allowedReleases - Authorized releases.
 * @param {Readonly<Record<string, any>>} systemd - Observed manager state.
 * @param {boolean} [allowInactiveUnlistedRelease] - Whether a stopped,
 *   unowned lifecycle may retain the transition's redacted source identity.
 * @returns {boolean} - Whether runtime state proves foreign ownership.
 */
function hasForeignRuntimeProof(
  runtime,
  allowedReleases,
  systemd,
  allowInactiveUnlistedRelease = false,
) {
  if (runtime === null) return systemd.mainPid > 0;
  if (systemd.mainPid > 0 && runtime.session !== 'active') {
    return true;
  }
  if (
    runtime.session === 'active' &&
    (runtime.ownerKind !== 'resident' ||
      runtime.currentOwner !== true ||
      !Object.hasOwn(runtime, 'artifactId') ||
      !allowedReleases.some((candidate) => sameRelease(runtime, candidate)) ||
      !Object.hasOwn(runtime, 'processId') ||
      runtime.processId < 1 ||
      systemd.mainPid < 1 ||
      runtime.processId !== systemd.mainPid)
  ) {
    return true;
  }
  if (
    runtime.session === 'manual' ||
    runtime.ownerKind === 'manual' ||
    (runtime.currentOwner === true &&
      (runtime.ownerKind !== 'resident' || runtime.session !== 'active')) ||
    (Object.hasOwn(runtime, 'processId') &&
      runtime.processId > 0 &&
      runtime.ownerKind !== 'resident')
  ) {
    return true;
  }
  if (
    Object.hasOwn(runtime, 'artifactId') &&
    !allowedReleases.some((candidate) => sameRelease(runtime, candidate)) &&
    !(
      allowInactiveUnlistedRelease &&
      runtime.session === 'absent' &&
      runtime.currentOwner !== true &&
      !Object.hasOwn(runtime, 'processId')
    )
  ) {
    return true;
  }
  return false;
}

/** @param {Readonly<Record<string, any>>} wiring @returns {boolean} */
function isExactManagedWiring(wiring) {
  return (
    wiring.state === 'managed' &&
    wiring.unitFile === 'managed' &&
    wiring.selection === 'managed' &&
    wiring.effectiveUnit === 'managed' &&
    wiring.cleanupPending === false
  );
}

/** @param {Readonly<Record<string, any>>} wiring @returns {boolean} */
function isExactAbsentWiring(wiring) {
  return (
    wiring.state === 'absent' &&
    wiring.unitFile === 'absent' &&
    wiring.selection === 'absent' &&
    wiring.effectiveUnit === 'absent' &&
    wiring.cleanupPending === false
  );
}

/** @param {Readonly<Record<string, any>>} systemd @returns {boolean} */
function isExactAbsentSystemd(systemd) {
  return (
    systemd.loadState === 'not-found' &&
    systemd.unitFileState === '' &&
    systemd.activeState === 'inactive' &&
    systemd.subState === 'dead' &&
    systemd.result === 'success' &&
    systemd.mainPid === 0 &&
    systemd.execMainStatus === 0 &&
    systemd.fragmentPath === '' &&
    systemd.dropInPaths === '' &&
    systemd.needDaemonReload === false
  );
}

/**
 * Classify only the positive contradictions and observation failures that an
 * adapter must not let an authorized manager decision override. The manager's
 * activation record is the sole authority for existing physical releases;
 * neither the invoking request nor observed receipt/runtime may authorize
 * itself.
 * @param {Readonly<Record<string, any>>} request - Exact desired request.
 * @param {Readonly<Record<string, any>>} proof - Parsed manager decision.
 * @param {Readonly<Record<string, any>>} wiring - Parsed wiring.
 * @param {Readonly<Record<string, any>>} systemd - Parsed systemd state.
 * @param {Readonly<Record<string, any>>} installation - Parsed installation.
 * @param {Readonly<Record<string, any>> | null} activation - Parsed activation.
 * @param {Readonly<Record<string, any>> | null} runtime - Parsed runtime.
 * @param {Readonly<Record<string, any>> | null} integrity - Parsed integrity.
 * @param {Readonly<Record<string, any>> | null} persistence - Parsed persistence.
 * @returns {'conflict'|'unknown'|null} - Blocking result, or null when the
 *   manager-authorized state remains eligible for repair.
 */
function classifyAuthorizedConvergenceGuard(
  request,
  proof,
  wiring,
  systemd,
  installation,
  activation,
  runtime,
  integrity,
  persistence,
) {
  if (activation?.action === 'rollback') return 'conflict';
  const basisIncoherent =
    (proof.basis === 'durable-install' &&
      (activation === null ||
        activation.action !== 'install' ||
        !sameRelease(activation.desired, proof.desired) ||
        activation.rollback !== null ||
        (activation.selected !== null &&
          !sameRelease(activation.selected, activation.desired)))) ||
    (proof.basis === 'durable-change' &&
      (activation === null || activation.action !== 'update')) ||
    (proof.basis === 'durable-active' &&
      (activation === null || activation.phase !== 'ACTIVE'));
  if (
    proof.basis === 'durable-active' &&
    activation !== null &&
    (!sameRelease(activation.desired, activation.selected) ||
      (activation.rollback !== null &&
        sameRelease(activation.rollback, activation.selected)))
  ) {
    return 'conflict';
  }
  if (
    runtime?.session === 'active' &&
    (activation?.selected === null ||
      activation?.selected === undefined ||
      !sameRelease(runtime, activation.selected))
  ) {
    return 'conflict';
  }
  if (
    installation.state === 'installed' &&
    (integrity === null || persistence === null)
  ) {
    return 'unknown';
  }
  if (!['loaded', 'not-found'].includes(systemd.loadState)) return 'unknown';
  if (
    wiring.unitFile === 'conflicting' ||
    wiring.selection === 'conflicting' ||
    wiring.cleanupPending === true ||
    systemd.dropInPaths !== '' ||
    (systemd.loadState === 'loaded'
      ? systemd.fragmentPath !== getUnitPath(request)
      : systemd.fragmentPath !== '') ||
    (systemd.loadState !== 'loaded' &&
      (systemd.mainPid > 0 || systemd.activeState === 'active')) ||
    persistence?.linger === false
  ) {
    return 'conflict';
  }
  if (integrity?.status === 'verified') {
    if (installation.state !== 'installed') return 'unknown';
    if (!sameRelease(integrity, installedRelease(installation))) {
      return 'conflict';
    }
  }
  if (
    !['absent', 'managed', 'conflicting', 'orphaned'].includes(wiring.state) ||
    !['absent', 'managed'].includes(wiring.unitFile) ||
    !['absent', 'managed', 'conflicting'].includes(wiring.selection) ||
    !['absent', 'managed', 'conflicting'].includes(wiring.effectiveUnit) ||
    (runtime !== null &&
      (runtime.status === 'UNKNOWN' ||
        runtime.status === 'UNAVAILABLE' ||
        runtime.session === 'unknown'))
  ) {
    return 'unknown';
  }
  const managerHasLiveProcess =
    systemd.mainPid > 0 || systemd.activeState === 'active';
  if (
    managerHasLiveProcess &&
    (runtime === null ||
      !['READY', 'STARTING'].includes(runtime.status) ||
      runtime.session !== 'active' ||
      runtime.ownerKind !== 'resident' ||
      runtime.currentOwner !== true ||
      activation?.selected === null ||
      activation?.selected === undefined ||
      !sameRelease(runtime, activation.selected) ||
      !Number.isSafeInteger(runtime.processId) ||
      runtime.processId < 1 ||
      systemd.mainPid < 1 ||
      runtime.processId !== systemd.mainPid)
  ) {
    return 'conflict';
  }

  /** @type {{artifactId: string, revisionId: string}[]} */
  const allowedReleases = [];
  if (activation !== null) {
    const candidates =
      proof.basis === 'durable-install'
        ? [activation.desired]
        : [activation.desired, activation.selected, activation.rollback];
    for (const candidate of candidates) {
      if (candidate !== null) allowedReleases.push(candidate);
    }
  }
  if (installation.state === 'installed') {
    if (
      proof.basis === 'durable-active' &&
      activation !== null &&
      (!sameRelease(installedRelease(installation), activation.selected) ||
        !sameNullableRelease(
          installation.previousArtifactId === null
            ? null
            : {
                artifactId: installation.previousArtifactId,
                revisionId: installation.previousRevisionId,
              },
          activation.rollback,
        ))
    ) {
      return 'conflict';
    }
    const installedReleases = [installedRelease(installation)];
    // During a forward change after target selection, the public activation
    // view intentionally omits transition.source even though the exact receipt
    // retains it as `previous`. The manager proof has already joined that
    // source; only ACTIVE exposes a complete previous/rollback pair here.
    if (
      proof.basis === 'durable-active' &&
      installation.previousArtifactId !== null
    ) {
      installedReleases.push({
        artifactId: installation.previousArtifactId,
        revisionId: installation.previousRevisionId,
      });
    }
    if (
      installedReleases.some(
        (installed) =>
          !allowedReleases.some((allowed) => sameRelease(installed, allowed)),
      )
    ) {
      return 'conflict';
    }
  }
  if (installation.state === 'uninstalled') {
    const lastRelease = {
      artifactId: installation.lastArtifactId,
      revisionId: installation.lastRevisionId,
    };
    if (
      (proof.basis === 'durable-change' &&
        !allowedReleases.some((allowed) =>
          sameRelease(lastRelease, allowed),
        )) ||
      (proof.basis === 'durable-active' &&
        activation !== null &&
        !sameRelease(lastRelease, activation.selected))
    ) {
      return 'conflict';
    }
  }
  if (
    hasForeignRuntimeProof(
      runtime,
      allowedReleases,
      systemd,
      proof.basis === 'durable-change',
    )
  ) {
    return 'conflict';
  }
  if (proof.basis === 'physical-absence') {
    if (
      installation.state === 'installed' ||
      !isExactAbsentWiring(wiring) ||
      !isExactAbsentSystemd(systemd)
    ) {
      return 'conflict';
    }
    return activation === null &&
      runtime === null &&
      integrity === null &&
      persistence === null
      ? null
      : 'unknown';
  }
  if (basisIncoherent) return 'unknown';
  return null;
}

/**
 * @param {Readonly<Record<string, any>>} status - Decoded service status.
 * @param {Readonly<Record<string, any>>} request - Exact desired request.
 * @param {Readonly<Record<string, any>>} wiring - Parsed wiring state.
 * @param {Readonly<Record<string, any>>} systemd - Parsed manager state.
 * @param {Readonly<Record<string, any>>} installation - Parsed receipt.
 * @param {Readonly<Record<string, any>> | null} activation - Durable activation.
 * @param {Readonly<Record<string, any>> | null} runtime - Runtime observation.
 * @param {Readonly<Record<string, any>> | null} integrity - Integrity proof.
 * @param {Readonly<Record<string, any>> | null} persistence - Boot persistence.
 * @returns {boolean} - Whether the complete desired settlement is exact.
 */
function isExactDesiredSettlement(
  status,
  request,
  wiring,
  systemd,
  installation,
  activation,
  runtime,
  integrity,
  persistence,
) {
  if (
    installation.state !== 'installed' ||
    activation === null ||
    runtime === null ||
    persistence === null ||
    integrity === null ||
    status.health !== 'healthy' ||
    !isExactManagedWiring(wiring)
  ) {
    return false;
  }
  const current = installedRelease(installation);
  const previous =
    installation.previousArtifactId === null
      ? null
      : {
          artifactId: installation.previousArtifactId,
          revisionId: installation.previousRevisionId,
        };
  return (
    integrity.status === 'verified' &&
    sameRelease(integrity, current) &&
    sameRelease(current, request) &&
    activation.phase === 'ACTIVE' &&
    sameRelease(activation.desired, current) &&
    sameRelease(activation.selected, current) &&
    sameNullableRelease(activation.rollback, previous) &&
    (activation.rollback === null ||
      !sameRelease(activation.rollback, current)) &&
    hasExactKeys(runtime, ACTIVE_RUNTIME_KEYS) &&
    runtime.status === 'READY' &&
    sameRelease(runtime, current) &&
    runtime.generation >= 1 &&
    runtime.ownerKind === 'resident' &&
    runtime.ownerGeneration >= 1 &&
    runtime.session === 'active' &&
    runtime.processId >= 1 &&
    runtime.currentOwner === true &&
    systemd.loadState === 'loaded' &&
    systemd.unitFileState === 'enabled' &&
    systemd.activeState === 'active' &&
    systemd.subState === 'running' &&
    systemd.result === 'success' &&
    systemd.mainPid === runtime.processId &&
    systemd.execMainStatus === 0 &&
    systemd.fragmentPath === getUnitPath(request) &&
    systemd.dropInPaths === '' &&
    systemd.needDaemonReload === false &&
    persistence.linger === true &&
    persistence.unitEnabled === true &&
    persistence.bootEnabled === true
  );
}

/** @param {Readonly<Record<string, any>>} status @param {Readonly<Record<string, any>>} request @returns {'settled'|'ready'|'unknown'|'conflict'} */
function classifyDecodedStatus(status, request) {
  if (
    status.schemaVersion !== SERVICE_STATUS_SCHEMA_VERSION ||
    status.kind !== SERVICE_STATUS_KIND
  ) {
    return 'unknown';
  }
  if (typeof status.appId !== 'string' || typeof status.unit !== 'string') {
    return 'unknown';
  }
  if (status.appId !== request.appId || status.unit !== getUnitName(request)) {
    return 'conflict';
  }
  const desiredConvergence = parseDesiredConvergence(
    status.desiredConvergence,
    'serviceStatus.desiredConvergence',
  );
  if (
    desiredConvergence.appId !== status.appId ||
    desiredConvergence.unit !== status.unit ||
    !sameRelease(desiredConvergence.desired, request)
  ) {
    return 'unknown';
  }
  if (desiredConvergence.disposition !== 'authorized') {
    return desiredConvergence.disposition;
  }
  const wiring = parseWiring(status.wiring, 'serviceStatus.wiring');
  const systemd = parseSystemd(status.systemd, 'serviceStatus.systemd');
  const installation = parseInstallation(
    status.installation,
    'serviceStatus.installation',
  );
  const activation = parseActivation(
    status.activation,
    'serviceStatus.activation',
  );
  const runtime = parseRuntime(status.runtime, 'serviceStatus.runtime');
  const integrity = Object.hasOwn(status, 'integrity')
    ? parseIntegrity(status.integrity, 'serviceStatus.integrity')
    : null;
  const persistence = Object.hasOwn(status, 'persistence')
    ? parsePersistence(status.persistence, 'serviceStatus.persistence')
    : null;
  if (!SERVICE_HEALTH_STATES.has(status.health)) return 'unknown';
  const guard = classifyAuthorizedConvergenceGuard(
    request,
    desiredConvergence,
    wiring,
    systemd,
    installation,
    activation,
    runtime,
    integrity,
    persistence,
  );
  if (guard !== null) return guard;
  if (
    desiredConvergence.basis === 'physical-absence' &&
    status.health !== 'absent'
  ) {
    return 'unknown';
  }
  return desiredConvergence.basis === 'durable-active' &&
    isExactDesiredSettlement(
      status,
      request,
      wiring,
      systemd,
      installation,
      activation,
      runtime,
      integrity,
      persistence,
    )
    ? 'settled'
    : 'ready';
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} request @returns {'settled'|'ready'|'unknown'|'conflict'} */
function classifyStatus(value, request) {
  try {
    const status = cloneBoundedJsonObject(
      value,
      AWS_SINGLE_NODE_HOST_SERVICE_STATUS_MAX_BYTES,
      'serviceStatus',
    );
    const object = exactPlainObject(status, 'serviceStatus');
    assertSupportedKeys(
      object,
      new Set([...STATUS_COMMON_KEYS, ...STATUS_OPTIONAL_KEYS]),
      'serviceStatus',
    );
    assertRequiredKeys(object, STATUS_COMMON_KEYS, 'serviceStatus');
    return classifyDecodedStatus(object, request);
  } catch {
    return 'unknown';
  }
}

/**
 * Validate one pure, request-derived V72 service receipt.
 * @param {unknown} value - Candidate evidence.
 * @param {unknown} context - Exact V66 service context.
 * @param {unknown} [rootOptions] - Optional test-only V71 projection root.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen evidence.
 */
export function validateAwsSingleNodeHostServiceConvergenceEvidence(
  value,
  context,
  rootOptions,
) {
  const root = validateArtifactRootOptions(
    rootOptions,
    'awsSingleNodeHostServiceConvergence rootOptions',
  );
  const validated = validateContext(context, root);
  const evidence = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_MAX_BYTES,
    'awsSingleNodeHostServiceConvergenceEvidence',
  );
  assertExactKeys(
    evidence,
    EVIDENCE_KEYS,
    'awsSingleNodeHostServiceConvergenceEvidence',
  );
  const expected = createEvidence(
    validated.request,
    validated.artifactEvidence,
  );
  if (!sameJson(evidence, expected)) {
    throw new Error(
      'awsSingleNodeHostServiceConvergenceEvidence does not match the exact request.',
    );
  }
  return expected;
}

/**
 * Create the pure service-convergence adapter around one exact decoded-status
 * command port. The port owns execution; this boundary owns all authority,
 * classification, and evidence.
 * @param {unknown} optionsValue - Exact command port and optional test root.
 * @returns {Readonly<{observe: Function, converge: Function, validateEvidence: Function}>}
 */
export function createAwsSingleNodeHostServiceConvergenceAdapter(optionsValue) {
  const options = exactPlainObject(
    optionsValue,
    'awsSingleNodeHostServiceConvergence options',
  );
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeHostServiceConvergence options',
  );
  if (!Object.hasOwn(options, 'command')) {
    throw new TypeError(
      'awsSingleNodeHostServiceConvergence options.command is required.',
    );
  }
  const command = exactPlainObject(
    ownDataValue(
      options,
      'command',
      'awsSingleNodeHostServiceConvergence options',
    ),
    'awsSingleNodeHostServiceConvergence options.command',
  );
  assertExactKeys(
    command,
    COMMAND_KEYS,
    'awsSingleNodeHostServiceConvergence options.command',
  );
  const inspectExactService = ownDataFunction(
    command,
    'inspectExactService',
    'awsSingleNodeHostServiceConvergence options.command',
  ).bind(command);
  const convergeExactService = ownDataFunction(
    command,
    'convergeExactService',
    'awsSingleNodeHostServiceConvergence options.command',
  ).bind(command);
  /** @type {Record<string, any>} */
  const rootOptions = {};
  if (Object.hasOwn(options, 'root')) {
    rootOptions.root = ownDataValue(
      options,
      'root',
      'awsSingleNodeHostServiceConvergence options',
    );
  }
  if (Object.hasOwn(options, 'testOnlyRoot')) {
    rootOptions.testOnlyRoot = ownDataValue(
      options,
      'testOnlyRoot',
      'awsSingleNodeHostServiceConvergence options',
    );
  }
  const root = validateArtifactRootOptions(
    rootOptions,
    'awsSingleNodeHostServiceConvergence options',
  );

  return Object.freeze({
    /** @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
    async observe(context) {
      const validated = validateContext(context, root);
      let status;
      try {
        status = await inspectExactService(createPortInput(validated));
      } catch {
        return Object.freeze({ status: 'unknown' });
      }
      const classification = classifyStatus(status, validated.request);
      if (classification !== 'settled') {
        return Object.freeze({ status: classification });
      }
      return Object.freeze({
        status: 'settled',
        evidence: createEvidence(validated.request, validated.artifactEvidence),
      });
    },

    /** @param {unknown} context @returns {Promise<void>} */
    async converge(context) {
      const validated = validateContext(context, root);
      positiveSafeInteger(
        validated.attemptGeneration,
        'awsSingleNodeHostServiceConvergence context.step.attemptGeneration',
      );
      await convergeExactService(createPortInput(validated));
    },

    /** @param {unknown} value @param {unknown} context @returns {Readonly<Record<string, any>>} */
    validateEvidence(value, context) {
      const validated = validateContext(context, root);
      const evidence = cloneBoundedJsonObject(
        value,
        AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_MAX_BYTES,
        'awsSingleNodeHostServiceConvergenceEvidence',
      );
      assertExactKeys(
        evidence,
        EVIDENCE_KEYS,
        'awsSingleNodeHostServiceConvergenceEvidence',
      );
      const expected = createEvidence(
        validated.request,
        validated.artifactEvidence,
      );
      if (!sameJson(evidence, expected)) {
        throw new Error(
          'awsSingleNodeHostServiceConvergenceEvidence does not match the exact request.',
        );
      }
      return expected;
    },
  });
}

export default createAwsSingleNodeHostServiceConvergenceAdapter;
