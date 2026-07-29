/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import { isIPv4 } from 'node:net';
import { isAbsolute, normalize, posix } from 'node:path';
import { setTimeout as sleepWithTimer } from 'node:timers/promises';

import { createBoundedProcessRunner } from './bounded-process.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { createDeploymentOpenSshTransport } from './deployment-openssh-transport.js';
import { ensureDeploymentSshHostKey } from './deployment-ssh-host-key.js';
import { cloneBoundedJsonObject, cloneJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import { openHeldArtifactSource } from './packaged-artifact.js';
import {
  SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
  SINGLE_NODE_DEPLOYMENT_ROOT,
  validateSshEd25519PublicKey,
} from './single-node-cloud-init.js';
import { assertSingleNodeDeploymentIncarnationId } from './single-node-deployment-identity.js';
import { validateSingleNodeDeploymentDesired } from './single-node-deployment-desired.js';
import { SINGLE_NODE_RUNTIME_ACCOUNT } from './single-node-runtime-account.js';

export const SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION = 1;
export const SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND =
  'singleNodeRemoteActivationEvidence';
export const SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN =
  'wharfie:single-node-remote-activation-evidence:v1';
export const SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX = 'wsne1';
export const SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_MAX_BYTES = 32 * 1024;
export const SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS = 24;
export const SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS = 5_000;

const ACTIVATION_KEYS = new Set([
  'desired',
  'incarnationId',
  'providerAddress',
  'sshIdentity',
  'artifactPath',
]);
const SSH_IDENTITY_KEYS = new Set([
  'privateKeyPath',
  'publicKey',
  'publicKeyFingerprint',
  'knownHostsPath',
]);
const FACTORY_KEYS = new Set([
  'runProcess',
  'ensureHostKey',
  'createTransport',
  'openArtifactSource',
  'sleep',
]);
const EVIDENCE_CONTEXT_KEYS = new Set([
  'desired',
  'incarnationId',
  'providerAddress',
  'sshHostKeyFingerprint',
  'sshPublicKeyFingerprint',
]);
const EVIDENCE_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'incarnationId',
  'desiredRevisionId',
  'address',
  'sshHostKey',
  'bootstrap',
  'artifact',
  'service',
]);
const EVIDENCE_DOCUMENT_KEYS = new Set([
  'activationEvidenceId',
  ...EVIDENCE_PAYLOAD_KEYS,
]);
const EVIDENCE_SSH_HOST_KEY_KEYS = new Set(['algorithm', 'fingerprint']);
const EVIDENCE_BOOTSTRAP_KEYS = new Set([
  'contractVersion',
  'sshPublicKeyFingerprint',
]);
const EVIDENCE_ARTIFACT_KEYS = new Set([
  'artifactId',
  'revisionId',
  'byteDigest',
  'size',
  'remotePath',
]);
const EVIDENCE_SERVICE_KEYS = new Set([
  'appId',
  'unit',
  'health',
  'activeArtifactId',
  'activeRevisionId',
]);
const MAX_LOCAL_PATH_BYTES = 16 * 1024;
const MAX_BOOTSTRAP_IDENTITY_BYTES = 16 * 1024;
const MAX_SERVICE_RESULT_BYTES = 64 * 1024;
const MAX_SERVICE_STATUS_BYTES = 256 * 1024;
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * @param {unknown} value - Candidate plain object.
 * @param {Set<string>} expectedKeys - Exact fields.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, any>} - Independent shallow snapshot.
 */
