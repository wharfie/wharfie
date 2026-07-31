/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This strict durable-state boundary keeps its exact schemas and transition contracts together. */

import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { validateSha256Digest } from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneBoundedJsonObject } from './json-value.js';
import {
  createLocalAppStorageLayout,
  resolveStableLocalAppDataRoot,
} from './local-app-storage.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  createAwsProvisionedResourceRecord,
  validateAwsDeletionRecord,
  validateAwsDestructionAttempt,
  validateAwsProvisionedResourceRecord,
  validateAwsProvisioningMutationAttempt,
} from './providers/aws/single-node-journal-evidence.js';
import { validateAwsSingleNodeProvisioningIntent } from './providers/aws/single-node-provisioning-intent.js';
import {
  validateHetznerDeletionRecord,
  validateHetznerDestructionAttempt,
} from './providers/hetzner/single-node-destruction.js';
import {
  createHetznerProvisionedResourceRecord,
  validateHetznerProvisionedResourceRecord,
  validateHetznerProvisioningMutationAttempt,
  validateHetznerSingleNodeProvisioningIntent,
} from './providers/hetzner/single-node-provisioning.js';
import { validateSingleNodeDeploymentDesired } from './single-node-deployment-desired.js';
import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
} from './single-node-deployment-identity.js';
import { validateSingleNodeRemoteActivationEvidence } from './single-node-remote-activation.js';

export const SINGLE_NODE_DEPLOYMENT_JOURNAL_SCHEMA_VERSION = 3;
export const SINGLE_NODE_DEPLOYMENT_JOURNAL_KIND =
  'singleNodeDeploymentJournal';
export const SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN =
  'wharfie:single-node-deployment-journal:v3';
export const SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX = 'wsnj3';
export const SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES = 1024 * 1024;
export const SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS = 4096;
export const SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE = 32;

const SINGLE_NODE_DEPLOYMENT_RELEASE_UPDATE_RECORDS = 3;

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEPLOYMENTS_DIRECTORY_NAME = 'single-node-deployments';
const STORAGE_VERSION_DIRECTORY_NAME = 'v3';
const JOURNAL_DIRECTORY_NAME = 'journal';
const JOURNAL_FILE_PATTERN = /^journal-([0-9]{16})\.json$/u;
const JOURNAL_TEMP_PATTERN =
  /^\.journal-([0-9]{16})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/u;
const SSH_FINGERPRINT_PATTERN = /^SHA256:([A-Za-z0-9+/]{43})$/u;
const HETZNER_RESOURCE_ROLES = new Set(['firewall', 'primaryIp', 'server']);
const HETZNER_DESTRUCTION_ROLES = Object.freeze([
  'server',
  'primaryIp',
  'firewall',
]);
const AWS_RESOURCE_ROLES = new Set(['securityGroup', 'instance', 'rootVolume']);
const AWS_DESTRUCTION_ROLES = Object.freeze([
  'instance',
  'rootVolume',
  'securityGroup',
]);
const AWS_RESOURCE_ID_PATTERNS = Object.freeze({
  securityGroup: /^sg-[0-9a-f]{8,32}$/u,
  instance: /^i-[0-9a-f]{8,32}$/u,
  rootVolume: /^vol-[0-9a-f]{8,32}$/u,
});
const PHASES = new Set([
  'planned',
  'provisioning',
  'provisioned',
  'activating',
  'active',
  'destroying',
  'destroyed',
]);
/** @type {Readonly<Record<string, Set<string>>>} */
const NEXT_PHASES = Object.freeze({
  planned: new Set(['provisioning', 'destroying']),
  provisioning: new Set(['provisioned', 'destroying']),
  provisioned: new Set(['activating', 'destroying']),
  activating: new Set(['active', 'destroying']),
  active: new Set(['destroying']),
  destroying: new Set(['destroyed']),
  destroyed: new Set(),
});
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'generation',
  'previousJournalId',
  'deploymentInstanceId',
  'incarnationId',
  'providerIntent',
  'phase',
  'mutationAttempts',
  'resources',
  'destroyAttempts',
  'deletionRecords',
  'sshHost',
  'release',
]);
const DOCUMENT_KEYS = new Set(['journalId', ...PAYLOAD_KEYS]);
const INITIALIZE_KEYS = new Set(['desired', 'providerIntent']);
const PROVIDER_INTENT_KEYS = new Set(['provider', 'intent']);
const RESOURCE_KEYS = new Set([
  'provider',
  'role',
  'providerResourceId',
  'publicIpv4',
  'state',
]);
const MUTATION_ATTEMPT_KEYS = new Set([
  'provider',
  'role',
  'operation',
  'state',
  'providerResourceId',
  'evidence',
]);
const SSH_HOST_KEYS = new Set(['address', 'algorithm', 'fingerprint']);
const ARTIFACT_KEYS = new Set([
  'artifactId',
  'byteDigest',
  'size',
  'remotePath',
]);
const RELEASE_STATE_KEYS = new Set(['current', 'rollback', 'transition']);
const RELEASE_KEYS = new Set(['desired', 'artifact', 'activation']);
const RELEASE_TRANSITION_KEYS = new Set(['kind', 'target']);
const COMMIT_KEYS = new Set([
  'expectedGeneration',
  'expectedJournalId',
  'next',
]);
const STORE_REQUIRED_KEYS = new Set(['appId', 'deploymentInstanceId']);
const STORE_OPTION_KEYS = new Set([
  ...STORE_REQUIRED_KEYS,
  'dataRoot',
  'platform',
  'homeDirectory',
  'expectedUid',
]);

/** Durable journal bytes or their filesystem envelope are invalid. */
export class SingleNodeDeploymentJournalInvalidError extends Error {
  constructor() {
    super('Single-node deployment journal state is invalid.');
    this.name = 'SingleNodeDeploymentJournalInvalidError';
    this.code = 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_INVALID';
  }
}

/** A journal generation was replaced by another local writer. */
export class SingleNodeDeploymentJournalConflictError extends Error {
  constructor() {
    super('Single-node deployment journal compare-and-set was rejected.');
    this.name = 'SingleNodeDeploymentJournalConflictError';
    this.code = 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_CONFLICT';
  }
}

/** The append-only preview journal reached its explicit safe bound. */
export class SingleNodeDeploymentJournalCapacityError extends Error {
  constructor() {
    super('Single-node deployment journal reached its safe record bound.');
    this.name = 'SingleNodeDeploymentJournalCapacityError';
    this.code = 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_CAPACITY';
  }
}

/** A new release would consume journal space reserved for safe recovery. */
export class SingleNodeDeploymentJournalRecoveryReserveError extends Error {
  constructor() {
    super(
      'Single-node deployment journal records are reserved for recovery and destruction.',
    );
    this.name = 'SingleNodeDeploymentJournalRecoveryReserveError';
    this.code = 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RESERVE';
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} error @param {string} code @returns {boolean} */
function hasCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === code
  );
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject inherited, accessor-backed, hidden, symbol, missing, and extra input.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Exact required keys.
 * @param {string} valuePath - Safe boundary label.
 * @returns {Record<string, any>} - Original exact data object.
 */
function exactDataObject(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${valuePath} must contain only its exact fields.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an enumerable value.`);
    }
  }
  return value;
}

/**
 * Validate an object with required and optional exact data fields.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} required - Required fields.
 * @param {Set<string>} allowed - Allowed fields.
 * @param {string} valuePath - Safe boundary label.
 * @returns {Record<string, any>} - Original object.
 */
function exactOptionsObject(value, required, allowed, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
    throw new TypeError(`${valuePath} must contain only supported fields.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${String(key)} must be data.`);
    }
  }
  return value;
}

/** @param {unknown} value @param {string} label @returns {number} */
function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label @returns {number} */
function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label @returns {string} */
function canonicalAbsolutePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 16 * 1024 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${label} must be one canonical absolute path.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label @returns {string} */
function canonicalRemotePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value
  ) {
    throw new TypeError(`${label} must be one canonical absolute POSIX path.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label @returns {string} */
function canonicalIpv4(value, label) {
  if (
    typeof value !== 'string' ||
    !isIPv4(value) ||
    value !== value.split('.').map(Number).join('.')
  ) {
    throw new TypeError(`${label} must be one canonical numeric IPv4 address.`);
  }
  return value;
}

/** @param {string} provider @returns {ReadonlySet<string>} */
function providerResourceRoles(provider) {
  if (provider === 'hetzner') return HETZNER_RESOURCE_ROLES;
  if (provider === 'aws') return AWS_RESOURCE_ROLES;
  throw new TypeError('singleNodeDeploymentJournal provider is unsupported.');
}

/** @param {string} provider @returns {readonly string[]} */
function providerDestructionRoles(provider) {
  if (provider === 'hetzner') return HETZNER_DESTRUCTION_ROLES;
  if (provider === 'aws') return AWS_DESTRUCTION_ROLES;
  throw new TypeError('singleNodeDeploymentJournal provider is unsupported.');
}

/** @param {string} provider @returns {string} */
function providerAddressRole(provider) {
  if (provider === 'hetzner') return 'primaryIp';
  if (provider === 'aws') return 'instance';
  throw new TypeError('singleNodeDeploymentJournal provider is unsupported.');
}

/**
 * @param {unknown} value
 * @param {string} provider
 * @param {string} role
 * @param {string} valuePath
 * @returns {number|string}
 */
function canonicalProviderResourceId(value, provider, role, valuePath) {
  if (provider === 'hetzner') {
    return positiveSafeInteger(value, valuePath);
  }
  if (provider === 'aws') {
    const pattern =
      AWS_RESOURCE_ID_PATTERNS[
        /** @type {keyof typeof AWS_RESOURCE_ID_PATTERNS} */ (role)
      ];
    if (typeof value !== 'string' || !pattern?.test(value)) {
      throw new TypeError(
        `${valuePath} is not a canonical ${role} AWS resource ID.`,
      );
    }
    return value;
  }
  throw new TypeError(`${valuePath} has an unsupported provider.`);
}

/**
 * Canonicalize the discriminated provider intent envelope.
 * @param {unknown} value - Candidate envelope.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical provider intent.
 */
function validateProviderIntent(value, valuePath) {
  const envelope = exactDataObject(value, PROVIDER_INTENT_KEYS, valuePath);
  let intent;
  if (envelope.provider === 'hetzner') {
    intent = validateHetznerSingleNodeProvisioningIntent(
      envelope.intent,
      `${valuePath}.intent`,
    );
  } else if (envelope.provider === 'aws') {
    intent = validateAwsSingleNodeProvisioningIntent(
      envelope.intent,
      `${valuePath}.intent`,
    );
  } else {
    throw new TypeError(`${valuePath}.provider is unsupported.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({ provider: envelope.provider, intent }),
  );
}

/**
 * Canonicalize one per-role provider mutation fence.
 * @param {unknown} value - Candidate attempt.
 * @param {Readonly<Record<string, any>>} authority - Immutable authority.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical attempt.
 */
function validateMutationAttempt(value, authority, valuePath) {
  const attempt = exactDataObject(value, MUTATION_ATTEMPT_KEYS, valuePath);
  if (
    (attempt.provider !== 'hetzner' && attempt.provider !== 'aws') ||
    attempt.provider !== authority.providerIntent.provider
  ) {
    throw new TypeError(`${valuePath}.provider does not match its intent.`);
  }
  const resourceRoles = providerResourceRoles(attempt.provider);
  if (!resourceRoles.has(attempt.role)) {
    throw new TypeError(`${valuePath}.role is unsupported.`);
  }
  if (attempt.state !== 'prepared' && attempt.state !== 'succeeded') {
    throw new TypeError(
      `${valuePath}.state must be 'prepared' or 'succeeded'.`,
    );
  }
  let providerResourceId = null;
  if (attempt.providerResourceId !== null) {
    providerResourceId = canonicalProviderResourceId(
      attempt.providerResourceId,
      attempt.provider,
      attempt.role,
      `${valuePath}.providerResourceId`,
    );
  }
  if (
    (attempt.state === 'prepared' && providerResourceId !== null) ||
    (attempt.state === 'succeeded' && providerResourceId === null)
  ) {
    throw new Error(`${valuePath} has inconsistent outcome evidence.`);
  }
  const evidence =
    attempt.provider === 'hetzner'
      ? validateHetznerProvisioningMutationAttempt(
          attempt.evidence,
          authority.providerIntent.intent,
          attempt.role,
          `${valuePath}.evidence`,
        )
      : validateAwsProvisioningMutationAttempt(
          attempt.evidence,
          authority.providerIntent.intent,
          attempt.role,
          `${valuePath}.evidence`,
        );
  if (
    evidence.operation !== attempt.operation ||
    evidence.deploymentInstanceId !== authority.deploymentInstanceId ||
    evidence.incarnationId !== authority.incarnationId
  ) {
    throw new Error(`${valuePath}.evidence does not match its authority.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      provider: attempt.provider,
      role: attempt.role,
      operation: attempt.operation,
      state: attempt.state,
      providerResourceId,
      evidence,
    }),
  );
}