function snapshotExactObject(value, expectedKeys, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !expectedKeys.has(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(`${valuePath} must contain only its exact fields.`);
  }
  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(
        `${valuePath}.${key} must be an own enumerable data property.`,
      );
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

/**
 * @param {unknown} value - Candidate local path.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical absolute path.
 */
function localPathValue(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_LOCAL_PATH_BYTES ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !isAbsolute(value) ||
    normalize(value) !== value
  ) {
    throw new TypeError(`${valuePath} must be a canonical absolute path.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate provider endpoint.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - Canonical numeric IPv4 address.
 */
function providerAddressValue(
  value,
  valuePath = 'singleNodeRemoteActivation.providerAddress',
) {
  if (
    typeof value !== 'string' ||
    value.length > 15 ||
    !isIPv4(value) ||
    value !== value.split('.').map(Number).join('.')
  ) {
    throw new TypeError(
      `${valuePath} must be one canonical numeric IPv4 address.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate public SSH fingerprint.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical fingerprint.
 */
function sshFingerprintValue(value, valuePath) {
  if (typeof value !== 'string' || !SSH_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be one canonical SHA-256 SSH fingerprint.`,
    );
  }
  const encoded = value.slice('SHA256:'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.byteLength !== 32 ||
    bytes.toString('base64').replace(/=+$/u, '') !== encoded
  ) {
    throw new TypeError(
      `${valuePath} must be one canonical SHA-256 SSH fingerprint.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate SSH identity.
 * @returns {Readonly<{privateKeyPath: string, publicKey: string, publicKeyFingerprint: string, knownHostsPath: string}>} - Exact identity projection.
 */
function validateSshIdentity(value) {
  const input = snapshotExactObject(
    value,
    SSH_IDENTITY_KEYS,
    'singleNodeRemoteActivation.sshIdentity',
  );
  const key = validateSshEd25519PublicKey(
    input.publicKey,
    'singleNodeRemoteActivation.sshIdentity.publicKey',
  );
  if (
    sshFingerprintValue(
      input.publicKeyFingerprint,
      'singleNodeRemoteActivation.sshIdentity.publicKeyFingerprint',
    ) !== key.fingerprint
  ) {
    throw new TypeError(
      'singleNodeRemoteActivation.sshIdentity.publicKeyFingerprint must match its public key.',
    );
  }
  const privateKeyPath = localPathValue(
    input.privateKeyPath,
    'singleNodeRemoteActivation.sshIdentity.privateKeyPath',
  );
  const knownHostsPath = localPathValue(
    input.knownHostsPath,
    'singleNodeRemoteActivation.sshIdentity.knownHostsPath',
  );
  if (privateKeyPath === knownHostsPath) {
    throw new TypeError(
      'singleNodeRemoteActivation SSH identity paths must differ.',
    );
  }
  return Object.freeze({
    privateKeyPath,
    publicKey: key.publicKey,
    publicKeyFingerprint: key.fingerprint,
    knownHostsPath,
  });
}

/**
 * @param {unknown} value - Candidate activation input.
 * @returns {Readonly<Record<string, any>>} - Validated input.
 */
function validateActivationInput(value) {
  const input = snapshotExactObject(
    value,
    ACTIVATION_KEYS,
    'singleNodeRemoteActivation',
  );
  const desired = validateSingleNodeDeploymentDesired(
    input.desired,
    'singleNodeRemoteActivation.desired',
  );
  assertSingleNodeDeploymentIncarnationId(
    input.incarnationId,
    'singleNodeRemoteActivation.incarnationId',
  );
  return Object.freeze({
    desired,
    incarnationId: input.incarnationId,
    providerAddress: providerAddressValue(input.providerAddress),
    sshIdentity: validateSshIdentity(input.sshIdentity),
    artifactPath: localPathValue(
      input.artifactPath,
      'singleNodeRemoteActivation.artifactPath',
    ),
  });
}

/**
 * @param {Readonly<Record<string, any>>} input - Validated activation input.
 * @returns {Readonly<Record<string, any>>} - Exact expected remote identity.
 */
function expectedBootstrapIdentity(input) {
  return Object.freeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'singleNodeBootstrapIdentity',
      deploymentInstanceId: input.desired.deploymentInstanceId,
      incarnationId: input.incarnationId,
      contract: {
        kind: 'single-node-systemd-user',
        version: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
      },
      runtimeAccount: SINGLE_NODE_RUNTIME_ACCOUNT,
      sshPublicKeyFingerprint: input.sshIdentity.publicKeyFingerprint,
    }),
  );
}

/**
 * Derive every remote artifact path exclusively from validated durable
 * authority. The temporary path is stable for one incarnation and artifact,
 * so each retry removes and reuses the same name instead of leaking orphans.
 * @param {Readonly<Record<string, any>>} desired - Exact desired state.
 * @param {string} incarnationId - Exact deployment incarnation.
 * @returns {Readonly<{artifactDirectory: string, remoteArtifactPath: string, temporaryPath: string}>} - Canonical remote paths.
 */
function getRemoteArtifactPaths(desired, incarnationId) {
  const artifactDirectory = posix.join(
    SINGLE_NODE_DEPLOYMENT_ROOT,
    desired.deploymentInstanceId,
    'artifacts',
    desired.artifact.artifactId,
  );
  return Object.freeze({
    artifactDirectory,
    remoteArtifactPath: posix.join(artifactDirectory, 'app-sea'),
    temporaryPath: posix.join(
      artifactDirectory,
      `.app-sea.upload-${incarnationId}`,
    ),
  });
}

/**
 * @param {unknown} value - Candidate byte output.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Buffer} - Exact byte view.
 */
function outputBytes(value, valuePath) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error(`${valuePath} returned invalid bounded output.`);
}

/**
 * @param {unknown} outcome - Bounded process outcome.
 * @returns {boolean} - Whether the remote command exited successfully.
 */
function succeeded(outcome) {
  return (
    outcome !== null &&
    typeof outcome === 'object' &&
    /** @type {Record<string, any>} */ (outcome).status === 'exited' &&
    /** @type {Record<string, any>} */ (outcome).exitCode === 0
  );
}

/**
 * @param {unknown} bytesValue - Bounded UTF-8 JSON bytes.
 * @param {number} maximumBytes - Exact byte bound.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, any>} - Independent JSON object.
 */
function decodeJsonObject(bytesValue, maximumBytes, valuePath) {
  const bytes = outputBytes(bytesValue, valuePath);
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`${valuePath} exceeded its bounded response size.`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${valuePath} returned invalid UTF-8.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${valuePath} returned invalid JSON.`);
  }
  return cloneBoundedJsonObject(parsed, maximumBytes, valuePath);
}

/**
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} - Whether canonical JSON is identical.
 */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(cloneJsonObject(left, 'left'))) ===
    JSON.stringify(sortCanonicalJsonValue(cloneJsonObject(right, 'right')))
  );
}

/**
 * @param {Record<string, any>} actual - Decoded remote identity.
 * @param {Readonly<Record<string, any>>} expected - Exact expected identity.
 * @returns {void}
 */
function assertBootstrapIdentity(actual, expected) {
  if (!sameJson(actual, expected)) {
    throw new Error(
      'Remote bootstrap identity does not match the requested deployment incarnation.',
    );
  }
}

/**
 * @param {Record<string, any>} result - Decoded converge receipt.
 * @param {Readonly<Record<string, any>>} desired - Exact desired state.
 * @returns {void}
 */
function assertConvergeResult(result, desired) {
  if (
    result.schemaVersion !== 1 ||
    result.kind !== 'wharfie.service.result' ||
    result.action !== 'converge' ||
    result.appId !== desired.intent.appId ||
    result.requestStatus !== 'fulfilled' ||
    result.outcome !== 'target-active' ||
    result.health !== 'healthy' ||
    result.activeArtifactId !== desired.artifact.artifactId ||
    result.activeRevisionId !== desired.artifact.revisionId
  ) {
    throw new Error(
      'Remote service convergence did not prove the exact desired artifact active.',
    );
  }
}

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether value is a non-array object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value - Candidate release reference.
 * @param {Readonly<Record<string, any>>} desired - Exact desired state.
 * @returns {boolean} - Whether it names the exact desired release.
 */
function isDesiredRelease(value, desired) {
  return (
    isObject(value) &&
    value.artifactId === desired.artifact.artifactId &&
    value.revisionId === desired.artifact.revisionId
  );
}

/**
 * @param {Record<string, any>} status - Decoded service status.
 * @param {Readonly<Record<string, any>>} desired - Exact desired state.
 * @returns {{appId: string, unit: string, health: 'healthy', activeArtifactId: string, activeRevisionId: string}} - Safe exact status projection.
 */
function validateServiceStatus(status, desired) {
  const unit = `wharfie-${desired.intent.appId}.service`;
  const wiring = status.wiring;
  const installation = status.installation;
  const systemd = status.systemd;
  const runtime = status.runtime;
  const activation = status.activation;
  const integrity = status.integrity;
  const persistence = status.persistence;
  const convergence = status.desiredConvergence;
  if (
    status.schemaVersion !== 3 ||
    status.kind !== 'wharfie.service.status' ||
    status.appId !== desired.intent.appId ||
    status.unit !== unit ||
    status.health !== 'healthy' ||
    !isObject(wiring) ||
    wiring.state !== 'managed' ||
    wiring.unitFile !== 'managed' ||
    wiring.selection !== 'managed' ||
    wiring.effectiveUnit !== 'managed' ||
    wiring.cleanupPending !== false ||
    !isObject(installation) ||
    installation.state !== 'installed' ||
    installation.activeArtifactId !== desired.artifact.artifactId ||
    installation.activeRevisionId !== desired.artifact.revisionId ||
    !isObject(systemd) ||
    systemd.loadState !== 'loaded' ||
    systemd.unitFileState !== 'enabled' ||
    systemd.activeState !== 'active' ||
    systemd.subState !== 'running' ||
    systemd.result !== 'success' ||
    !isObject(runtime) ||
    runtime.status !== 'READY' ||
    runtime.session !== 'active' ||
    runtime.currentOwner !== true ||
    runtime.artifactId !== desired.artifact.artifactId ||
    runtime.revisionId !== desired.artifact.revisionId ||
    !isObject(activation) ||
    activation.phase !== 'ACTIVE' ||
    !isDesiredRelease(activation.desired, desired) ||
    !isDesiredRelease(activation.selected, desired) ||
    !isObject(integrity) ||
    integrity.status !== 'verified' ||
    !isDesiredRelease(integrity, desired) ||
    !isObject(persistence) ||
    persistence.linger !== true ||
    persistence.unitEnabled !== true ||
    persistence.bootEnabled !== true ||
    !isObject(convergence) ||
    convergence.schemaVersion !== 1 ||
    convergence.kind !== 'wharfie.service.desired-convergence' ||
    convergence.appId !== desired.intent.appId ||
    convergence.unit !== unit ||
    convergence.disposition !== 'authorized' ||
    convergence.basis !== 'durable-active' ||
    !isDesiredRelease(convergence.desired, desired)
  ) {
    throw new Error(
      'Remote service status did not prove the exact desired artifact durably healthy.',
    );
  }
  return Object.freeze({
    appId: desired.intent.appId,
    unit,
    health: /** @type {const} */ ('healthy'),
    activeArtifactId: desired.artifact.artifactId,
    activeRevisionId: desired.artifact.revisionId,
  });
}

/**
 * @param {Buffer} output - sha256sum output.
 * @param {string} path - Exact hashed remote path.
 * @param {string} expectedHex - Expected lowercase hex SHA-256.
 * @returns {void}
 */
function assertRemoteDigest(output, path, expectedHex) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch {
    throw new Error('Remote artifact SHA-256 evidence was invalid.');
  }
  if (text !== `${expectedHex}  ${path}\n`) {
    throw new Error(
      'Remote artifact SHA-256 does not match the exact local artifact.',
    );
  }
}

/**
 * @template T
 * @param {T} value - JSON value.
 * @returns {T} - Deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Preserve both an activation failure and a held-descriptor close failure.
 * @template T
 * @param {unknown} source - Acquired held artifact source.
 * @param {(source: Record<string, any>) => Promise<T>} operation - Entire post-open operation.
 * @returns {Promise<T>} - Operation result after guaranteed close.
 */
async function withClosedArtifactSource(source, operation) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError(
      'singleNodeRemoteActivator artifact source must provide close().',
    );
  }
  const artifactSource = /** @type {Record<string, any>} */ (source);
  if (typeof artifactSource.close !== 'function') {
    throw new TypeError(
      'singleNodeRemoteActivator artifact source must provide close().',
    );
  }
  const close = artifactSource.close.bind(artifactSource);
  let operationFailed = false;
  /** @type {unknown} */
  let operationError;
  /** @type {T|undefined} */
  let result;
  try {
    result = await operation(artifactSource);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  let closeFailed = false;
  /** @type {unknown} */
  let closeError;
  try {
    await close();
  } catch (error) {
    closeFailed = true;
    closeError = error;
  }
  if (operationFailed && closeFailed) {
    throw new AggregateError(
      [operationError, closeError],
      'Single-node remote activation and artifact source cleanup both failed.',
    );
  }
  if (operationFailed) throw operationError;
  if (closeFailed) throw closeError;
  return /** @type {T} */ (result);
}

/**
 * @param {unknown} value - Candidate evidence authority.
 * @returns {Readonly<Record<string, any>>} - Exact independently validated authority.
 */
function validateEvidenceContext(value) {
  const input = snapshotExactObject(
    value,
    EVIDENCE_CONTEXT_KEYS,
    'singleNodeRemoteActivationEvidence context',
  );
  const desired = validateSingleNodeDeploymentDesired(
    input.desired,
    'singleNodeRemoteActivationEvidence context.desired',
  );
  assertSingleNodeDeploymentIncarnationId(
    input.incarnationId,
    'singleNodeRemoteActivationEvidence context.incarnationId',
  );
  return Object.freeze({
    desired,
    incarnationId: input.incarnationId,
    providerAddress: providerAddressValue(
      input.providerAddress,
      'singleNodeRemoteActivationEvidence context.providerAddress',
    ),
    sshHostKeyFingerprint: sshFingerprintValue(
      input.sshHostKeyFingerprint,
      'singleNodeRemoteActivationEvidence context.sshHostKeyFingerprint',
    ),
    sshPublicKeyFingerprint: sshFingerprintValue(
      input.sshPublicKeyFingerprint,
      'singleNodeRemoteActivationEvidence context.sshPublicKeyFingerprint',
    ),
  });
}

/**
 * Validate one complete credential-free activation proof against its exact
 * desired state, incarnation, provider endpoint, host key, and bootstrap key.
 * The returned document is an independent canonical frozen clone suitable for
 * direct journal persistence.
 * @param {unknown} value - Candidate serialized activation evidence.
 * @param {{desired: unknown, incarnationId: string, providerAddress: string, sshHostKeyFingerprint: string, sshPublicKeyFingerprint: string}} contextValue - Exact durable authority.
 * @returns {Readonly<Record<string, any>>} - Canonical journal-safe evidence.
 */
export function validateSingleNodeRemoteActivationEvidence(
  value,
  contextValue,
) {
  const context = validateEvidenceContext(contextValue);
  const cloned = cloneBoundedJsonObject(
    value,
    SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_MAX_BYTES,
    'singleNodeRemoteActivationEvidence',
  );
  const document = snapshotExactObject(
    cloned,
    EVIDENCE_DOCUMENT_KEYS,
    'singleNodeRemoteActivationEvidence',
  );
  assertDomainSeparatedSha256Id(
    document.activationEvidenceId,
    SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
    'singleNodeRemoteActivationEvidence.activationEvidenceId',
  );
  if (
    document.schemaVersion !==
      SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION ||
    document.kind !== SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND ||
    document.deploymentInstanceId !== context.desired.deploymentInstanceId ||
    document.incarnationId !== context.incarnationId ||
    document.desiredRevisionId !== context.desired.desiredRevisionId ||
    document.address !== context.providerAddress
  ) {
    throw new Error(
      'singleNodeRemoteActivationEvidence does not match its exact deployment authority.',
    );
  }

  const sshHostKey = snapshotExactObject(
    document.sshHostKey,
    EVIDENCE_SSH_HOST_KEY_KEYS,
    'singleNodeRemoteActivationEvidence.sshHostKey',
  );
  if (
    sshHostKey.algorithm !== 'ssh-ed25519' ||
    sshFingerprintValue(
      sshHostKey.fingerprint,
      'singleNodeRemoteActivationEvidence.sshHostKey.fingerprint',
    ) !== context.sshHostKeyFingerprint
  ) {
    throw new Error(
      'singleNodeRemoteActivationEvidence SSH host key does not match its exact authority.',
    );
  }

  const bootstrap = snapshotExactObject(
    document.bootstrap,
    EVIDENCE_BOOTSTRAP_KEYS,
    'singleNodeRemoteActivationEvidence.bootstrap',
  );
  if (
    bootstrap.contractVersion !== SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION ||
    sshFingerprintValue(
      bootstrap.sshPublicKeyFingerprint,
      'singleNodeRemoteActivationEvidence.bootstrap.sshPublicKeyFingerprint',
    ) !== context.sshPublicKeyFingerprint
  ) {
    throw new Error(
      'singleNodeRemoteActivationEvidence bootstrap key does not match its exact authority.',
    );
  }

  const artifact = snapshotExactObject(
    document.artifact,
    EVIDENCE_ARTIFACT_KEYS,
    'singleNodeRemoteActivationEvidence.artifact',
  );
  const expectedRemotePath = getRemoteArtifactPaths(
    context.desired,
    context.incarnationId,
  ).remoteArtifactPath;
  if (
    artifact.artifactId !== context.desired.artifact.artifactId ||
    artifact.revisionId !== context.desired.artifact.revisionId ||
    !sameJson(artifact.byteDigest, context.desired.artifact.byteDigest) ||
    artifact.size !== context.desired.artifact.size ||
    artifact.remotePath !== expectedRemotePath
  ) {
    throw new Error(
      'singleNodeRemoteActivationEvidence artifact does not match the exact desired state.',
    );
  }

  const service = snapshotExactObject(
    document.service,
    EVIDENCE_SERVICE_KEYS,
    'singleNodeRemoteActivationEvidence.service',
  );
  const expectedUnit = `wharfie-${context.desired.intent.appId}.service`;
  if (
    service.appId !== context.desired.intent.appId ||
    service.unit !== expectedUnit ||
    service.health !== 'healthy' ||
    service.activeArtifactId !== context.desired.artifact.artifactId ||
    service.activeRevisionId !== context.desired.artifact.revisionId
  ) {
    throw new Error(
      'singleNodeRemoteActivationEvidence service does not match the exact desired state.',
    );
  }

  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: context.desired.deploymentInstanceId,
    incarnationId: context.incarnationId,
    desiredRevisionId: context.desired.desiredRevisionId,
    address: context.providerAddress,
    sshHostKey: {
      algorithm: 'ssh-ed25519',
      fingerprint: context.sshHostKeyFingerprint,
    },
    bootstrap: {
      contractVersion: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
      sshPublicKeyFingerprint: context.sshPublicKeyFingerprint,
    },
    artifact: {
      artifactId: context.desired.artifact.artifactId,
      revisionId: context.desired.artifact.revisionId,
      byteDigest: context.desired.artifact.byteDigest,
      size: context.desired.artifact.size,
      remotePath: expectedRemotePath,
    },
    service: {
      appId: context.desired.intent.appId,
      unit: expectedUnit,
      health: 'healthy',
      activeArtifactId: context.desired.artifact.artifactId,
      activeRevisionId: context.desired.artifact.revisionId,
    },
  });
  assertManifestIsSecretFree(payload, 'singleNodeRemoteActivationEvidence');
  const expectedId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
    prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
    value: payload,
    valuePath: 'singleNodeRemoteActivationEvidence',
  });
  if (document.activationEvidenceId !== expectedId) {
    throw new Error(
      'singleNodeRemoteActivationEvidence.activationEvidenceId does not match its canonical evidence.',
    );
  }
  const normalized = sortCanonicalJsonValue({
    ...payload,
    activationEvidenceId: expectedId,
  });
  if (
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') >
    SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_MAX_BYTES
  ) {
    throw new RangeError(
      `singleNodeRemoteActivationEvidence must not exceed ${SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  return deepFreeze(normalized);
}

/**
 * @param {Readonly<Record<string, any>>} input - Exact activation input.
 * @param {Readonly<Record<string, any>>} hostKey - Enrolled host-key evidence.
 * @param {string} remoteArtifactPath - Exact installed artifact path.
 * @param {Readonly<Record<string, any>>} service - Exact service projection.
 * @returns {Readonly<Record<string, any>>} - Content-addressed journal-safe evidence.
 */
function createActivationEvidence(input, hostKey, remoteArtifactPath, service) {
  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: input.desired.deploymentInstanceId,
    incarnationId: input.incarnationId,
    desiredRevisionId: input.desired.desiredRevisionId,
    address: input.providerAddress,
    sshHostKey: {
      algorithm: 'ssh-ed25519',
      fingerprint: hostKey.fingerprint,
    },
    bootstrap: {
      contractVersion: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
      sshPublicKeyFingerprint: input.sshIdentity.publicKeyFingerprint,
    },
    artifact: {
      artifactId: input.desired.artifact.artifactId,
      revisionId: input.desired.artifact.revisionId,
      byteDigest: input.desired.artifact.byteDigest,
      size: input.desired.artifact.size,
      remotePath: remoteArtifactPath,
    },
    service,
  });
  const activationEvidenceId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
    prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
    value: payload,
    valuePath: 'singleNodeRemoteActivationEvidence',
  });
  return validateSingleNodeRemoteActivationEvidence(
    { ...payload, activationEvidenceId },
    {
      desired: input.desired,
      incarnationId: input.incarnationId,
      providerAddress: input.providerAddress,
      sshHostKeyFingerprint: hostKey.fingerprint,
      sshPublicKeyFingerprint: input.sshIdentity.publicKeyFingerprint,
    },
  );
}