/**
 * @param {unknown} value - Candidate attempts.
 * @param {Readonly<Record<string, any>>} authority - Immutable authority.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>[]>} - Sorted unique attempts.
 */
function validateMutationAttempts(value, authority, valuePath) {
  const resourceRoles = providerResourceRoles(
    authority.providerIntent.provider,
  );
  if (!Array.isArray(value) || value.length > resourceRoles.size) {
    throw new TypeError(`${valuePath} must be one bounded attempt array.`);
  }
  const attempts = value.map((entry, index) =>
    validateMutationAttempt(entry, authority, `${valuePath}[${index}]`),
  );
  attempts.sort((left, right) => left.role.localeCompare(right.role));
  if (
    attempts.some(
      (entry, index) => index > 0 && attempts[index - 1].role === entry.role,
    )
  ) {
    throw new Error(`${valuePath} must contain one attempt per role.`);
  }
  return deepFreeze(attempts);
}

/**
 * Canonicalize one provider resource observation.
 * @param {unknown} value - Candidate resource evidence.
 * @param {string} provider - Immutable provider discriminator.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical evidence.
 */
function validateResourceEvidence(value, provider, valuePath) {
  const evidence = exactDataObject(value, RESOURCE_KEYS, valuePath);
  if (evidence.provider !== provider) {
    throw new TypeError(`${valuePath}.provider does not match its intent.`);
  }
  if (!providerResourceRoles(provider).has(evidence.role)) {
    throw new TypeError(`${valuePath}.role is not supported for ${provider}.`);
  }
  const canonicalResourceId = canonicalProviderResourceId(
    evidence.providerResourceId,
    provider,
    evidence.role,
    `${valuePath}.providerResourceId`,
  );
  if (evidence.state !== 'present' && evidence.state !== 'absent') {
    throw new TypeError(`${valuePath}.state must be 'present' or 'absent'.`);
  }
  let publicIpv4 = null;
  if (evidence.publicIpv4 !== null) {
    publicIpv4 = canonicalIpv4(evidence.publicIpv4, `${valuePath}.publicIpv4`);
  }
  if (
    ((provider === 'hetzner' && evidence.role === 'firewall') ||
      (provider === 'aws' && evidence.role !== 'instance')) &&
    publicIpv4 !== null
  ) {
    throw new TypeError(
      `${valuePath}.publicIpv4 is unsupported for this provider role.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      provider,
      role: evidence.role,
      providerResourceId: canonicalResourceId,
      publicIpv4,
      state: evidence.state,
    }),
  );
}

/**
 * @param {unknown} value - Candidate resources.
 * @param {string} provider - Immutable provider discriminator.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>[]>} - Sorted unique evidence.
 */
function validateResources(value, provider, valuePath) {
  const resourceRoles = providerResourceRoles(provider);
  if (!Array.isArray(value) || value.length > resourceRoles.size) {
    throw new TypeError(`${valuePath} must be one bounded resource array.`);
  }
  const resources = value.map((entry, index) =>
    validateResourceEvidence(entry, provider, `${valuePath}[${index}]`),
  );
  resources.sort((left, right) => left.role.localeCompare(right.role));
  if (
    resources.some(
      (entry, index) => index > 0 && resources[index - 1].role === entry.role,
    )
  ) {
    throw new Error(`${valuePath} must contain unique resource roles.`);
  }
  return deepFreeze(resources);
}

/** @param {string} provider @param {string} role @returns {number} */
function destructionRoleIndex(provider, role) {
  return providerDestructionRoles(provider).indexOf(role);
}

/**
 * @param {unknown} value - Candidate full destroy attempts.
 * @param {string} provider - Immutable provider discriminator.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>[]>} - Canonical attempts.
 */
function validateDestroyAttempts(value, provider, intent, valuePath) {
  const destructionRoles = providerDestructionRoles(provider);
  if (!Array.isArray(value) || value.length > destructionRoles.length) {
    throw new TypeError(`${valuePath} must be one bounded attempt array.`);
  }
  const attempts = value.map((entry, index) =>
    provider === 'hetzner'
      ? validateHetznerDestructionAttempt(
          entry,
          intent,
          undefined,
          undefined,
          `${valuePath}[${index}]`,
        )
      : validateAwsDestructionAttempt(
          entry,
          intent,
          undefined,
          undefined,
          `${valuePath}[${index}]`,
        ),
  );
  attempts.sort(
    (left, right) =>
      destructionRoleIndex(provider, left.role) -
      destructionRoleIndex(provider, right.role),
  );
  if (
    attempts.some(
      (entry, index) => index > 0 && attempts[index - 1].role === entry.role,
    )
  ) {
    throw new Error(`${valuePath} must contain one attempt per role.`);
  }
  return deepFreeze(attempts);
}

/**
 * @param {unknown} value - Candidate full deletion records.
 * @param {string} provider - Immutable provider discriminator.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {Readonly<Record<string, any>[]>} attempts - Exact prior attempts.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>[]>} - Canonical records.
 */
function validateDeletionRecords(value, provider, intent, attempts, valuePath) {
  const destructionRoles = providerDestructionRoles(provider);
  if (!Array.isArray(value) || value.length > destructionRoles.length) {
    throw new TypeError(`${valuePath} must be one bounded deletion array.`);
  }
  const records = value.map((entry, index) => {
    const entryPath = `${valuePath}[${index}]`;
    const candidate = cloneBoundedJsonObject(entry, 16 * 1024, entryPath);
    const attempt =
      attempts.find((stored) => stored.role === candidate.role) ?? null;
    return provider === 'hetzner'
      ? validateHetznerDeletionRecord(
          candidate,
          intent,
          candidate.role,
          candidate.providerResourceId,
          attempt,
          entryPath,
        )
      : validateAwsDeletionRecord(
          candidate,
          intent,
          candidate.role,
          candidate.providerResourceId,
          attempt,
          entryPath,
        );
  });
  records.sort(
    (left, right) =>
      destructionRoleIndex(provider, left.role) -
      destructionRoleIndex(provider, right.role),
  );
  if (
    records.some(
      (entry, index) => index > 0 && records[index - 1].role === entry.role,
    )
  ) {
    throw new Error(`${valuePath} must contain one deletion per role.`);
  }
  return deepFreeze(records);
}

/**
 * @param {unknown} value - Candidate host evidence.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>> | null} - Canonical host evidence.
 */
function validateSshHost(value, valuePath) {
  if (value === null) return null;
  const host = exactDataObject(value, SSH_HOST_KEYS, valuePath);
  const address = canonicalIpv4(host.address, `${valuePath}.address`);
  if (host.algorithm !== 'ssh-ed25519') {
    throw new TypeError(`${valuePath}.algorithm must be 'ssh-ed25519'.`);
  }
  if (
    typeof host.fingerprint !== 'string' ||
    !SSH_FINGERPRINT_PATTERN.test(host.fingerprint)
  ) {
    throw new TypeError(`${valuePath}.fingerprint is invalid.`);
  }
  const encoded = SSH_FINGERPRINT_PATTERN.exec(host.fingerprint)?.[1];
  if (
    !encoded ||
    Buffer.from(encoded, 'base64').byteLength !== 32 ||
    Buffer.from(encoded, 'base64').toString('base64').replace(/=+$/u, '') !==
      encoded
  ) {
    throw new TypeError(`${valuePath}.fingerprint is not canonical SHA-256.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      address,
      algorithm: 'ssh-ed25519',
      fingerprint: host.fingerprint,
    }),
  );
}

/**
 * @param {unknown} value - Candidate artifact evidence.
 * @param {Readonly<Record<string, any>>} desired - Exact desired state.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>> | null} - Canonical evidence.
 */