/**
 * Create the provider-neutral SSH activation boundary. The caller must supply
 * an address just read back from the exact provider-owned server.
 * @param {{runProcess: {run(options: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}, ensureHostKey?: typeof ensureDeploymentSshHostKey, createTransport?: typeof createDeploymentOpenSshTransport, openArtifactSource?: typeof openHeldArtifactSource, sleep?: (milliseconds: number) => Promise<unknown>}} options - Process authority and optional deterministic seams.
 * @returns {{activate(value: unknown): Promise<Readonly<Record<string, any>>>}} - Exact remote activation operation.
 */
export function createSingleNodeRemoteActivator(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError('singleNodeRemoteActivator options must be an object.');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !FACTORY_KEYS.has(key)) {
      throw new TypeError(
        'singleNodeRemoteActivator options contain unsupported fields.',
      );
    }
  }
  if (
    options.runProcess === null ||
    typeof options.runProcess !== 'object' ||
    typeof options.runProcess.run !== 'function'
  ) {
    throw new TypeError(
      'singleNodeRemoteActivator.runProcess must provide run().',
    );
  }
  const runProcess = options.runProcess;
  const ensureHostKey = options.ensureHostKey || ensureDeploymentSshHostKey;
  const createTransport =
    options.createTransport || createDeploymentOpenSshTransport;
  const openArtifactSource =
    options.openArtifactSource || openHeldArtifactSource;
  const sleep =
    options.sleep ||
    (async (milliseconds) => {
      await sleepWithTimer(milliseconds);
    });
  for (const [name, dependency] of [
    ['ensureHostKey', ensureHostKey],
    ['createTransport', createTransport],
    ['openArtifactSource', openArtifactSource],
    ['sleep', sleep],
  ]) {
    if (typeof dependency !== 'function') {
      throw new TypeError(
        `singleNodeRemoteActivator.${name} must be a function.`,
      );
    }
  }

  /**
   * @param {(attempt: number) => Promise<any>} operation - Retriable operation.
   * @param {string} failureMessage - Safe terminal failure.
   * @returns {Promise<any>} - First successful result.
   */
  async function retryReadiness(operation, failureMessage) {
    for (
      let attempt = 1;
      attempt <= SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result = await operation(attempt);
        if (result !== undefined) return result;
      } catch {
        // Endpoint creation, cloud-init, and sshd startup are expected to race.
      }
      if (attempt < SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS) {
        try {
          await sleep(SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS);
        } catch {
          throw new Error(failureMessage);
        }
      }
    }
    throw new Error(failureMessage);
  }

  return Object.freeze({
    /**
     * Enroll the exact host, prove bootstrap identity, install exact bytes,
     * and converge the packaged durable service.
     * @param {unknown} value - Exact activation request.
     * @returns {Promise<Readonly<Record<string, any>>>} - Credential-free durable evidence.
     */
    async activate(value) {
      const input = validateActivationInput(value);
      const hostKey = await retryReadiness(async () => {
        const evidence = await ensureHostKey({
          address: input.providerAddress,
          knownHostsPath: input.sshIdentity.knownHostsPath,
          runProcess,
        });
        if (
          !isObject(evidence) ||
          evidence.address !== input.providerAddress ||
          evidence.algorithm !== 'ssh-ed25519' ||
          sshFingerprintValue(
            evidence.fingerprint,
            'singleNodeRemoteActivator SSH host-key fingerprint',
          ) !== evidence.fingerprint
        ) {
          throw new Error('invalid host-key evidence');
        }
        return evidence;
      }, 'Single-node SSH host key could not be established before the bounded deadline.');
      const transport = createTransport({
        address: input.providerAddress,
        privateKeyPath: input.sshIdentity.privateKeyPath,
        knownHostsPath: input.sshIdentity.knownHostsPath,
        runProcess,
      });
      if (
        transport === null ||
        typeof transport !== 'object' ||
        typeof transport.runRemoteArgv !== 'function'
      ) {
        throw new TypeError(
          'singleNodeRemoteActivator transport must provide runRemoteArgv().',
        );
      }
      const runRemoteArgv = transport.runRemoteArgv.bind(transport);

      await retryReadiness(async () => {
        const outcome = await runRemoteArgv({
          argv: ['/usr/bin/test', '-f', SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH],
          stdin: null,
          timeoutMilliseconds: 20_000,
          maximumStdoutBytes: 0,
          maximumStderrBytes: 8 * 1024,
        });
        return succeeded(outcome) ? true : undefined;
      }, 'Single-node bootstrap did not become ready before the bounded deadline.');

      const identityOutcome = await runRemoteArgv({
        argv: ['/usr/bin/cat', '--', SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH],
        stdin: null,
        timeoutMilliseconds: 20_000,
        maximumStdoutBytes: MAX_BOOTSTRAP_IDENTITY_BYTES,
        maximumStderrBytes: 8 * 1024,
      });
      if (!succeeded(identityOutcome)) {
        throw new Error('Remote bootstrap identity could not be read.');
      }
      assertBootstrapIdentity(
        decodeJsonObject(
          /** @type {Record<string, any>} */ (identityOutcome).stdout,
          MAX_BOOTSTRAP_IDENTITY_BYTES,
          'remote bootstrap identity',
        ),
        expectedBootstrapIdentity(input),
      );

      const source = await openArtifactSource(input.artifactPath);
      return await withClosedArtifactSource(source, async (artifactSource) => {
        if (
          typeof artifactSource.createReadStream !== 'function' ||
          typeof artifactSource.verifyUnchanged !== 'function'
        ) {
          throw new Error(
            'Local artifact source does not provide exact held-byte operations.',
          );
        }
        const sourceObservation = artifactSource.observation;
        if (
          !sameJson(sourceObservation, {
            artifactId: input.desired.artifact.artifactId,
            byteDigest: input.desired.artifact.byteDigest,
            size: input.desired.artifact.size,
          })
        ) {
          throw new Error(
            'Local artifact source does not match the exact desired artifact.',
          );
        }
        const { artifactDirectory, remoteArtifactPath, temporaryPath } =
          getRemoteArtifactPaths(input.desired, input.incarnationId);

        /**
         * @param {string[]} argv - Exact remote argv.
         * @param {Buffer|import('node:stream').Readable|null} stdin - Optional input.
         * @param {number} timeoutMilliseconds - Finite duration.
         * @param {number} maximumStdoutBytes - Bounded stdout.
         * @param {string} failureMessage - Safe failure.
         * @returns {Promise<Record<string, any>>} - Successful outcome.
         */
        async function runRequired(
          argv,
          stdin,
          timeoutMilliseconds,
          maximumStdoutBytes,
          failureMessage,
        ) {
          const outcome = await runRemoteArgv({
            argv,
            stdin,
            timeoutMilliseconds,
            maximumStdoutBytes,
            maximumStderrBytes: 16 * 1024,
          });
          if (!succeeded(outcome)) throw new Error(failureMessage);
          return /** @type {Record<string, any>} */ (outcome);
        }

        try {
          await runRequired(
            ['/usr/bin/install', '-d', '-m', '0700', artifactDirectory],
            null,
            30_000,
            0,
            'Remote artifact directory could not be prepared.',
          );
          await runRequired(
            ['/usr/bin/rm', '-f', '--', temporaryPath],
            null,
            30_000,
            0,
            'Stale remote temporary artifact could not be removed.',
          );
          const uploadStream = artifactSource.createReadStream();
          await runRequired(
            [
              '/usr/bin/dd',
              `of=${temporaryPath}`,
              'bs=65536',
              'status=none',
              'oflag=excl',
              'conv=fsync',
            ],
            uploadStream,
            10 * 60 * 1000,
            0,
            'Remote artifact upload did not complete exactly.',
          );
          const verified = await artifactSource.verifyUnchanged();
          if (!sameJson(verified, sourceObservation)) {
            throw new Error(
              'Local artifact bytes changed while they were uploaded.',
            );
          }
          const expectedHex = Buffer.from(
            input.desired.artifact.byteDigest.value,
            'base64url',
          ).toString('hex');
          const temporaryDigest = await runRequired(
            ['/usr/bin/sha256sum', '--', temporaryPath],
            null,
            30_000,
            4 * 1024,
            'Remote temporary artifact SHA-256 could not be read.',
          );
          assertRemoteDigest(
            outputBytes(
              temporaryDigest.stdout,
              'remote temporary artifact SHA-256',
            ),
            temporaryPath,
            expectedHex,
          );
          await runRequired(
            ['/usr/bin/chmod', '0500', temporaryPath],
            null,
            30_000,
            0,
            'Remote temporary artifact could not be made executable.',
          );

          const linkOutcome = await runRemoteArgv({
            argv: ['/usr/bin/ln', '--', temporaryPath, remoteArtifactPath],
            stdin: null,
            timeoutMilliseconds: 30_000,
            maximumStdoutBytes: 0,
            maximumStderrBytes: 16 * 1024,
          });
          if (!succeeded(linkOutcome)) {
            const existingDigest = await runRequired(
              ['/usr/bin/sha256sum', '--', remoteArtifactPath],
              null,
              30_000,
              4 * 1024,
              'Existing remote artifact conflicts with the desired artifact.',
            );
            assertRemoteDigest(
              outputBytes(
                existingDigest.stdout,
                'existing remote artifact SHA-256',
              ),
              remoteArtifactPath,
              expectedHex,
            );
            await runRequired(
              ['/usr/bin/test', '-x', remoteArtifactPath],
              null,
              20_000,
              0,
              'Existing remote artifact is not executable.',
            );
          }
          await runRequired(
            ['/usr/bin/rm', '-f', '--', temporaryPath],
            null,
            30_000,
            0,
            'Remote temporary artifact could not be removed.',
          );

          const installedDigest = await runRequired(
            ['/usr/bin/sha256sum', '--', remoteArtifactPath],
            null,
            30_000,
            4 * 1024,
            'Installed remote artifact SHA-256 could not be read.',
          );
          assertRemoteDigest(
            outputBytes(
              installedDigest.stdout,
              'installed remote artifact SHA-256',
            ),
            remoteArtifactPath,
            expectedHex,
          );

          const convergeOutcome = await runRequired(
            [remoteArtifactPath, 'wharfie', 'service', 'converge', '--json'],
            null,
            10 * 60 * 1000,
            MAX_SERVICE_RESULT_BYTES,
            'Remote service convergence did not complete successfully.',
          );
          const convergeResult = decodeJsonObject(
            convergeOutcome.stdout,
            MAX_SERVICE_RESULT_BYTES,
            'remote service convergence',
          );
          assertConvergeResult(convergeResult, input.desired);

          const statusOutcome = await runRequired(
            [remoteArtifactPath, 'wharfie', 'service', 'status', '--json'],
            null,
            2 * 60 * 1000,
            MAX_SERVICE_STATUS_BYTES,
            'Remote service status could not be read successfully.',
          );
          const service = validateServiceStatus(
            decodeJsonObject(
              statusOutcome.stdout,
              MAX_SERVICE_STATUS_BYTES,
              'remote service status',
            ),
            input.desired,
          );
          return createActivationEvidence(
            input,
            hostKey,
            remoteArtifactPath,
            service,
          );
        } catch (error) {
          try {
            await runRemoteArgv({
              argv: ['/usr/bin/rm', '-f', '--', temporaryPath],
              stdin: null,
              timeoutMilliseconds: 30_000,
              maximumStdoutBytes: 0,
              maximumStderrBytes: 8 * 1024,
            });
          } catch {
            // The deterministic private temp name is pre-cleaned on retry.
          }
          throw error;
        }
      });
    },
  });
}

/**
 * Create the production remote activator with the bounded subprocess runner.
 * @returns {ReturnType<typeof createSingleNodeRemoteActivator>} - Production operation.
 */
export function createProductionSingleNodeRemoteActivator() {
  return createSingleNodeRemoteActivator({
    runProcess: createBoundedProcessRunner(),
  });
}

export default {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_MAX_BYTES,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
  SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS,
  SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS,
  createProductionSingleNodeRemoteActivator,
  createSingleNodeRemoteActivator,
  validateSingleNodeRemoteActivationEvidence,
};