function validateArtifactEvidence(value, desired, valuePath) {
  if (value === null) return null;
  const artifact = exactDataObject(value, ARTIFACT_KEYS, valuePath);
  assertArtifactId(artifact.artifactId, `${valuePath}.artifactId`);
  const byteDigest = validateSha256Digest(
    artifact.byteDigest,
    `${valuePath}.byteDigest`,
  );
  const size = positiveSafeInteger(artifact.size, `${valuePath}.size`);
  const remotePath = canonicalRemotePath(
    artifact.remotePath,
    `${valuePath}.remotePath`,
  );
  if (
    artifact.artifactId !== desired.artifact.artifactId ||
    byteDigest.value !== desired.artifact.byteDigest.value ||
    size !== desired.artifact.size
  ) {
    throw new Error(
      `${valuePath} must prove the exact desired artifact bytes.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      artifactId: artifact.artifactId,
      byteDigest,
      size,
      remotePath,
    }),
  );
}

/**
 * @param {unknown} value - Candidate activation evidence.
 * @param {{desired: Readonly<Record<string, any>>, incarnationId: string, providerAddress: string|null, sshHost: Readonly<Record<string, any>>|null}} context - Exact durable authority.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>> | null} - Canonical evidence.
 */
function validateActivationEvidence(value, context, valuePath) {
  if (value === null) return null;
  if (
    context.providerAddress === null ||
    context.sshHost === null ||
    context.sshHost.address !== context.providerAddress
  ) {
    throw new Error(
      `${valuePath} requires pinned provider and SSH host authority.`,
    );
  }
  const candidate = cloneBoundedJsonObject(value, 32 * 1024, valuePath);
  return validateSingleNodeRemoteActivationEvidence(candidate, {
    desired: context.desired,
    incarnationId: context.incarnationId,
    providerAddress: context.providerAddress,
    sshHostKeyFingerprint: context.sshHost.fingerprint,
    sshPublicKeyFingerprint: candidate.bootstrap?.sshPublicKeyFingerprint,
  });
}

/**
 * Derive the compact byte-installation projection only from full validated
 * activation evidence.
 * @param {Readonly<Record<string, any>>} activation - Full activation proof.
 * @param {Readonly<Record<string, any>>} desired - Exact desired state.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Compact artifact evidence.
 */
function artifactFromActivation(activation, desired, valuePath) {
  return /** @type {Readonly<Record<string, any>>} */ (
    validateArtifactEvidence(
      {
        artifactId: activation.artifact.artifactId,
        byteDigest: activation.artifact.byteDigest,
        size: activation.artifact.size,
        remotePath: activation.artifact.remotePath,
      },
      desired,
      valuePath,
    )
  );
}

/**
 * A release update may replace application bytes and its Node runtime without
 * changing the durable deployment substrate those bytes inhabit.
 * @param {Readonly<Record<string, any>>} desired - Candidate release desired state.
 * @param {Readonly<Record<string, any>>} substrateDesired - Provisioned substrate authority.
 * @param {string} valuePath - Boundary label.
 */
function assertCompatibleReleaseDesired(desired, substrateDesired, valuePath) {
  const candidate = desired.intent;
  const substrate = substrateDesired.intent;
  if (
    desired.deploymentInstanceId !== substrateDesired.deploymentInstanceId ||
    candidate.appId !== substrate.appId ||
    JSON.stringify(candidate.deployment) !==
      JSON.stringify(substrate.deployment) ||
    JSON.stringify(candidate.provider) !== JSON.stringify(substrate.provider) ||
    JSON.stringify(candidate.mode) !== JSON.stringify(substrate.mode) ||
    JSON.stringify(candidate.machine) !== JSON.stringify(substrate.machine) ||
    JSON.stringify(candidate.access) !== JSON.stringify(substrate.access) ||
    candidate.target.platform !== substrate.target.platform ||
    candidate.target.architecture !== substrate.target.architecture ||
    candidate.target.libc !== substrate.target.libc
  ) {
    throw new Error(
      `${valuePath} must preserve deployment, app, provider, mode, machine, access, platform, architecture, and libc.`,
    );
  }
}

/**
 * Canonicalize one current, rollback, or transition-target release.
 * @param {unknown} value - Candidate release.
 * @param {{substrateDesired: Readonly<Record<string, any>>, incarnationId: string, providerAddress: string|null, sshHost: Readonly<Record<string, any>>|null, complete: boolean}} context - Release validation context.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical release.
 */
function validateRelease(value, context, valuePath) {
  const release = exactDataObject(value, RELEASE_KEYS, valuePath);
  const desired = validateSingleNodeDeploymentDesired(
    release.desired,
    `${valuePath}.desired`,
  );
  assertCompatibleReleaseDesired(
    desired,
    context.substrateDesired,
    `${valuePath}.desired`,
  );
  const artifact = validateArtifactEvidence(
    release.artifact,
    desired,
    `${valuePath}.artifact`,
  );
  const activation = validateActivationEvidence(
    release.activation,
    {
      desired,
      incarnationId: context.incarnationId,
      providerAddress: context.providerAddress,
      sshHost: context.sshHost,
    },
    `${valuePath}.activation`,
  );
  if (activation !== null && artifact === null) {
    throw new Error(`${valuePath}.activation requires artifact evidence.`);
  }
  if (
    activation !== null &&
    (activation.address !== context.sshHost?.address ||
      activation.sshHostKey.fingerprint !== context.sshHost?.fingerprint ||
      activation.artifact.artifactId !== artifact?.artifactId ||
      activation.artifact.byteDigest.value !== artifact?.byteDigest.value ||
      activation.artifact.size !== artifact?.size ||
      activation.artifact.remotePath !== artifact?.remotePath)
  ) {
    throw new Error(
      `${valuePath}.activation does not match its compact artifact evidence.`,
    );
  }
  if (context.complete && (artifact === null || activation === null)) {
    throw new Error(`${valuePath} must contain settled release evidence.`);
  }
  return deepFreeze(sortCanonicalJsonValue({ desired, artifact, activation }));
}

/**
 * Canonicalize the release state machine while keeping substrate authority
 * flat and immutable.
 * @param {unknown} value - Candidate release state.
 * @param {{substrateDesired: Readonly<Record<string, any>>, incarnationId: string, providerAddress: string|null, sshHost: Readonly<Record<string, any>>|null}} context - Validation context.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical release state.
 */
function validateReleaseState(value, context, valuePath) {
  const state = exactDataObject(value, RELEASE_STATE_KEYS, valuePath);
  const current =
    state.current === null
      ? null
      : validateRelease(
          state.current,
          { ...context, complete: true },
          `${valuePath}.current`,
        );
  const rollback =
    state.rollback === null
      ? null
      : validateRelease(
          state.rollback,
          { ...context, complete: true },
          `${valuePath}.rollback`,
        );
  let transition = null;
  if (state.transition !== null) {
    const candidate = exactDataObject(
      state.transition,
      RELEASE_TRANSITION_KEYS,
      `${valuePath}.transition`,
    );
    if (candidate.kind !== 'install' && candidate.kind !== 'update') {
      throw new TypeError(
        `${valuePath}.transition.kind must be 'install' or 'update'.`,
      );
    }
    const target = validateRelease(
      candidate.target,
      { ...context, complete: false },
      `${valuePath}.transition.target`,
    );
    transition = deepFreeze(
      sortCanonicalJsonValue({ kind: candidate.kind, target }),
    );
  }
  if (current === null && transition?.kind !== 'install') {
    throw new Error(`${valuePath} without a current release requires install.`);
  }
  if (current !== null && transition?.kind === 'install') {
    throw new Error(`${valuePath} cannot install over a current release.`);
  }
  if (transition?.kind === 'update' && current === null) {
    throw new Error(`${valuePath}.update requires a current release.`);
  }
  if (
    transition?.kind === 'update' &&
    transition.target.desired.desiredRevisionId ===
      current?.desired.desiredRevisionId
  ) {
    throw new Error(`${valuePath}.update must target a different release.`);
  }
  if (rollback !== null && current === null) {
    throw new Error(`${valuePath}.rollback requires a current release.`);
  }
  return deepFreeze(sortCanonicalJsonValue({ current, rollback, transition }));
}

/** @param {Readonly<Record<string, any>[]>} resources @param {string} role */
function resourceForRole(resources, role) {
  return resources.find((resource) => resource.role === role) || null;
}

/** @param {Readonly<Record<string, any>[]>} values @param {string} role */
function evidenceForRole(values, role) {
  return values.find((value) => value.role === role) || null;
}

/** @param {Readonly<Record<string, any>[]>} resources @param {string} role */
function resourceIsAbsent(resources, role) {
  const resource = resourceForRole(resources, role);
  return resource === null || resource.state === 'absent';
}

/**
 * Enforce provider dependency order while treating never-created roles as
 * already absent.
 * @param {Readonly<Record<string, any>[]>} resources - Current resources.
 * @param {string} provider - Immutable provider discriminator.
 * @param {string} role - Role about to be deleted.
 * @param {string} valuePath - Boundary label.
 */
function assertDestructionOrder(resources, provider, role, valuePath) {
  if (
    provider === 'hetzner' &&
    role === 'primaryIp' &&
    !resourceIsAbsent(resources, 'server')
  ) {
    throw new Error(`${valuePath} requires the server to be absent first.`);
  }
  if (
    provider === 'hetzner' &&
    role === 'firewall' &&
    (!resourceIsAbsent(resources, 'server') ||
      !resourceIsAbsent(resources, 'primaryIp'))
  ) {
    throw new Error(
      `${valuePath} requires the server and primary IP to be absent first.`,
    );
  }
  if (
    provider === 'aws' &&
    role === 'rootVolume' &&
    !resourceIsAbsent(resources, 'instance')
  ) {
    throw new Error(`${valuePath} requires the instance to be absent first.`);
  }
  if (
    provider === 'aws' &&
    role === 'securityGroup' &&
    (!resourceIsAbsent(resources, 'instance') ||
      !resourceIsAbsent(resources, 'rootVolume'))
  ) {
    throw new Error(
      `${valuePath} requires the instance and root volume to be absent first.`,
    );
  }
}

/**
 * Reject semantically partial snapshots that cannot represent one recoverable
 * deployment frontier.
 * @param {Readonly<Record<string, any>>} payload - Canonical payload.
 * @param {string} valuePath - Boundary label.
 */
function assertCoherentPayload(payload, valuePath) {
  const provider = payload.providerIntent.provider;
  const resourceRoles = providerResourceRoles(provider);
  const addressResource = resourceForRole(
    payload.resources,
    providerAddressRole(provider),
  );
  if (
    provider === 'aws' &&
    (evidenceForRole(payload.mutationAttempts, 'instance') === null) !==
      (evidenceForRole(payload.mutationAttempts, 'rootVolume') === null)
  ) {
    throw new Error(
      `${valuePath}.mutationAttempts must fence the AWS instance and root volume atomically.`,
    );
  }
  for (const resource of payload.resources) {
    const attempt =
      payload.mutationAttempts.find(
        (/** @type {Record<string, any>} */ candidate) =>
          candidate.role === resource.role,
      ) || null;
    if (
      attempt?.state !== 'succeeded' ||
      attempt.providerResourceId !== resource.providerResourceId
    ) {
      throw new Error(
        `${valuePath}.resources must follow a succeeded mutation attempt.`,
      );
    }
  }
  if (
    payload.phase !== 'destroying' &&
    payload.phase !== 'destroyed' &&
    (payload.destroyAttempts.length !== 0 ||
      payload.deletionRecords.length !== 0)
  ) {
    throw new Error(
      `${valuePath} destruction evidence is only valid while destroying.`,
    );
  }
  for (const attempt of payload.destroyAttempts) {
    const resource = resourceForRole(payload.resources, attempt.role);
    if (
      resource === null ||
      resource.providerResourceId !== attempt.providerResourceId
    ) {
      throw new Error(
        `${valuePath}.destroyAttempts must match an exact known resource.`,
      );
    }
    assertDestructionOrder(
      payload.resources,
      provider,
      attempt.role,
      `${valuePath}.destroyAttempts.${attempt.role}`,
    );
  }
  for (const deletion of payload.deletionRecords) {
    const resource = resourceForRole(payload.resources, deletion.role);
    const attempt = evidenceForRole(payload.destroyAttempts, deletion.role);
    if (
      resource === null ||
      resource.providerResourceId !== deletion.providerResourceId ||
      resource.state !== 'absent' ||
      deletion.destroyAttemptId !== (attempt?.attemptId ?? null)
    ) {
      throw new Error(
        `${valuePath}.deletionRecords must prove an exact known resource absent.`,
      );
    }
    assertDestructionOrder(
      payload.resources,
      provider,
      deletion.role,
      `${valuePath}.deletionRecords.${deletion.role}`,
    );
  }
  for (const resource of payload.resources) {
    if (
      resource.state === 'absent' &&
      evidenceForRole(payload.deletionRecords, resource.role) === null
    ) {
      throw new Error(
        `${valuePath}.resources cannot become absent without a deletion record.`,
      );
    }
  }
  const observedAddresses = new Set(
    payload.resources
      .map((/** @type {Record<string, any>} */ resource) => resource.publicIpv4)
      .filter((/** @type {unknown} */ address) => address !== null),
  );
  if (provider === 'hetzner' && observedAddresses.size > 1) {
    throw new Error(`${valuePath}.resources contain conflicting addresses.`);
  }
  if (payload.sshHost !== null) {
    if (addressResource?.publicIpv4 !== payload.sshHost.address) {
      throw new Error(
        `${valuePath}.sshHost must match its provider-observed address resource.`,
      );
    }
  }
  const releases = [
    payload.release.current,
    payload.release.rollback,
    payload.release.transition?.target ?? null,
  ].filter((release) => release !== null);
  const hasReleaseEvidence = releases.some(
    (release) => release.artifact !== null || release.activation !== null,
  );
  if (hasReleaseEvidence && payload.sshHost === null) {
    throw new Error(`${valuePath}.release evidence requires pinned SSH host.`);
  }
  if (
    payload.phase === 'planned' &&
    (payload.resources.length !== 0 ||
      payload.mutationAttempts.length !== 0 ||
      payload.destroyAttempts.length !== 0 ||
      payload.deletionRecords.length !== 0 ||
      payload.sshHost !== null ||
      payload.release.current !== null ||
      payload.release.rollback !== null ||
      payload.release.transition?.kind !== 'install' ||
      hasReleaseEvidence)
  ) {
    throw new Error(`${valuePath}.planned state cannot contain effects.`);
  }
  if (
    payload.phase === 'provisioning' &&
    (payload.sshHost !== null ||
      payload.release.current !== null ||
      payload.release.rollback !== null ||
      payload.release.transition?.kind !== 'install' ||
      hasReleaseEvidence)
  ) {
    throw new Error(
      `${valuePath}.provisioning state cannot contain activation evidence.`,
    );
  }
  if (['provisioned', 'activating', 'active'].includes(payload.phase)) {
    for (const role of resourceRoles) {
      if (resourceForRole(payload.resources, role)?.state !== 'present') {
        throw new Error(
          `${valuePath}.${payload.phase} state requires every provider resource.`,
        );
      }
    }
    if (addressResource?.publicIpv4 == null) {
      throw new Error(
        `${valuePath}.${payload.phase} state requires a public address.`,
      );
    }
  }
  if (payload.phase === 'active' && payload.release.current === null) {
    throw new Error(`${valuePath}.active state requires a current release.`);
  }
  if (
    payload.phase === 'destroyed' &&
    (payload.resources.some(
      (/** @type {Record<string, any>} */ resource) =>
        resource.state !== 'absent',
    ) ||
      payload.mutationAttempts.some(
        (/** @type {Record<string, any>} */ attempt) =>
          attempt.state === 'prepared',
      ))
  ) {
    throw new Error(
      `${valuePath}.destroyed state requires every mutation to be resolved and every known resource to be absent.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate payload.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical payload.
 */
function canonicalizePayload(value, valuePath) {
  const payload = cloneBoundedJsonObject(
    value,
    SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
    valuePath,
  );
  exactDataObject(payload, PAYLOAD_KEYS, valuePath);
  if (
    payload.schemaVersion !== SINGLE_NODE_DEPLOYMENT_JOURNAL_SCHEMA_VERSION ||
    payload.kind !== SINGLE_NODE_DEPLOYMENT_JOURNAL_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported schema or kind.`);
  }
  const generation = nonnegativeSafeInteger(
    payload.generation,
    `${valuePath}.generation`,
  );
  if (generation === 0) {
    if (payload.previousJournalId !== null) {
      throw new TypeError(
        `${valuePath}.previousJournalId must be null at generation zero.`,
      );
    }
  } else {
    assertDomainSeparatedSha256Id(
      payload.previousJournalId,
      SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
      `${valuePath}.previousJournalId`,
    );
  }
  assertSingleNodeDeploymentInstanceId(
    payload.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  const providerIntent = validateProviderIntent(
    payload.providerIntent,
    `${valuePath}.providerIntent`,
  );
  const substrateDesired = providerIntent.intent.plan.desired;
  assertSingleNodeDeploymentIncarnationId(
    payload.incarnationId,
    `${valuePath}.incarnationId`,
  );
  if (
    providerIntent.intent.incarnationId !== payload.incarnationId ||
    providerIntent.intent.plan.deploymentInstanceId !==
      payload.deploymentInstanceId ||
    substrateDesired.deploymentInstanceId !== payload.deploymentInstanceId ||
    substrateDesired.intent.provider.kind !== providerIntent.provider
  ) {
    throw new Error(
      `${valuePath}.providerIntent does not bind the exact deployment.`,
    );
  }
  const mutationAttempts = validateMutationAttempts(
    payload.mutationAttempts,
    {
      deploymentInstanceId: payload.deploymentInstanceId,
      incarnationId: payload.incarnationId,
      providerIntent,
    },
    `${valuePath}.mutationAttempts`,
  );
  if (!PHASES.has(payload.phase)) {
    throw new TypeError(`${valuePath}.phase is unsupported.`);
  }
  const resources = validateResources(
    payload.resources,
    providerIntent.provider,
    `${valuePath}.resources`,
  );
  const destroyAttempts = validateDestroyAttempts(
    payload.destroyAttempts,
    providerIntent.provider,
    providerIntent.intent,
    `${valuePath}.destroyAttempts`,
  );
  const deletionRecords = validateDeletionRecords(
    payload.deletionRecords,
    providerIntent.provider,
    providerIntent.intent,
    destroyAttempts,
    `${valuePath}.deletionRecords`,
  );
  const sshHost = validateSshHost(payload.sshHost, `${valuePath}.sshHost`);
  const providerAddress =
    resourceForRole(resources, providerAddressRole(providerIntent.provider))
      ?.publicIpv4 ?? null;
  const release = validateReleaseState(
    payload.release,
    {
      substrateDesired,
      incarnationId: payload.incarnationId,
      providerAddress,
      sshHost,
    },
    `${valuePath}.release`,
  );
  const result = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: SINGLE_NODE_DEPLOYMENT_JOURNAL_SCHEMA_VERSION,
      kind: SINGLE_NODE_DEPLOYMENT_JOURNAL_KIND,
      generation,
      previousJournalId: payload.previousJournalId,
      deploymentInstanceId: payload.deploymentInstanceId,
      incarnationId: payload.incarnationId,
      providerIntent,
      phase: payload.phase,
      mutationAttempts,
      resources,
      destroyAttempts,
      deletionRecords,
      sshHost,
      release,
    }),
  );
  assertCoherentPayload(result, valuePath);
  assertManifestIsSecretFree(result, valuePath);
  return result;
}

/**
 * Seal one canonical payload with its content ID.
 * @param {unknown} value - Complete payload.
 * @param {string} valuePath - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Journal document.
 */
function sealPayload(value, valuePath) {
  const payload = canonicalizePayload(value, valuePath);
  const journalId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
    value: payload,
    valuePath,
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, journalId }));
}

/**
 * Create generation zero before the first provider mutation.
 * @param {unknown} value - Exact desired and provider provisioning intents.
 * @returns {Readonly<Record<string, any>>} - Initial journal.
 */
export function createSingleNodeDeploymentJournal(value) {
  const input = exactDataObject(
    value,
    INITIALIZE_KEYS,
    'singleNodeDeploymentJournal',
  );
  const desired = validateSingleNodeDeploymentDesired(
    input.desired,
    'singleNodeDeploymentJournal.desired',
  );
  const providerIntent = validateProviderIntent(
    input.providerIntent,
    'singleNodeDeploymentJournal.providerIntent',
  );
  if (
    JSON.stringify(providerIntent.intent.plan.desired) !==
    JSON.stringify(desired)
  ) {
    throw new Error(
      'singleNodeDeploymentJournal providerIntent does not bind the initial desired state.',
    );
  }
  return sealPayload(
    {
      schemaVersion: SINGLE_NODE_DEPLOYMENT_JOURNAL_SCHEMA_VERSION,
      kind: SINGLE_NODE_DEPLOYMENT_JOURNAL_KIND,
      generation: 0,
      previousJournalId: null,
      deploymentInstanceId: desired.deploymentInstanceId,
      incarnationId: providerIntent.intent.incarnationId,
      providerIntent,
      phase: 'planned',
      mutationAttempts: [],
      resources: [],
      destroyAttempts: [],
      deletionRecords: [],
      sshHost: null,
      release: {
        current: null,
        rollback: null,
        transition: {
          kind: 'install',
          target: { desired, artifact: null, activation: null },
        },
      },
    },
    'singleNodeDeploymentJournal',
  );
}

/**
 * Validate and reidentify one serialized journal.
 * @param {unknown} value - Candidate journal.
 * @param {string} [valuePath] - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical journal.
 */
export function validateSingleNodeDeploymentJournal(
  value,
  valuePath = 'singleNodeDeploymentJournal',
) {
  const document = cloneBoundedJsonObject(
    value,
    SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
    valuePath,
  );
  exactDataObject(document, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.journalId,
    SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
    `${valuePath}.journalId`,
  );
  /** @type {Record<string, any>} */
  const payload = {};
  for (const key of PAYLOAD_KEYS) payload[key] = document[key];
  const sealed = sealPayload(payload, valuePath);
  if (sealed.journalId !== document.journalId) {
    throw new Error(`${valuePath}.journalId does not match its exact payload.`);
  }
  return sealed;
}

/**
 * Create the common immutable successor envelope.
 * @param {Readonly<Record<string, any>>} prior - Current record.
 * @param {Readonly<Record<string, any>>} changes - Changed snapshot fields.
 * @returns {Readonly<Record<string, any>>} - Sealed successor.
 */
function successor(prior, changes) {
  const current = validateSingleNodeDeploymentJournal(prior);
  return sealPayload(
    {
      schemaVersion: current.schemaVersion,
      kind: current.kind,
      generation: current.generation + 1,
      previousJournalId: current.journalId,
      deploymentInstanceId: current.deploymentInstanceId,
      incarnationId: current.incarnationId,
      providerIntent: current.providerIntent,
      phase: current.phase,
      mutationAttempts: current.mutationAttempts,
      resources: current.resources,
      destroyAttempts: current.destroyAttempts,
      deletionRecords: current.deletionRecords,
      sshHost: current.sshHost,
      release: current.release,
      ...changes,
    },
    'singleNodeDeploymentJournal.successor',
  );
}

/** @param {unknown} journal @returns {Readonly<Record<string, any>>} */
export function getSingleNodeDeploymentReleaseState(journal) {
  return validateSingleNodeDeploymentJournal(journal).release;
}

/** @param {unknown} journal @returns {Readonly<Record<string, any>> | null} */
export function getSingleNodeDeploymentCurrentRelease(journal) {
  return getSingleNodeDeploymentReleaseState(journal).current;
}

/** @param {unknown} journal @returns {Readonly<Record<string, any>> | null} */
export function getSingleNodeDeploymentReleaseTransition(journal) {
  return getSingleNodeDeploymentReleaseState(journal).transition;
}

/** @param {unknown} journal @returns {Readonly<Record<string, any>>} */
export function getSingleNodeDeploymentEffectiveTargetRelease(journal) {
  const release = getSingleNodeDeploymentReleaseState(journal);
  const target = release.transition?.target ?? release.current;
  if (target === null) {
    throw new Error('singleNodeDeploymentJournal has no effective release.');
  }
  return target;
}

/** @param {unknown} journal @returns {Readonly<Record<string, any>>} */
export function getSingleNodeDeploymentEffectiveDesired(journal) {
  return getSingleNodeDeploymentEffectiveTargetRelease(journal).desired;
}

/**
 * Advance one legal lifecycle edge.
 * @param {unknown} prior - Current record.
 * @param {unknown} phase - Next phase.
 * @returns {Readonly<Record<string, any>>} - Successor record.
 */
export function advanceSingleNodeDeploymentJournal(prior, phase) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (typeof phase !== 'string' || !NEXT_PHASES[current.phase].has(phase)) {
    throw new Error(
      `singleNodeDeploymentJournal cannot advance from ${current.phase}.`,
    );
  }
  return successor(current, { phase });
}

/**
 * Return the durable create fence for a role, if one has been prepared.
 * Callers must reconcile inventory before acting on a prepared-but-unresolved
 * attempt. A provider boundary may replay only the same deterministic request
 * when its name or idempotency token makes that replay collision-safe; the
 * fence never authorizes a different create.
 * @param {unknown} journal - Current journal.
 * @param {unknown} role - Provider resource role.
 * @returns {Readonly<Record<string, any>> | null} - Attempt evidence.
 */
export function getSingleNodeDeploymentMutationAttempt(journal, role) {
  const current = validateSingleNodeDeploymentJournal(journal);
  if (
    typeof role !== 'string' ||
    !providerResourceRoles(current.providerIntent.provider).has(role)
  ) {
    throw new TypeError(
      'singleNodeDeploymentJournal mutation role is unsupported.',
    );
  }
  return (
    current.mutationAttempts.find(
      (/** @type {Record<string, any>} */ attempt) => attempt.role === role,
    ) || null
  );
}

/**
 * Project the exact recovery inputs consumed by the current Hetzner
 * convergence boundary. Full provider attempt evidence is returned verbatim;
 * the journal wrapper's outcome state remains local durable metadata.
 * @param {unknown} journal - Current journal.
 * @returns {Readonly<{storedResourceIds: Readonly<Record<string, number|null>>, storedMutationAttempts: Readonly<Record<string, Readonly<Record<string, any>>|null>>}>} - Provider recovery inputs.
 */
export function getSingleNodeDeploymentProvisioningRecoveryState(journal) {
  const current = validateSingleNodeDeploymentJournal(journal);
  /** @type {Record<string, number|string|null>} */
  const storedResourceIds = {};
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const storedMutationAttempts = {};
  for (const role of providerResourceRoles(current.providerIntent.provider)) {
    const resource = resourceForRole(current.resources, role);
    const attempt =
      current.mutationAttempts.find(
        (/** @type {Record<string, any>} */ entry) => entry.role === role,
      ) || null;
    storedResourceIds[role] = resource?.providerResourceId ?? null;
    storedMutationAttempts[role] = attempt?.evidence ?? null;
  }
  return deepFreeze({ storedResourceIds, storedMutationAttempts });
}

/**
 * Project the exact recovery inputs consumed by Hetzner destruction. Missing
 * never-created roles remain null; known IDs remain durable after deletion.
 * @param {unknown} journal - Current journal.
 * @returns {Readonly<{storedResourceIds: Readonly<Record<string, number|null>>, storedDestroyAttempts: Readonly<Record<string, Readonly<Record<string, any>>|null>>, storedDeletionRecords: Readonly<Record<string, Readonly<Record<string, any>>|null>>}>} - Provider recovery inputs.
 */
export function getSingleNodeDeploymentDestructionRecoveryState(journal) {
  const current = validateSingleNodeDeploymentJournal(journal);
  /** @type {Record<string, number|string|null>} */
  const storedResourceIds = {};
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const storedDestroyAttempts = {};
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const storedDeletionRecords = {};
  for (const role of providerDestructionRoles(
    current.providerIntent.provider,
  )) {
    storedResourceIds[role] =
      resourceForRole(current.resources, role)?.providerResourceId ?? null;
    storedDestroyAttempts[role] = evidenceForRole(
      current.destroyAttempts,
      role,
    );
    storedDeletionRecords[role] = evidenceForRole(
      current.deletionRecords,
      role,
    );
  }
  return deepFreeze({
    storedResourceIds,
    storedDestroyAttempts,
    storedDeletionRecords,
  });
}

/**
 * Atomically persist one bounded set of per-role fences before a provider
 * mutation. This lets one provider request that creates multiple resources
 * (notably AWS RunInstances) acquire every recovery fence in one CAS record.
 * Exact batch retries return the existing journal without a new generation.
 * @param {unknown} prior - Current journal.
 * @param {unknown} values - Exact provider-emitted mutation attempts.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function prepareSingleNodeDeploymentMutations(prior, values) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (current.phase !== 'provisioning') {
    throw new Error(
      'singleNodeDeploymentJournal cannot prepare mutations in this phase.',
    );
  }
  const roles = providerResourceRoles(current.providerIntent.provider);
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > roles.size
  ) {
    throw new TypeError(
      'singleNodeDeploymentJournal mutation batch must be nonempty and bounded.',
    );
  }
  const evidenceValues = values.map((value, index) =>
    current.providerIntent.provider === 'hetzner'
      ? validateHetznerProvisioningMutationAttempt(
          value,
          current.providerIntent.intent,
          undefined,
          `singleNodeDeploymentJournal.prepareMutations[${index}]`,
        )
      : validateAwsProvisioningMutationAttempt(
          value,
          current.providerIntent.intent,
          undefined,
          `singleNodeDeploymentJournal.prepareMutations[${index}]`,
        ),
  );
  evidenceValues.sort((left, right) => left.role.localeCompare(right.role));
  if (
    evidenceValues.some(
      (evidence, index) =>
        index > 0 && evidenceValues[index - 1].role === evidence.role,
    )
  ) {
    throw new Error(
      'singleNodeDeploymentJournal mutation batch must contain unique roles.',
    );
  }
  const additions = [];
  for (const evidence of evidenceValues) {
    const existing =
      current.mutationAttempts.find(
        (/** @type {Record<string, any>} */ attempt) =>
          attempt.role === evidence.role,
      ) || null;
    if (existing !== null) {
      if (JSON.stringify(existing.evidence) === JSON.stringify(evidence)) {
        continue;
      }
      throw new Error(
        'singleNodeDeploymentJournal mutation attempt conflicts with its durable fence.',
      );
    }
    additions.push(
      validateMutationAttempt(
        {
          provider: current.providerIntent.provider,
          role: evidence.role,
          operation: evidence.operation,
          state: 'prepared',
          providerResourceId: null,
          evidence,
        },
        current,
        'singleNodeDeploymentJournal.mutationAttempt',
      ),
    );
  }
  if (additions.length === 0) return current;
  return successor(current, {
    mutationAttempts: [...current.mutationAttempts, ...additions],
  });
}

/**
 * Persist one per-role fence before a provider mutation.
 * @param {unknown} prior - Current journal.
 * @param {unknown} value - Exact provider-emitted mutation attempt.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function prepareSingleNodeDeploymentMutation(prior, value) {
  return prepareSingleNodeDeploymentMutations(prior, [value]);
}

/**
 * Resolve one prepared mutation as a provider-confirmed rejection. Removing
 * the current fence is safe only when the provider returned a definite
 * non-commit response; ambiguous outcomes must remain prepared for inventory
 * recovery. The prior generation retains the rejected attempt in the durable
 * journal chain while the successor permits an intentional retry or cleanup.
 * @param {unknown} prior - Current journal.
 * @param {unknown} value - Exact provider-emitted mutation attempt.
 * @returns {Readonly<Record<string, any>>} - Successor without the rejected fence.
 */
export function rejectSingleNodeDeploymentMutation(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (current.phase !== 'provisioning') {
    throw new Error(
      'singleNodeDeploymentJournal cannot reject mutations in this phase.',
    );
  }
  const evidence =
    current.providerIntent.provider === 'hetzner'
      ? validateHetznerProvisioningMutationAttempt(
          value,
          current.providerIntent.intent,
          undefined,
          'singleNodeDeploymentJournal.rejectMutation',
        )
      : validateAwsProvisioningMutationAttempt(
          value,
          current.providerIntent.intent,
          undefined,
          'singleNodeDeploymentJournal.rejectMutation',
        );
  const attempt =
    current.mutationAttempts.find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.role === evidence.role,
    ) || null;
  if (
    attempt === null ||
    attempt.state !== 'prepared' ||
    JSON.stringify(attempt.evidence) !== JSON.stringify(evidence)
  ) {
    throw new Error(
      'singleNodeDeploymentJournal rejected mutation does not match its durable fence.',
    );
  }
  if (resourceForRole(current.resources, evidence.role) !== null) {
    throw new Error(
      'singleNodeDeploymentJournal cannot reject a mutation with resource evidence.',
    );
  }
  return successor(current, {
    mutationAttempts: current.mutationAttempts.filter(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.role !== evidence.role,
    ),
  });
}

/**
 * Resolve one prepared mutation to an exact provider identity and atomically
 * add its resource evidence. This is valid for a direct response or for an
 * ownership-qualified inventory recovery after an ambiguous response.
 * @param {unknown} prior - Current journal.
 * @param {unknown} value - Exact provider-emitted resource record.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function completeSingleNodeDeploymentMutation(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (!['provisioning', 'destroying'].includes(current.phase)) {
    throw new Error(
      'singleNodeDeploymentJournal cannot complete mutations in this phase.',
    );
  }
  const providerRecord =
    current.providerIntent.provider === 'hetzner'
      ? validateHetznerProvisionedResourceRecord(
          value,
          current.providerIntent.intent,
          undefined,
          'singleNodeDeploymentJournal.completeMutation',
        )
      : validateAwsProvisionedResourceRecord(
          value,
          current.providerIntent.intent,
          undefined,
          'singleNodeDeploymentJournal.completeMutation',
        );
  const attempt =
    current.mutationAttempts.find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.role === providerRecord.role,
    ) || null;
  if (attempt === null) {
    throw new Error(
      'singleNodeDeploymentJournal mutation was not durably prepared.',
    );
  }
  const providerResourceId = providerRecord.providerResourceId;
  const completed = validateMutationAttempt(
    {
      ...attempt,
      state: 'succeeded',
      providerResourceId,
    },
    current,
    'singleNodeDeploymentJournal.mutationAttempt',
  );
  const resource = validateResourceEvidence(
    {
      provider: attempt.provider,
      role: attempt.role,
      providerResourceId,
      publicIpv4: null,
      state: 'present',
    },
    current.providerIntent.provider,
    'singleNodeDeploymentJournal.resource',
  );
  const existingResource = resourceForRole(current.resources, attempt.role);
  if (attempt.state === 'succeeded') {
    if (
      attempt.providerResourceId === providerResourceId &&
      existingResource?.providerResourceId === providerResourceId
    ) {
      return current;
    }
    throw new Error(
      'singleNodeDeploymentJournal mutation outcome is immutable.',
    );
  }
  if (existingResource !== null) {
    throw new Error(
      'singleNodeDeploymentJournal mutation outcome conflicts with resource evidence.',
    );
  }
  return successor(current, {
    mutationAttempts: current.mutationAttempts.map(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.role === attempt.role ? completed : candidate,
    ),
    resources: [...current.resources, resource],
  });
}

/**
 * Persist the exact-ID fence that must durably precede a provider DELETE.
 * Exact retries return the current journal without consuming a generation.
 * @param {unknown} prior - Current journal.
 * @param {unknown} value - Full provider-emitted destruction attempt.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function prepareSingleNodeDeploymentDestruction(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (current.phase !== 'destroying') {
    throw new Error(
      'singleNodeDeploymentJournal cannot prepare destruction in this phase.',
    );
  }
  const attempt =
    current.providerIntent.provider === 'hetzner'
      ? validateHetznerDestructionAttempt(
          value,
          current.providerIntent.intent,
          undefined,
          undefined,
          'singleNodeDeploymentJournal.prepareDestruction',
        )
      : validateAwsDestructionAttempt(
          value,
          current.providerIntent.intent,
          undefined,
          undefined,
          'singleNodeDeploymentJournal.prepareDestruction',
        );
  const existing = evidenceForRole(current.destroyAttempts, attempt.role);
  if (existing !== null) {
    if (JSON.stringify(existing) === JSON.stringify(attempt)) return current;
    throw new Error(
      'singleNodeDeploymentJournal destruction attempt conflicts with its durable fence.',
    );
  }
  if (evidenceForRole(current.deletionRecords, attempt.role) !== null) {
    throw new Error(
      'singleNodeDeploymentJournal destruction outcome is immutable.',
    );
  }
  const resource = resourceForRole(current.resources, attempt.role);
  if (
    resource === null ||
    resource.providerResourceId !== attempt.providerResourceId
  ) {
    throw new Error(
      'singleNodeDeploymentJournal destruction attempt must match an exact known resource.',
    );
  }
  if (resource.state !== 'present') {
    throw new Error(
      'singleNodeDeploymentJournal cannot prepare destruction for an absent resource.',
    );
  }
  assertDestructionOrder(
    current.resources,
    current.providerIntent.provider,
    attempt.role,
    'singleNodeDeploymentJournal.prepareDestruction',
  );
  return successor(current, {
    destroyAttempts: [...current.destroyAttempts, attempt],
  });
}

/**
 * Atomically retain exact absence proof and mark its known provider identity
 * absent. Null destroyAttemptId records recover an already-absent resource.
 * @param {unknown} prior - Current journal.
 * @param {unknown} value - Full provider-emitted deletion record.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function recordSingleNodeDeploymentDeletion(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (current.phase !== 'destroying') {
    throw new Error(
      'singleNodeDeploymentJournal cannot record deletion in this phase.',
    );
  }
  const candidate = cloneBoundedJsonObject(
    value,
    16 * 1024,
    'singleNodeDeploymentJournal.recordDeletion',
  );
  const attempt = evidenceForRole(current.destroyAttempts, candidate.role);
  const deletion =
    current.providerIntent.provider === 'hetzner'
      ? validateHetznerDeletionRecord(
          candidate,
          current.providerIntent.intent,
          candidate.role,
          candidate.providerResourceId,
          attempt,
          'singleNodeDeploymentJournal.recordDeletion',
        )
      : validateAwsDeletionRecord(
          candidate,
          current.providerIntent.intent,
          candidate.role,
          candidate.providerResourceId,
          attempt,
          'singleNodeDeploymentJournal.recordDeletion',
        );
  const existing = evidenceForRole(current.deletionRecords, deletion.role);
  if (existing !== null) {
    if (JSON.stringify(existing) === JSON.stringify(deletion)) return current;
    throw new Error(
      'singleNodeDeploymentJournal deletion record conflicts with its durable proof.',
    );
  }
  const resource = resourceForRole(current.resources, deletion.role);
  if (
    resource === null ||
    resource.providerResourceId !== deletion.providerResourceId
  ) {
    throw new Error(
      'singleNodeDeploymentJournal deletion must match an exact known resource.',
    );
  }
  if (resource.state !== 'present') {
    throw new Error(
      'singleNodeDeploymentJournal deletion outcome is immutable.',
    );
  }
  assertDestructionOrder(
    current.resources,
    current.providerIntent.provider,
    deletion.role,
    'singleNodeDeploymentJournal.recordDeletion',
  );
  return successor(current, {
    deletionRecords: [...current.deletionRecords, deletion],
    resources: current.resources.map(
      (/** @type {Record<string, any>} */ entry) =>
        entry.role === deletion.role
          ? deepFreeze({ ...entry, state: 'absent' })
          : entry,
    ),
  });
}

/**
 * Enrich one immutable present provider resource identity.
 * Exact retries return the current record without consuming a generation.
 * @param {unknown} prior - Current record.
 * @param {unknown} value - Provider resource evidence.
 * @returns {Readonly<Record<string, any>>} - Current or successor record.
 */
export function recordSingleNodeDeploymentResource(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (!['provisioning', 'destroying'].includes(current.phase)) {
    throw new Error(
      'singleNodeDeploymentJournal cannot record resources in this phase.',
    );
  }
  const evidence = validateResourceEvidence(
    value,
    current.providerIntent.provider,
    'singleNodeDeploymentJournal.resource',
  );
  if (evidence.state === 'absent') {
    throw new Error(
      'singleNodeDeploymentJournal resources become absent only with a deletion record.',
    );
  }
  if (evidence.provider !== current.providerIntent.provider) {
    throw new Error(
      'singleNodeDeploymentJournal resource provider does not match its intent.',
    );
  }
  const existing = resourceForRole(current.resources, evidence.role);
  if (existing === null) {
    throw new Error(
      'singleNodeDeploymentJournal must complete a prepared mutation before recording resource evidence.',
    );
  }
  if (
    existing.provider !== evidence.provider ||
    existing.providerResourceId !== evidence.providerResourceId ||
    (existing.publicIpv4 !== null &&
      evidence.publicIpv4 !== existing.publicIpv4) ||
    (existing.publicIpv4 !== null && evidence.publicIpv4 === null) ||
    existing.state === 'absent'
  ) {
    if (JSON.stringify(existing) === JSON.stringify(evidence)) return current;
    throw new Error(
      'singleNodeDeploymentJournal resource evidence is not monotonic.',
    );
  }
  if (JSON.stringify(existing) === JSON.stringify(evidence)) return current;
  return successor(current, {
    resources: current.resources.map(
      (/** @type {Record<string, any>} */ resource) =>
        resource.role === evidence.role ? evidence : resource,
    ),
  });
}

/**
 * Pin first-use SSH host identity to a provider-observed address.
 * @param {unknown} prior - Current record.
 * @param {unknown} value - Exact host evidence.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function recordSingleNodeDeploymentSshHost(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  if (!['provisioned', 'activating'].includes(current.phase)) {
    throw new Error(
      'singleNodeDeploymentJournal cannot record SSH host evidence in this phase.',
    );
  }
  const sshHost = validateSshHost(value, 'singleNodeDeploymentJournal.sshHost');
  if (sshHost === null) {
    throw new TypeError('singleNodeDeploymentJournal.sshHost cannot be null.');
  }
  if (current.sshHost !== null) {
    if (JSON.stringify(current.sshHost) === JSON.stringify(sshHost)) {
      return current;
    }
    throw new Error(
      'singleNodeDeploymentJournal SSH host identity is immutable.',
    );
  }
  return successor(current, { sshHost });
}

/**
 * Record exact remote byte verification and installation.
 * @param {unknown} prior - Current record.
 * @param {unknown} value - Artifact evidence.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function recordSingleNodeDeploymentArtifact(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  const transition = current.release.transition;
  if (
    transition === null ||
    (transition.kind === 'install' && current.phase !== 'activating') ||
    (transition.kind === 'update' && current.phase !== 'active')
  ) {
    throw new Error(
      'singleNodeDeploymentJournal cannot record artifact evidence in this phase.',
    );
  }
  const artifact = validateArtifactEvidence(
    value,
    transition.target.desired,
    'singleNodeDeploymentJournal.release.transition.target.artifact',
  );
  if (artifact === null) {
    throw new TypeError(
      'singleNodeDeploymentJournal transition artifact cannot be null.',
    );
  }
  if (transition.target.artifact !== null) {
    if (
      JSON.stringify(transition.target.artifact) === JSON.stringify(artifact)
    ) {
      return current;
    }
    throw new Error(
      'singleNodeDeploymentJournal transition artifact evidence is immutable.',
    );
  }
  return successor(current, {
    release: {
      ...current.release,
      transition: {
        ...transition,
        target: { ...transition.target, artifact },
      },
    },
  });
}

/**
 * Record exact durable-service activation evidence.
 * @param {unknown} prior - Current record.
 * @param {unknown} value - Activation evidence.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function recordSingleNodeDeploymentTransitionActivation(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  const transition = current.release.transition;
  if (
    transition === null ||
    (transition.kind === 'install' && current.phase !== 'activating') ||
    (transition.kind === 'update' && current.phase !== 'active')
  ) {
    throw new Error(
      'singleNodeDeploymentJournal cannot record activation evidence in this phase.',
    );
  }
  const activation = validateActivationEvidence(
    value,
    {
      desired: transition.target.desired,
      incarnationId: current.incarnationId,
      providerAddress:
        resourceForRole(
          current.resources,
          providerAddressRole(current.providerIntent.provider),
        )?.publicIpv4 ?? null,
      sshHost: current.sshHost,
    },
    'singleNodeDeploymentJournal.release.transition.target.activation',
  );
  if (activation === null) {
    throw new TypeError(
      'singleNodeDeploymentJournal.activation cannot be null.',
    );
  }
  if (transition.target.activation !== null) {
    if (
      JSON.stringify(transition.target.activation) ===
      JSON.stringify(activation)
    ) {
      return current;
    }
    throw new Error(
      'singleNodeDeploymentJournal activation evidence is immutable.',
    );
  }
  const artifact = artifactFromActivation(
    activation,
    transition.target.desired,
    'singleNodeDeploymentJournal.release.transition.target.artifact',
  );
  if (
    transition.target.artifact !== null &&
    JSON.stringify(transition.target.artifact) !== JSON.stringify(artifact)
  ) {
    throw new Error(
      'singleNodeDeploymentJournal activation artifact conflicts with durable evidence.',
    );
  }
  return successor(current, {
    release: {
      ...current.release,
      transition: {
        ...transition,
        target: { ...transition.target, activation, artifact },
      },
    },
  });
}

/**
 * Backward-compatible operation name for transition activation.
 * @param {unknown} prior - Current record.
 * @param {unknown} value - Activation evidence.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function recordSingleNodeDeploymentActivation(prior, value) {
  return recordSingleNodeDeploymentTransitionActivation(prior, value);
}

/**
 * Prepare an idempotent in-place release update while retaining current
 * authority until the new release is fully proven and settled.
 * @param {unknown} prior - Current record.
 * @param {unknown} value - New desired release.
 * @returns {Readonly<Record<string, any>>} - Current or successor.
 */
export function prepareSingleNodeDeploymentReleaseUpdate(prior, value) {
  const current = validateSingleNodeDeploymentJournal(prior);
  const desired = validateSingleNodeDeploymentDesired(
    value,
    'singleNodeDeploymentJournal.release.update.desired',
  );
  if (current.phase !== 'active' || current.release.current === null) {
    throw new Error(
      'singleNodeDeploymentJournal can only prepare an update while active.',
    );
  }
  assertCompatibleReleaseDesired(
    desired,
    current.providerIntent.intent.plan.desired,
    'singleNodeDeploymentJournal.release.update.desired',
  );
  const pending = current.release.transition;
  if (pending !== null) {
    if (
      pending.target.desired.desiredRevisionId === desired.desiredRevisionId
    ) {
      return current;
    }
    throw new Error(
      'singleNodeDeploymentJournal already has a different release transition.',
    );
  }
  if (
    current.release.current.desired.desiredRevisionId ===
    desired.desiredRevisionId
  ) {
    return current;
  }
  const lastGeneration = SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS - 1;
  const remainingAfterUpdate =
    lastGeneration -
    (current.generation + SINGLE_NODE_DEPLOYMENT_RELEASE_UPDATE_RECORDS);
  if (
    remainingAfterUpdate <
    SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE
  ) {
    throw new SingleNodeDeploymentJournalRecoveryReserveError();
  }
  return successor(current, {
    release: {
      ...current.release,
      transition: {
        kind: 'update',
        target: { desired, artifact: null, activation: null },
      },
    },
  });
}

/**
 * Abandon one failed in-place update without changing committed release
 * authority. The current and rollback releases remain exact; only the
 * uncommitted update target is discarded.
 * @param {unknown} prior - Current record.
 * @returns {Readonly<Record<string, any>>} - Successor record.
 */
export function abandonSingleNodeDeploymentReleaseUpdate(prior) {
  const current = validateSingleNodeDeploymentJournal(prior);
  const committed = current.release.current;
  if (
    current.phase !== 'active' ||
    committed === null ||
    committed.artifact === null ||
    committed.activation === null ||
    current.release.transition?.kind !== 'update'
  ) {
    throw new Error(
      'singleNodeDeploymentJournal can only abandon an active release update with a complete current release.',
    );
  }
  return successor(current, {
    release: { ...current.release, transition: null },
  });
}

/**
 * Settle a completely proven install or update transition atomically.
 * @param {unknown} prior - Current record.
 * @returns {Readonly<Record<string, any>>} - Successor record.
 */
export function settleSingleNodeDeploymentReleaseTransition(prior) {
  const current = validateSingleNodeDeploymentJournal(prior);
  const transition = current.release.transition;
  if (
    transition === null ||
    transition.target.artifact === null ||
    transition.target.activation === null ||
    (transition.kind === 'install' && current.phase !== 'activating') ||
    (transition.kind === 'update' && current.phase !== 'active')
  ) {
    throw new Error(
      'singleNodeDeploymentJournal cannot settle an incomplete release transition.',
    );
  }
  return successor(current, {
    release: {
      current: transition.target,
      rollback:
        transition.kind === 'update'
          ? current.release.current
          : current.release.rollback,
      transition: null,
    },
  });
}

/**
 * Verify the only legal monotonic relationship between adjacent records.
 * @param {unknown} prior - Prior record.
 * @param {unknown} next - Candidate successor.
 * @returns {Readonly<Record<string, any>>} - Canonical successor.
 */
export function validateSingleNodeDeploymentJournalSuccessor(prior, next) {
  const current = validateSingleNodeDeploymentJournal(
    prior,
    'singleNodeDeploymentJournal.prior',
  );
  const candidate = validateSingleNodeDeploymentJournal(
    next,
    'singleNodeDeploymentJournal.next',
  );
  if (
    candidate.generation !== current.generation + 1 ||
    candidate.previousJournalId !== current.journalId ||
    candidate.deploymentInstanceId !== current.deploymentInstanceId ||
    candidate.incarnationId !== current.incarnationId ||
    JSON.stringify(candidate.providerIntent) !==
      JSON.stringify(current.providerIntent)
  ) {
    throw new Error(
      'singleNodeDeploymentJournal successor changed immutable authority.',
    );
  }

  const mutationAttemptsChanged =
    JSON.stringify(candidate.mutationAttempts) !==
    JSON.stringify(current.mutationAttempts);
  const resourcesChanged =
    JSON.stringify(candidate.resources) !== JSON.stringify(current.resources);
  const destroyAttemptsChanged =
    JSON.stringify(candidate.destroyAttempts) !==
    JSON.stringify(current.destroyAttempts);
  const deletionRecordsChanged =
    JSON.stringify(candidate.deletionRecords) !==
    JSON.stringify(current.deletionRecords);
  const sshHostChanged =
    JSON.stringify(candidate.sshHost) !== JSON.stringify(current.sshHost);
  const releaseChanged =
    JSON.stringify(candidate.release) !== JSON.stringify(current.release);

  let expected;
  if (candidate.phase !== current.phase) {
    if (
      mutationAttemptsChanged ||
      resourcesChanged ||
      destroyAttemptsChanged ||
      deletionRecordsChanged ||
      sshHostChanged ||
      releaseChanged
    ) {
      throw new Error(
        'singleNodeDeploymentJournal successor must make one transition.',
      );
    }
    expected = advanceSingleNodeDeploymentJournal(current, candidate.phase);
  } else if (mutationAttemptsChanged) {
    if (
      destroyAttemptsChanged ||
      deletionRecordsChanged ||
      sshHostChanged ||
      releaseChanged
    ) {
      throw new Error(
        'singleNodeDeploymentJournal successor must make one transition.',
      );
    }
    const changedAttempts = candidate.mutationAttempts.filter(
      (/** @type {Record<string, any>} */ attempt) => {
        const before =
          current.mutationAttempts.find(
            (/** @type {Record<string, any>} */ entry) =>
              entry.role === attempt.role,
          ) || null;
        return JSON.stringify(before) !== JSON.stringify(attempt);
      },
    );
    const removedAttempts = current.mutationAttempts.filter(
      (/** @type {Record<string, any>} */ attempt) =>
        !candidate.mutationAttempts.some(
          (/** @type {Record<string, any>} */ entry) =>
            entry.role === attempt.role,
        ),
    );
    if (
      changedAttempts.length === 0 &&
      removedAttempts.length === 1 &&
      !resourcesChanged
    ) {
      expected = rejectSingleNodeDeploymentMutation(
        current,
        removedAttempts[0].evidence,
      );
    } else if (changedAttempts.length === 0 || removedAttempts.length !== 0) {
      throw new Error(
        'singleNodeDeploymentJournal successor must change a nonempty mutation batch.',
      );
    } else if (!resourcesChanged) {
      expected = prepareSingleNodeDeploymentMutations(
        current,
        changedAttempts.map(
          (/** @type {Record<string, any>} */ attempt) => attempt.evidence,
        ),
      );
    } else {
      if (changedAttempts.length !== 1) {
        throw new Error(
          'singleNodeDeploymentJournal successor must complete one mutation attempt.',
        );
      }
      const changedAttempt = changedAttempts[0];
      const changedResource = resourceForRole(
        candidate.resources,
        changedAttempt.role,
      );
      if (changedResource === null) {
        throw new Error(
          'singleNodeDeploymentJournal completed mutation has no resource.',
        );
      }
      expected = completeSingleNodeDeploymentMutation(
        current,
        current.providerIntent.provider === 'hetzner'
          ? createHetznerProvisionedResourceRecord(
              current.providerIntent.intent,
              changedAttempt.role,
              changedResource.providerResourceId,
            )
          : createAwsProvisionedResourceRecord(
              current.providerIntent.intent,
              changedAttempt.role,
              changedResource.providerResourceId,
            ),
      );
    }
  } else if (destroyAttemptsChanged) {
    if (
      resourcesChanged ||
      deletionRecordsChanged ||
      sshHostChanged ||
      releaseChanged
    ) {
      throw new Error(
        'singleNodeDeploymentJournal successor must make one transition.',
      );
    }
    const changedAttempts = candidate.destroyAttempts.filter(
      (/** @type {Record<string, any>} */ attempt) => {
        const before = evidenceForRole(current.destroyAttempts, attempt.role);
        return JSON.stringify(before) !== JSON.stringify(attempt);
      },
    );
    const removedAttempts = current.destroyAttempts.filter(
      (/** @type {Record<string, any>} */ attempt) =>
        evidenceForRole(candidate.destroyAttempts, attempt.role) === null,
    );
    if (changedAttempts.length !== 1 || removedAttempts.length !== 0) {
      throw new Error(
        'singleNodeDeploymentJournal successor must change one destruction attempt.',
      );
    }
    expected = prepareSingleNodeDeploymentDestruction(
      current,
      changedAttempts[0],
    );
  } else if (deletionRecordsChanged) {
    if (!resourcesChanged || sshHostChanged || releaseChanged) {
      throw new Error(
        'singleNodeDeploymentJournal successor must make one transition.',
      );
    }
    const changedRecords = candidate.deletionRecords.filter(
      (/** @type {Record<string, any>} */ deletion) => {
        const before = evidenceForRole(current.deletionRecords, deletion.role);
        return JSON.stringify(before) !== JSON.stringify(deletion);
      },
    );
    const removedRecords = current.deletionRecords.filter(
      (/** @type {Record<string, any>} */ deletion) =>
        evidenceForRole(candidate.deletionRecords, deletion.role) === null,
    );
    if (changedRecords.length !== 1 || removedRecords.length !== 0) {
      throw new Error(
        'singleNodeDeploymentJournal successor must change one deletion record.',
      );
    }
    expected = recordSingleNodeDeploymentDeletion(current, changedRecords[0]);
  } else if (resourcesChanged) {
    if (sshHostChanged || releaseChanged) {
      throw new Error(
        'singleNodeDeploymentJournal successor must make one transition.',
      );
    }
    const changed = candidate.resources.filter(
      (/** @type {Record<string, any>} */ resource) => {
        const before = resourceForRole(current.resources, resource.role);
        return JSON.stringify(before) !== JSON.stringify(resource);
      },
    );
    const removed = current.resources.filter(
      (/** @type {Record<string, any>} */ resource) =>
        resourceForRole(candidate.resources, resource.role) === null,
    );
    if (changed.length !== 1 || removed.length !== 0) {
      throw new Error(
        'singleNodeDeploymentJournal successor must change one resource.',
      );
    }
    expected = recordSingleNodeDeploymentResource(current, changed[0]);
  } else if (sshHostChanged) {
    if (releaseChanged) {
      throw new Error(
        'singleNodeDeploymentJournal successor must make one transition.',
      );
    }
    expected = recordSingleNodeDeploymentSshHost(current, candidate.sshHost);
  } else if (releaseChanged) {
    const before = current.release.transition;
    const after = candidate.release.transition;
    if (before === null && after?.kind === 'update') {
      expected = prepareSingleNodeDeploymentReleaseUpdate(
        current,
        after.target.desired,
      );
    } else if (before !== null && after === null) {
      const preservesCommittedReleases =
        JSON.stringify(candidate.release.current) ===
          JSON.stringify(current.release.current) &&
        JSON.stringify(candidate.release.rollback) ===
          JSON.stringify(current.release.rollback);
      expected =
        before.kind === 'update' && preservesCommittedReleases
          ? abandonSingleNodeDeploymentReleaseUpdate(current)
          : settleSingleNodeDeploymentReleaseTransition(current);
    } else if (
      before !== null &&
      after !== null &&
      JSON.stringify(before.target.activation) !==
        JSON.stringify(after.target.activation)
    ) {
      expected = recordSingleNodeDeploymentTransitionActivation(
        current,
        after.target.activation,
      );
    } else if (before !== null && after !== null) {
      expected = recordSingleNodeDeploymentArtifact(
        current,
        after.target.artifact,
      );
    } else {
      throw new Error(
        'singleNodeDeploymentJournal successor changed release state illegally.',
      );
    }
  } else {
    throw new Error(
      'singleNodeDeploymentJournal successor must make one transition.',
    );
  }
  if (expected.journalId !== candidate.journalId) {
    throw new Error(
      'singleNodeDeploymentJournal successor is not one legal transition.',
    );
  }
  return candidate;
}

/** @param {number} generation @returns {string} */
function recordFileName(generation) {
  return `journal-${String(generation).padStart(16, '0')}.json`;
}

/**
 * Resolve the private app-scoped journal paths.
 * @param {unknown} value - App, deployment, and stable data root.
 * @returns {Readonly<Record<string, any>>} - Canonical paths.
 */
export function createSingleNodeDeploymentJournalPaths(value) {
  const input = exactDataObject(
    value,
    new Set(['appId', 'deploymentInstanceId', 'dataRoot']),
    'singleNodeDeploymentJournal.paths',
  );
  assertLogicalId(input.appId, 'singleNodeDeploymentJournal.paths.appId');
  assertSingleNodeDeploymentInstanceId(
    input.deploymentInstanceId,
    'singleNodeDeploymentJournal.paths.deploymentInstanceId',
  );
  const layout = createLocalAppStorageLayout({
    appId: input.appId,
    dataRoot: canonicalAbsolutePath(
      input.dataRoot,
      'singleNodeDeploymentJournal.paths.dataRoot',
    ),
  });
  const deploymentsRoot = path.join(
    layout.controlPath,
    DEPLOYMENTS_DIRECTORY_NAME,
    STORAGE_VERSION_DIRECTORY_NAME,
  );
  const deploymentRoot = path.join(deploymentsRoot, input.deploymentInstanceId);
  const journalRoot = path.join(deploymentRoot, JOURNAL_DIRECTORY_NAME);
  const sharedDirectories = [
    layout.dataRoot,
    path.join(layout.dataRoot, 'applications'),
    layout.appRoot,
    layout.stateRoot,
    layout.controlPath,
  ];
  const privateDirectories = [
    path.join(layout.controlPath, DEPLOYMENTS_DIRECTORY_NAME),
    deploymentsRoot,
    deploymentRoot,
    journalRoot,
  ];
  return deepFreeze({
    ...layout,
    deploymentsRoot,
    deploymentRoot,
    journalRoot,
    sharedDirectories,
    privateDirectories,
    directories: [...sharedDirectories, ...privateDirectories],
  });
}

/**
 * @param {import('node:fs').Stats} stats - Filesystem stats.
 * @param {'file'|'directory'} kind - Concrete required kind.
 * @param {number} uid - Required owner.
 * @param {number} mode - Exact private mode.
 * @param {number} [maximumLinks] - Accepted file link count.
 */
function assertPrivateStats(stats, kind, uid, mode, maximumLinks = 1) {
  const correctKind = kind === 'file' ? stats.isFile() : stats.isDirectory();
  const actualUid = Number(stats.uid);
  const actualMode = Number(stats.mode) & 0o777;
  const actualLinks = Number(stats.nlink);
  if (
    !correctKind ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(actualUid) ||
    actualUid !== Number(uid) ||
    actualMode !== mode ||
    (kind === 'file' &&
      (!Number.isSafeInteger(actualLinks) ||
        actualLinks < 1 ||
        actualLinks > maximumLinks))
  ) {
    throw new SingleNodeDeploymentJournalInvalidError();
  }
}

/**
 * Authenticate a shared local-app layout ancestor without tightening its
 * existing mode. These paths may be used by non-journal app storage.
 * @param {import('node:fs').Stats} stats - Filesystem stats.
 * @param {number} uid - Required owner.
 */
function assertSharedDirectoryStats(stats, uid) {
  const actualUid = Number(stats.uid);
  const actualMode = Number(stats.mode) & 0o777;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(actualUid) ||
    actualUid !== Number(uid) ||
    (actualMode & 0o022) !== 0
  ) {
    throw new SingleNodeDeploymentJournalInvalidError();
  }
}

/**
 * Sync a held, authenticated directory.
 * @param {string} directory - Exact directory.
 * @param {number} uid - Required owner.
 * @param {boolean} [requirePrivate] - Whether exact 0700 is required.
 */
async function syncDirectory(directory, uid, requirePrivate = true) {
  const handle = await open(
    directory,
    fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY || 0) |
      (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const stats = await handle.stat();
    if (requirePrivate) {
      assertPrivateStats(stats, 'directory', uid, PRIVATE_DIRECTORY_MODE);
    } else {
      assertSharedDirectoryStats(stats, uid);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Establish each private namespace component and sync every publication.
 * @param {Readonly<Record<string, any>>} paths - Derived journal paths.
 * @param {number} uid - Required owner.
 */
async function ensurePrivateTree(paths, uid) {
  const tiers = [
    { directories: paths.sharedDirectories, requirePrivate: false },
    { directories: paths.privateDirectories, requirePrivate: true },
  ];
  for (const tier of tiers) {
    for (let index = 0; index < tier.directories.length; index += 1) {
      const directory = tier.directories[index];
      const recursive =
        tier.requirePrivate === false &&
        directory === paths.sharedDirectories[0];
      let created = false;
      try {
        const firstCreated = await mkdir(directory, {
          recursive,
          mode: PRIVATE_DIRECTORY_MODE,
        });
        created = recursive ? firstCreated !== undefined : true;
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      let stats;
      try {
        stats = await lstat(directory);
      } catch {
        throw new SingleNodeDeploymentJournalInvalidError();
      }
      if (tier.requirePrivate) {
        assertPrivateStats(stats, 'directory', uid, PRIVATE_DIRECTORY_MODE);
      } else {
        assertSharedDirectoryStats(stats, uid);
      }
      if (created && directory !== paths.sharedDirectories[0]) {
        const parentRequiresPrivate =
          tier.requirePrivate && directory !== paths.privateDirectories[0];
        await syncDirectory(
          path.dirname(directory),
          uid,
          parentRequiresPrivate,
        );
      }
    }
  }
  await syncDirectory(paths.journalRoot, uid);
}

/**
 * Validate an already-existing private tree without creating it.
 * @param {Readonly<Record<string, any>>} paths - Derived paths.
 * @param {number} uid - Required owner.
 * @returns {Promise<boolean>} - Whether the journal directory exists.
 */
async function inspectPrivateTree(paths, uid) {
  try {
    await lstat(paths.journalRoot);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
  for (const directory of paths.sharedDirectories) {
    let stats;
    try {
      stats = await lstat(directory);
    } catch {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    assertSharedDirectoryStats(stats, uid);
  }
  for (const directory of paths.privateDirectories) {
    let stats;
    try {
      stats = await lstat(directory);
    } catch {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    assertPrivateStats(stats, 'directory', uid, PRIVATE_DIRECTORY_MODE);
  }
  return true;
}

/**
 * Read and authenticate one immutable generation file.
 * @param {string} filePath - Generation file.
 * @param {number} uid - Required owner.
 * @returns {Promise<{text: string, record: Readonly<Record<string, any>>, identity: Readonly<{dev: bigint, ino: bigint, nlink: number}>}>}
 */
async function readRecordFile(filePath, uid) {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW || 0) |
      fsConstants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat({ bigint: true });
    assertPrivateStats(
      /** @type {any} */ (before),
      'file',
      uid,
      PRIVATE_FILE_MODE,
      2,
    );
    if (
      before.size < 1n ||
      before.size > BigInt(SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES)
    ) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new SingleNodeDeploymentJournalInvalidError();
      }
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(
      extra,
      0,
      1,
      bytes.byteLength,
    );
    const after = await handle.stat({ bigint: true });
    if (
      extraBytes !== 0 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.nlink !== after.nlink ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    let text;
    let parsed;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    const record = validateSingleNodeDeploymentJournal(parsed);
    const canonical = `${JSON.stringify(sortCanonicalJsonValue(record))}\n`;
    if (text !== canonical) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    return {
      text,
      record,
      identity: Object.freeze({
        dev: before.dev,
        ino: before.ino,
        nlink: Number(before.nlink),
      }),
    };
  } catch (error) {
    if (error instanceof SingleNodeDeploymentJournalInvalidError) throw error;
    throw new SingleNodeDeploymentJournalInvalidError();
  } finally {
    await handle.close();
  }
}

/**
 * Validate or reap bounded interrupted temporary publications.
 * @param {Readonly<Record<string, any>>} paths - Journal paths.
 * @param {number} uid - Required owner.
 * @param {string[]} names - Directory entries.
 * @param {boolean} reap - Whether safe temp names may be removed.
 * @returns {Promise<Readonly<{dev: bigint, ino: bigint}[]>>} - Remaining authenticated temporary links.
 */
async function inspectTemporaryFiles(paths, uid, names, reap) {
  const temporaryNames = names.filter((name) =>
    JOURNAL_TEMP_PATTERN.test(name),
  );
  if (temporaryNames.length > 16) {
    throw new SingleNodeDeploymentJournalInvalidError();
  }
  let removed = false;
  /** @type {{dev: bigint, ino: bigint}[]} */
  const identities = [];
  for (const name of temporaryNames) {
    const filePath = path.join(paths.journalRoot, name);
    let stats;
    try {
      stats = await lstat(filePath);
    } catch {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    assertPrivateStats(stats, 'file', uid, PRIVATE_FILE_MODE, 2);
    if (stats.size > SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    if (reap) {
      await unlink(filePath);
      removed = true;
    } else {
      identities.push({
        dev: BigInt(stats.dev),
        ino: BigInt(stats.ino),
      });
    }
  }
  if (removed) await syncDirectory(paths.journalRoot, uid);
  return Object.freeze(identities);
}

/**
 * Read the complete bounded append-only chain.
 * @param {Readonly<Record<string, any>>} paths - Journal paths.
 * @param {number} uid - Required owner.
 * @param {boolean} reapTemps - Whether to reap interrupted temp links.
 * @returns {Promise<Readonly<Record<string, any>> | null>} - Latest record.
 */
async function loadLatest(paths, uid, reapTemps) {
  if (!(await inspectPrivateTree(paths, uid))) return null;
  let names;
  try {
    names = await readdir(paths.journalRoot);
  } catch {
    throw new SingleNodeDeploymentJournalInvalidError();
  }
  const temporaryIdentities = await inspectTemporaryFiles(
    paths,
    uid,
    names,
    reapTemps,
  );
  const recordNames = names
    .filter((name) => JOURNAL_FILE_PATTERN.test(name))
    .sort();
  const recognized = new Set([
    ...recordNames,
    ...names.filter((name) => JOURNAL_TEMP_PATTERN.test(name)),
  ]);
  if (recognized.size !== names.length) {
    throw new SingleNodeDeploymentJournalInvalidError();
  }
  if (recordNames.length === 0) return null;
  if (recordNames.length > SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS) {
    throw new SingleNodeDeploymentJournalCapacityError();
  }
  /** @type {Readonly<Record<string, any>> | null} */
  let prior = null;
  for (let index = 0; index < recordNames.length; index += 1) {
    const name = recordNames[index];
    const generation = Number(JOURNAL_FILE_PATTERN.exec(name)?.[1]);
    if (generation !== index) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    const { record, identity } = await readRecordFile(
      path.join(paths.journalRoot, name),
      uid,
    );
    if (
      identity.nlink === 2 &&
      !temporaryIdentities.some(
        (temporary) =>
          temporary.dev === identity.dev && temporary.ino === identity.ino,
      )
    ) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    if (record.generation !== generation) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    if (prior === null) {
      if (generation !== 0) {
        throw new SingleNodeDeploymentJournalInvalidError();
      }
    } else {
      try {
        validateSingleNodeDeploymentJournalSuccessor(prior, record);
      } catch {
        throw new SingleNodeDeploymentJournalInvalidError();
      }
    }
    prior = record;
  }
  return prior;
}

/**
 * Publish one fully synced immutable generation through a hard-link CAS.
 * @param {Readonly<Record<string, any>>} paths - Journal paths.
 * @param {number} uid - Required owner.
 * @param {Readonly<Record<string, any>>} record - Exact next record.
 */
async function publishRecord(paths, uid, record) {
  const targetPath = path.join(
    paths.journalRoot,
    recordFileName(record.generation),
  );
  const temporaryPath = path.join(
    paths.journalRoot,
    `.journal-${String(record.generation).padStart(16, '0')}-${randomUUID()}.tmp`,
  );
  const encoded = Buffer.from(
    `${JSON.stringify(sortCanonicalJsonValue(record))}\n`,
    'utf8',
  );
  if (encoded.byteLength > SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES) {
    throw new SingleNodeDeploymentJournalCapacityError();
  }
  const handle = await open(
    temporaryPath,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW || 0),
    PRIVATE_FILE_MODE,
  );
  let linked = false;
  /** @type {unknown} */
  let primaryError;
  try {
    assertPrivateStats(await handle.stat(), 'file', uid, PRIVATE_FILE_MODE);
    let offset = 0;
    while (offset < encoded.byteLength) {
      const { bytesWritten } = await handle.write(
        encoded,
        offset,
        encoded.byteLength - offset,
        offset,
      );
      if (bytesWritten === 0) {
        throw new Error('journal publication made no progress');
      }
      offset += bytesWritten;
    }
    await handle.sync();
    try {
      await link(temporaryPath, targetPath);
      linked = true;
    } catch (error) {
      if (hasCode(error, 'EEXIST')) {
        throw new SingleNodeDeploymentJournalConflictError();
      }
      throw error;
    }
    await syncDirectory(paths.journalRoot, uid);
  } catch (error) {
    primaryError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    primaryError =
      primaryError === undefined
        ? error
        : new AggregateError(
            [primaryError, error],
            'Journal publication and descriptor cleanup both failed.',
          );
  }
  try {
    await unlink(temporaryPath);
    await syncDirectory(paths.journalRoot, uid);
  } catch (error) {
    if (!hasCode(error, 'ENOENT') && !linked) {
      primaryError =
        primaryError === undefined
          ? error
          : new AggregateError(
              [primaryError, error],
              'Journal publication and temporary cleanup both failed.',
            );
    }
  }
  if (primaryError !== undefined) throw primaryError;
}

/**
 * Create a stable app-scoped append-only journal store. The constructor has no
 * filesystem side effects; initialize is the mandatory pre-mutation write.
 * @param {unknown} value - Store identity and optional testable roots.
 * @returns {Readonly<Record<string, any>>} - Journal store capability.
 */
export function createSingleNodeDeploymentJournalStore(value) {
  const input = exactOptionsObject(
    value,
    STORE_REQUIRED_KEYS,
    STORE_OPTION_KEYS,
    'singleNodeDeploymentJournal.store',
  );
  assertLogicalId(input.appId, 'singleNodeDeploymentJournal.store.appId');
  assertSingleNodeDeploymentInstanceId(
    input.deploymentInstanceId,
    'singleNodeDeploymentJournal.store.deploymentInstanceId',
  );
  const expectedUid =
    input.expectedUid === undefined
      ? process.getuid?.()
      : nonnegativeSafeInteger(
          input.expectedUid,
          'singleNodeDeploymentJournal.store.expectedUid',
        );
  if (!Number.isSafeInteger(expectedUid) || Number(expectedUid) < 0) {
    throw new Error(
      'singleNodeDeploymentJournal store requires a numeric account uid.',
    );
  }
  const dataRoot =
    input.dataRoot === undefined
      ? resolveStableLocalAppDataRoot({
          platform: input.platform,
          homeDirectory: input.homeDirectory,
        })
      : canonicalAbsolutePath(
          input.dataRoot,
          'singleNodeDeploymentJournal.store.dataRoot',
        );
  const paths = createSingleNodeDeploymentJournalPaths({
    appId: input.appId,
    deploymentInstanceId: input.deploymentInstanceId,
    dataRoot,
  });
  const uid = Number(expectedUid);

  /**
   * Establish the authenticated private namespace without publishing journal
   * authority. This lets earlier local credential and identity setup inherit a
   * safely created 0700 data root.
   */
  async function prepareStorage() {
    await ensurePrivateTree(paths, uid);
  }

  /** @returns {Promise<Readonly<Record<string, any>> | null>} */
  async function read() {
    const latest = await loadLatest(paths, uid, false);
    if (
      latest !== null &&
      (latest.deploymentInstanceId !== input.deploymentInstanceId ||
        latest.providerIntent.intent.plan.desired.intent.appId !== input.appId)
    ) {
      throw new SingleNodeDeploymentJournalInvalidError();
    }
    return latest;
  }

  /** @param {unknown} request - Initialization authority. */
  async function initialize(request) {
    const initial = createSingleNodeDeploymentJournal(request);
    if (
      initial.deploymentInstanceId !== input.deploymentInstanceId ||
      initial.providerIntent.intent.plan.desired.intent.appId !== input.appId
    ) {
      throw new Error(
        'singleNodeDeploymentJournal initial authority does not match its store.',
      );
    }
    await ensurePrivateTree(paths, uid);
    const latest = await loadLatest(paths, uid, true);
    if (latest !== null) {
      if (
        latest.deploymentInstanceId === initial.deploymentInstanceId &&
        latest.incarnationId === initial.incarnationId &&
        JSON.stringify(latest.providerIntent) ===
          JSON.stringify(initial.providerIntent)
      ) {
        return latest;
      }
      throw new SingleNodeDeploymentJournalConflictError();
    }
    await publishRecord(paths, uid, initial);
    return initial;
  }

  /** @param {unknown} request - Exact CAS publication request. */
  async function commit(request) {
    const inputRequest = exactDataObject(
      request,
      COMMIT_KEYS,
      'singleNodeDeploymentJournal.commit',
    );
    const expectedGeneration = nonnegativeSafeInteger(
      inputRequest.expectedGeneration,
      'singleNodeDeploymentJournal.commit.expectedGeneration',
    );
    assertDomainSeparatedSha256Id(
      inputRequest.expectedJournalId,
      SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
      'singleNodeDeploymentJournal.commit.expectedJournalId',
    );
    const next = validateSingleNodeDeploymentJournal(
      inputRequest.next,
      'singleNodeDeploymentJournal.commit.next',
    );
    await ensurePrivateTree(paths, uid);
    const current = await loadLatest(paths, uid, true);
    if (
      current === null ||
      current.generation !== expectedGeneration ||
      current.journalId !== inputRequest.expectedJournalId
    ) {
      throw new SingleNodeDeploymentJournalConflictError();
    }
    if (next.journalId === current.journalId) return current;
    validateSingleNodeDeploymentJournalSuccessor(current, next);
    if (current.generation + 1 >= SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS) {
      throw new SingleNodeDeploymentJournalCapacityError();
    }
    await publishRecord(paths, uid, next);
    return next;
  }

  return Object.freeze({ paths, prepareStorage, read, initialize, commit });
}

export default {
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_KIND,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_SCHEMA_VERSION,
  abandonSingleNodeDeploymentReleaseUpdate,
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  createSingleNodeDeploymentJournalPaths,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentCurrentRelease,
  getSingleNodeDeploymentDestructionRecoveryState,
  getSingleNodeDeploymentEffectiveDesired,
  getSingleNodeDeploymentEffectiveTargetRelease,
  getSingleNodeDeploymentMutationAttempt,
  getSingleNodeDeploymentProvisioningRecoveryState,
  getSingleNodeDeploymentReleaseState,
  getSingleNodeDeploymentReleaseTransition,
  prepareSingleNodeDeploymentReleaseUpdate,
  prepareSingleNodeDeploymentDestruction,
  prepareSingleNodeDeploymentMutation,
  prepareSingleNodeDeploymentMutations,
  rejectSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentArtifact,
  recordSingleNodeDeploymentDeletion,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  recordSingleNodeDeploymentTransitionActivation,
  settleSingleNodeDeploymentReleaseTransition,
  validateSingleNodeDeploymentJournal,
  validateSingleNodeDeploymentJournalSuccessor,
};
