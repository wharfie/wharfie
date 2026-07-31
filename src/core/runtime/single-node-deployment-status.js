/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- The public status contract keeps exact plain-data validators beside its pure disposition. */

import { isIPv4 } from 'node:net';

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { ARTIFACT_ID_PREFIX, assertArtifactId } from './artifact-record.js';
import { validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
  validateSingleNodeDeploymentDesired,
} from './single-node-deployment-desired.js';
import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
} from './single-node-deployment-identity.js';
import {
  SINGLE_NODE_ACCESS_KIND,
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
} from './single-node-deployment-intent.js';
import {
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
  getSingleNodeDeploymentEffectiveDesired,
  getSingleNodeDeploymentReleaseTransition,
  validateSingleNodeDeploymentJournal,
} from './single-node-deployment-journal.js';

export const SINGLE_NODE_DEPLOYMENT_STATUS_SCHEMA_VERSION = 2;
export const SINGLE_NODE_DEPLOYMENT_STATUS_KIND =
  'wharfie.single-node-deployment.status';

const MAX_STATUS_BYTES = 256 * 1024;
const INPUT_KEYS = new Set([
  'journal',
  'providerObservation',
  'guestObservation',
]);
const STATUS_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provider',
  'status',
  'reason',
  'nextAction',
  'deployment',
  'journal',
  'providerState',
  'guest',
]);
const DEPLOYMENT_KEYS = new Set([
  'appId',
  'deploymentId',
  'deploymentInstanceId',
  'revisionId',
  'desiredRevisionId',
  'artifact',
  'mode',
  'machine',
  'access',
]);
const ARTIFACT_KEYS = new Set(['artifactId', 'byteDigest', 'size', 'target']);
const JOURNAL_KEYS = new Set([
  'journalId',
  'generation',
  'incarnationId',
  'phase',
  'releaseTransition',
]);
const PROVIDER_STATE_KEYS = new Set(['status', 'resources']);
const RESOURCE_KEYS = new Set(['role', 'id', 'state', 'publicIpv4']);
const GUEST_KEYS = new Set([
  'state',
  'address',
  'hostKeyFingerprint',
  'service',
]);
const SERVICE_KEYS = new Set([
  'health',
  'activeArtifactId',
  'activeRevisionId',
  'desiredMatches',
]);
const PROVIDERS = new Set(['aws', 'hetzner']);
const STATUSES = new Set([
  'converging',
  'healthy',
  'degraded',
  'recovery-required',
  'destroying',
  'destroyed',
]);
const REASONS = new Set([
  'provider-drift',
  'provider-conflict',
  'guest-unreachable',
  'guest-invalid',
  'guest-unhealthy',
  'guest-release-mismatch',
  'journal-behind-effects',
]);
const NEXT_ACTIONS = new Set([
  'none',
  'resume-apply',
  'resume-destroy',
  'repair-activation',
  'resume-update',
  'investigate-conflict',
]);
const JOURNAL_PHASES = new Set([
  'planned',
  'provisioning',
  'provisioned',
  'activating',
  'active',
  'destroying',
  'destroyed',
]);
const PROVIDER_STATUSES = new Set(['exact', 'converging', 'degraded']);
const RESOURCE_STATES = new Set(['absent', 'settling', 'exact', 'conflict']);
const GUEST_STATES = new Set([
  'not-applicable',
  'not-ready',
  'unreachable',
  'invalid',
  'observed',
]);
const SERVICE_HEALTH = new Set([
  'healthy',
  'starting',
  'degraded',
  'stopped',
  'failed',
  'absent',
  'unknown',
]);
const AWS_ROLES = Object.freeze([
  Object.freeze({ publicRole: 'instance', journalRole: 'instance' }),
  Object.freeze({ publicRole: 'root-volume', journalRole: 'rootVolume' }),
  Object.freeze({
    publicRole: 'security-group',
    journalRole: 'securityGroup',
  }),
]);
const HETZNER_ROLES = Object.freeze([
  Object.freeze({ publicRole: 'firewall', journalRole: 'firewall' }),
  Object.freeze({ publicRole: 'primary-ip', journalRole: 'primaryIp' }),
  Object.freeze({ publicRole: 'server', journalRole: 'server' }),
]);
const SSH_FINGERPRINT_PATTERN = /^SHA256:([A-Za-z0-9+/]{43})$/u;

/**
 * @param {any} value
 * @returns {any}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactObject(value, expected, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
  }
  return object;
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {string}
 */
function boundedString(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 16 * 1024 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    throw new TypeError(`${valuePath} must be one bounded nonempty string.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {string}
 */
function canonicalIpv4(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !isIPv4(value) ||
    value !== value.split('.').map(Number).join('.')
  ) {
    throw new TypeError(`${valuePath} must be one canonical IPv4 address.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {string}
 */
function sshFingerprint(value, valuePath) {
  if (typeof value !== 'string' || !SSH_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${valuePath} must be one SHA-256 SSH fingerprint.`);
  }
  const encoded = SSH_FINGERPRINT_PATTERN.exec(value)?.[1];
  if (
    !encoded ||
    Buffer.from(encoded, 'base64').byteLength !== 32 ||
    Buffer.from(encoded, 'base64').toString('base64').replace(/=+$/u, '') !==
      encoded
  ) {
    throw new TypeError(`${valuePath} must be one canonical SSH fingerprint.`);
  }
  return value;
}

/**
 * @param {'aws'|'hetzner'} provider
 * @returns {readonly Readonly<{publicRole: string, journalRole: string}>[]}
 */
function rolesFor(provider) {
  return provider === 'aws' ? AWS_ROLES : HETZNER_ROLES;
}

/**
 * Validate the stable desired-state projection present in every receipt.
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
function validateDeployment(value, valuePath) {
  const deployment = exactObject(value, DEPLOYMENT_KEYS, valuePath);
  assertLogicalId(deployment.appId, `${valuePath}.appId`);
  assertLogicalId(deployment.deploymentId, `${valuePath}.deploymentId`);
  assertSingleNodeDeploymentInstanceId(
    deployment.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  assertApplicationRevisionId(deployment.revisionId, `${valuePath}.revisionId`);
  assertDomainSeparatedSha256Id(
    deployment.desiredRevisionId,
    SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
    `${valuePath}.desiredRevisionId`,
  );
  const mode = exactObject(
    deployment.mode,
    new Set(['kind', 'version']),
    `${valuePath}.mode`,
  );
  const machine = exactObject(
    deployment.machine,
    new Set(['class']),
    `${valuePath}.machine`,
  );
  if (
    mode.kind !== SINGLE_NODE_DEPLOYMENT_MODE.kind ||
    mode.version !== SINGLE_NODE_DEPLOYMENT_MODE.version ||
    machine.class !== SINGLE_NODE_MACHINE.class
  ) {
    throw new TypeError(`${valuePath} mode or machine is unsupported.`);
  }
  const access = exactObject(
    deployment.access,
    new Set(['kind', 'allowedIpv4']),
    `${valuePath}.access`,
  );
  if (
    access.kind !== SINGLE_NODE_ACCESS_KIND ||
    !Array.isArray(access.allowedIpv4) ||
    access.allowedIpv4.length === 0 ||
    access.allowedIpv4.some((entry) => {
      if (typeof entry !== 'string' || !entry.endsWith('/32')) return true;
      const address = entry.slice(0, -3);
      return (
        !isIPv4(address) || address !== address.split('.').map(Number).join('.')
      );
    }) ||
    access.allowedIpv4.some(
      (entry, index) =>
        index > 0 && access.allowedIpv4[index - 1].localeCompare(entry) >= 0,
    )
  ) {
    throw new TypeError(`${valuePath}.access is invalid.`);
  }
  const artifact = exactObject(
    deployment.artifact,
    ARTIFACT_KEYS,
    `${valuePath}.artifact`,
  );
  assertArtifactId(artifact.artifactId, `${valuePath}.artifact.artifactId`);
  const byteDigest = validateSha256Digest(
    artifact.byteDigest,
    `${valuePath}.artifact.byteDigest`,
  );
  if (
    artifact.artifactId !== `${ARTIFACT_ID_PREFIX}_${byteDigest.value}` ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 1
  ) {
    throw new Error(
      `${valuePath}.artifact does not match exact artifact bytes.`,
    );
  }
  const target = validateBuildTarget(
    artifact.target,
    `${valuePath}.artifact.target`,
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      appId: deployment.appId,
      deploymentId: deployment.deploymentId,
      deploymentInstanceId: deployment.deploymentInstanceId,
      revisionId: deployment.revisionId,
      desiredRevisionId: deployment.desiredRevisionId,
      artifact: {
        artifactId: artifact.artifactId,
        byteDigest,
        size: artifact.size,
        target,
      },
      mode: {
        kind: mode.kind,
        version: mode.version,
      },
      machine: { class: machine.class },
      access: {
        kind: access.kind,
        allowedIpv4: [...access.allowedIpv4],
      },
    }),
  );
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
function validateJournalProjection(value, valuePath) {
  const journal = exactObject(value, JOURNAL_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    journal.journalId,
    SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
    `${valuePath}.journalId`,
  );
  if (!Number.isSafeInteger(journal.generation) || journal.generation < 0) {
    throw new TypeError(`${valuePath}.generation is invalid.`);
  }
  assertSingleNodeDeploymentIncarnationId(
    journal.incarnationId,
    `${valuePath}.incarnationId`,
  );
  if (!JOURNAL_PHASES.has(journal.phase)) {
    throw new TypeError(`${valuePath}.phase is unsupported.`);
  }
  if (
    journal.releaseTransition !== null &&
    !['install', 'update'].includes(journal.releaseTransition)
  ) {
    throw new TypeError(`${valuePath}.releaseTransition is unsupported.`);
  }
  if (
    (journal.releaseTransition === 'install' && journal.phase === 'active') ||
    (journal.releaseTransition === 'update' &&
      !['active', 'destroying', 'destroyed'].includes(journal.phase))
  ) {
    throw new Error(`${valuePath}.releaseTransition conflicts with its phase.`);
  }
  return deepFreeze(sortCanonicalJsonValue(journal));
}

/**
 * @param {unknown} value
 * @param {'aws'|'hetzner'} provider
 * @param {string} valuePath
 * @param {Readonly<Record<string, any>>|null} journal
 * @param {boolean} requireSorted
 * @returns {Readonly<Record<string, any>>}
 */
function validateProviderObservation(
  value,
  provider,
  valuePath,
  journal,
  requireSorted,
) {
  const observation = exactObject(value, PROVIDER_STATE_KEYS, valuePath);
  if (!PROVIDER_STATUSES.has(observation.status)) {
    throw new TypeError(`${valuePath}.status is unsupported.`);
  }
  const roles = rolesFor(provider);
  if (
    !Array.isArray(observation.resources) ||
    observation.resources.length !== roles.length
  ) {
    throw new TypeError(`${valuePath}.resources must cover every exact role.`);
  }
  const expectedRoles = roles.map(({ publicRole }) => publicRole).sort();
  const resources = observation.resources.map((candidate, index) => {
    const resourcePath = `${valuePath}.resources[${index}]`;
    const resource = exactObject(candidate, RESOURCE_KEYS, resourcePath);
    if (!expectedRoles.includes(resource.role)) {
      throw new TypeError(`${resourcePath}.role is unsupported.`);
    }
    const id =
      resource.id === null
        ? null
        : boundedString(resource.id, `${resourcePath}.id`);
    if (!RESOURCE_STATES.has(resource.state)) {
      throw new TypeError(`${resourcePath}.state is unsupported.`);
    }
    if (resource.state === 'exact' && id === null) {
      throw new TypeError(`${resourcePath}.exact state requires an identity.`);
    }
    const publicIpv4 =
      resource.publicIpv4 === null
        ? null
        : canonicalIpv4(resource.publicIpv4, `${resourcePath}.publicIpv4`);
    const addressRoles =
      provider === 'aws'
        ? new Set(['instance'])
        : new Set(['primary-ip', 'server']);
    if (publicIpv4 !== null && !addressRoles.has(resource.role)) {
      throw new TypeError(`${resourcePath}.publicIpv4 is unsupported.`);
    }
    if (journal !== null) {
      const journalRole = roles.find(
        ({ publicRole }) => publicRole === resource.role,
      )?.journalRole;
      const known = journal.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          entry.role === journalRole,
      );
      if (known !== undefined && id !== String(known.providerResourceId)) {
        throw new Error(
          `${resourcePath}.id does not match durable provider authority.`,
        );
      }
      if (
        known?.publicIpv4 !== null &&
        known?.publicIpv4 !== undefined &&
        publicIpv4 !== null &&
        publicIpv4 !== known.publicIpv4
      ) {
        throw new Error(
          `${resourcePath}.publicIpv4 conflicts with durable authority.`,
        );
      }
    }
    return { role: resource.role, id, state: resource.state, publicIpv4 };
  });
  const sorted = [...resources].sort((left, right) =>
    left.role.localeCompare(right.role),
  );
  if (
    sorted.some((resource, index) => resource.role !== expectedRoles[index]) ||
    (requireSorted &&
      sorted.some(
        (resource, index) =>
          resource.role !== observation.resources[index].role,
      ))
  ) {
    throw new TypeError(
      `${valuePath}.resources must be uniquely exact-role-sorted.`,
    );
  }
  const hasConflict = sorted.some((resource) => resource.state === 'conflict');
  if (hasConflict && observation.status !== 'degraded') {
    throw new Error(`${valuePath} conflict requires degraded status.`);
  }
  if (
    observation.status === 'exact' &&
    sorted.some((resource) => ['settling', 'conflict'].includes(resource.state))
  ) {
    throw new Error(`${valuePath} exact status cannot contain uncertainty.`);
  }
  if (observation.status === 'converging' && hasConflict) {
    throw new Error(`${valuePath} convergence cannot contain conflict.`);
  }
  const addresses = new Set(
    sorted
      .map((resource) => resource.publicIpv4)
      .filter((address) => address !== null),
  );
  if (addresses.size > 1) {
    throw new Error(`${valuePath} contains conflicting public addresses.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      status: observation.status,
      resources: sorted,
    }),
  );
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @param {Readonly<Record<string, any>>|null} desired
 * @param {Readonly<Record<string, any>>|null} journal
 * @param {Readonly<Record<string, any>>|null} providerState
 * @returns {Readonly<Record<string, any>>}
 */
function validateGuestObservation(
  value,
  valuePath,
  desired,
  journal,
  providerState,
) {
  const guest = exactObject(value, GUEST_KEYS, valuePath);
  if (!GUEST_STATES.has(guest.state)) {
    throw new TypeError(`${valuePath}.state is unsupported.`);
  }
  const address =
    guest.address === null
      ? null
      : canonicalIpv4(guest.address, `${valuePath}.address`);
  const hostKeyFingerprint =
    guest.hostKeyFingerprint === null
      ? null
      : sshFingerprint(
          guest.hostKeyFingerprint,
          `${valuePath}.hostKeyFingerprint`,
        );
  let service = null;
  if (guest.service !== null) {
    const candidate = exactObject(
      guest.service,
      SERVICE_KEYS,
      `${valuePath}.service`,
    );
    if (!SERVICE_HEALTH.has(candidate.health)) {
      throw new TypeError(`${valuePath}.service.health is unsupported.`);
    }
    const activeArtifactId =
      candidate.activeArtifactId === null
        ? null
        : (assertArtifactId(
            candidate.activeArtifactId,
            `${valuePath}.service.activeArtifactId`,
          ),
          candidate.activeArtifactId);
    const activeRevisionId =
      candidate.activeRevisionId === null
        ? null
        : (assertApplicationRevisionId(
            candidate.activeRevisionId,
            `${valuePath}.service.activeRevisionId`,
          ),
          candidate.activeRevisionId);
    if (
      (activeArtifactId === null) !== (activeRevisionId === null) ||
      typeof candidate.desiredMatches !== 'boolean'
    ) {
      throw new TypeError(`${valuePath}.service release state is invalid.`);
    }
    if (desired !== null) {
      const desiredRevisionId =
        desired.artifact.revisionId ?? desired.revisionId;
      const actualMatches =
        activeArtifactId === desired.artifact.artifactId &&
        activeRevisionId === desiredRevisionId;
      if (candidate.desiredMatches !== actualMatches) {
        throw new Error(
          `${valuePath}.service.desiredMatches does not match exact desired state.`,
        );
      }
    }
    service = {
      health: candidate.health,
      activeArtifactId,
      activeRevisionId,
      desiredMatches: candidate.desiredMatches,
    };
  }
  if (
    (guest.state === 'observed') !== (service !== null) ||
    (guest.state === 'observed' &&
      (address === null || hostKeyFingerprint === null)) ||
    (guest.state === 'not-applicable' &&
      (address !== null || hostKeyFingerprint !== null))
  ) {
    throw new TypeError(`${valuePath} details do not match its state.`);
  }
  if (journal !== null) {
    if (
      journal.sshHost !== null &&
      ((address !== null && address !== journal.sshHost.address) ||
        (hostKeyFingerprint !== null &&
          hostKeyFingerprint !== journal.sshHost.fingerprint))
    ) {
      throw new Error(
        `${valuePath} conflicts with durable SSH host authority.`,
      );
    }
    if (journal.sshHost === null && hostKeyFingerprint !== null) {
      throw new Error(`${valuePath} lacks durable SSH host authority.`);
    }
  }
  if (address !== null && providerState !== null) {
    const providerAddresses = providerState.resources
      .map(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.publicIpv4,
      )
      .filter((/** @type {unknown} */ candidate) => candidate !== null);
    if (providerAddresses.length > 0 && !providerAddresses.includes(address)) {
      throw new Error(`${valuePath}.address conflicts with provider evidence.`);
    }
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      state: guest.state,
      address,
      hostKeyFingerprint,
      service,
    }),
  );
}

/**
 * @param {string} phase
 * @param {string|null} releaseTransition
 * @param {Readonly<Record<string, any>>} providerState
 * @param {Readonly<Record<string, any>>} guest
 * @returns {Readonly<{status: string, reason: string|null, nextAction: string}>}
 */
function deriveDisposition(phase, releaseTransition, providerState, guest) {
  const states = providerState.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ resource) => resource.state,
  );
  const allAbsent = states.every(
    (/** @type {string} */ state) => state === 'absent',
  );
  const allExact = states.every(
    (/** @type {string} */ state) => state === 'exact',
  );
  if (states.includes('conflict')) {
    return Object.freeze({
      status: 'degraded',
      reason: 'provider-conflict',
      nextAction: 'investigate-conflict',
    });
  }
  if (providerState.status === 'degraded') {
    return Object.freeze({
      status: 'degraded',
      reason: 'provider-drift',
      nextAction: 'investigate-conflict',
    });
  }
  if (phase === 'destroying') {
    return allAbsent
      ? Object.freeze({
          status: 'recovery-required',
          reason: 'journal-behind-effects',
          nextAction: 'resume-destroy',
        })
      : Object.freeze({
          status: 'destroying',
          reason: null,
          nextAction: 'resume-destroy',
        });
  }
  if (phase === 'destroyed') {
    return allAbsent
      ? Object.freeze({
          status: 'destroyed',
          reason: null,
          nextAction: 'none',
        })
      : Object.freeze({
          status: 'degraded',
          reason: 'provider-drift',
          nextAction: 'investigate-conflict',
        });
  }
  if (phase === 'planned' || phase === 'provisioning') {
    return allExact
      ? Object.freeze({
          status: 'recovery-required',
          reason: 'journal-behind-effects',
          nextAction: 'resume-apply',
        })
      : Object.freeze({
          status: 'converging',
          reason: null,
          nextAction: 'resume-apply',
        });
  }
  if (!allExact) {
    return Object.freeze({
      status: 'degraded',
      reason: 'provider-drift',
      nextAction: 'investigate-conflict',
    });
  }
  const service = guest.service;
  const healthyDesired =
    guest.state === 'observed' &&
    service?.health === 'healthy' &&
    service.desiredMatches === true;
  if (phase === 'active' && releaseTransition === 'update') {
    if (healthyDesired) {
      return Object.freeze({
        status: 'recovery-required',
        reason: 'journal-behind-effects',
        nextAction: 'resume-update',
      });
    }
    if (guest.state === 'observed' && service?.health === 'healthy') {
      return Object.freeze({
        status: 'converging',
        reason: null,
        nextAction: 'resume-update',
      });
    }
    const reason =
      guest.state === 'unreachable'
        ? 'guest-unreachable'
        : guest.state === 'invalid'
          ? 'guest-invalid'
          : service?.desiredMatches === false
            ? 'guest-release-mismatch'
            : 'guest-unhealthy';
    return Object.freeze({
      status: 'recovery-required',
      reason,
      nextAction: 'resume-update',
    });
  }
  if (phase === 'provisioned' || phase === 'activating') {
    if (healthyDesired) {
      return Object.freeze({
        status: 'recovery-required',
        reason: 'journal-behind-effects',
        nextAction: 'resume-apply',
      });
    }
    const reason =
      guest.state === 'unreachable'
        ? 'guest-unreachable'
        : guest.state === 'invalid'
          ? 'guest-invalid'
          : service?.desiredMatches === false
            ? 'guest-release-mismatch'
            : 'guest-unhealthy';
    return Object.freeze({
      status: 'recovery-required',
      reason,
      nextAction: 'repair-activation',
    });
  }
  if (healthyDesired) {
    return Object.freeze({
      status: 'healthy',
      reason: null,
      nextAction: 'none',
    });
  }
  const reason =
    guest.state === 'unreachable'
      ? 'guest-unreachable'
      : guest.state === 'invalid'
        ? 'guest-invalid'
        : service?.desiredMatches === false
          ? 'guest-release-mismatch'
          : 'guest-unhealthy';
  return Object.freeze({
    status: 'degraded',
    reason,
    nextAction:
      guest.state === 'unreachable' || guest.state === 'invalid'
        ? 'investigate-conflict'
        : 'repair-activation',
  });
}

/**
 * Validate one stable provider-neutral status receipt.
 * @param {unknown} value
 * @param {string} [valuePath]
 * @returns {Readonly<Record<string, any>>}
 */
export function validateSingleNodeDeploymentStatus(
  value,
  valuePath = 'singleNodeDeploymentStatus',
) {
  const status = cloneBoundedJsonObject(value, MAX_STATUS_BYTES, valuePath);
  exactObject(status, STATUS_KEYS, valuePath);
  if (
    status.schemaVersion !== SINGLE_NODE_DEPLOYMENT_STATUS_SCHEMA_VERSION ||
    status.kind !== SINGLE_NODE_DEPLOYMENT_STATUS_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  if (!PROVIDERS.has(status.provider)) {
    throw new TypeError(`${valuePath}.provider is unsupported.`);
  }
  if (
    !STATUSES.has(status.status) ||
    (status.reason !== null && !REASONS.has(status.reason)) ||
    !NEXT_ACTIONS.has(status.nextAction)
  ) {
    throw new TypeError(`${valuePath} disposition is unsupported.`);
  }
  const deployment = validateDeployment(
    status.deployment,
    `${valuePath}.deployment`,
  );
  const journal = validateJournalProjection(
    status.journal,
    `${valuePath}.journal`,
  );
  const providerState = validateProviderObservation(
    status.providerState,
    status.provider,
    `${valuePath}.providerState`,
    null,
    true,
  );
  const guest = validateGuestObservation(
    status.guest,
    `${valuePath}.guest`,
    deployment,
    null,
    providerState,
  );
  const disposition = deriveDisposition(
    journal.phase,
    journal.releaseTransition,
    providerState,
    guest,
  );
  if (
    status.status !== disposition.status ||
    status.reason !== disposition.reason ||
    status.nextAction !== disposition.nextAction
  ) {
    throw new Error(`${valuePath} disposition does not match its evidence.`);
  }
  if (
    (status.status === 'healthy' ||
      status.status === 'destroyed' ||
      status.status === 'destroying' ||
      status.status === 'converging') &&
    status.reason !== null
  ) {
    throw new Error(`${valuePath}.reason is unsupported for its status.`);
  }
  const normalized = {
    schemaVersion: SINGLE_NODE_DEPLOYMENT_STATUS_SCHEMA_VERSION,
    kind: SINGLE_NODE_DEPLOYMENT_STATUS_KIND,
    provider: status.provider,
    status: status.status,
    reason: status.reason,
    nextAction: status.nextAction,
    deployment,
    journal,
    providerState,
    guest,
  };
  assertManifestIsSecretFree(normalized, valuePath);
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/**
 * Create one status receipt from already-observed local, provider, and guest
 * truth. This function is pure and possesses no provider, filesystem, SSH, or
 * journal mutation capability.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createSingleNodeDeploymentStatus(value) {
  const input = exactObject(value, INPUT_KEYS, 'singleNodeDeploymentStatus');
  const journal = validateSingleNodeDeploymentJournal(
    input.journal,
    'singleNodeDeploymentStatus.journal',
  );
  const desired = validateSingleNodeDeploymentDesired(
    getSingleNodeDeploymentEffectiveDesired(journal),
    'singleNodeDeploymentStatus.journal.effectiveDesired',
  );
  const provider = journal.providerIntent.provider;
  if (!PROVIDERS.has(provider) || desired.intent.provider.kind !== provider) {
    throw new Error(
      'singleNodeDeploymentStatus journal provider authority is invalid.',
    );
  }
  const providerState = validateProviderObservation(
    input.providerObservation,
    provider,
    'singleNodeDeploymentStatus.providerObservation',
    journal,
    false,
  );
  const guest = validateGuestObservation(
    input.guestObservation,
    'singleNodeDeploymentStatus.guestObservation',
    desired,
    journal,
    providerState,
  );
  const releaseTransition =
    getSingleNodeDeploymentReleaseTransition(journal)?.kind ?? null;
  const disposition = deriveDisposition(
    journal.phase,
    releaseTransition,
    providerState,
    guest,
  );
  return validateSingleNodeDeploymentStatus({
    schemaVersion: SINGLE_NODE_DEPLOYMENT_STATUS_SCHEMA_VERSION,
    kind: SINGLE_NODE_DEPLOYMENT_STATUS_KIND,
    provider,
    ...disposition,
    deployment: {
      appId: desired.intent.appId,
      deploymentId: desired.intent.deployment.id,
      deploymentInstanceId: desired.deploymentInstanceId,
      revisionId: desired.artifact.revisionId,
      desiredRevisionId: desired.desiredRevisionId,
      artifact: {
        artifactId: desired.artifact.artifactId,
        byteDigest: desired.artifact.byteDigest,
        size: desired.artifact.size,
        target: desired.intent.target,
      },
      mode: desired.intent.mode,
      machine: desired.intent.machine,
      access: desired.intent.access,
    },
    journal: {
      journalId: journal.journalId,
      generation: journal.generation,
      incarnationId: journal.incarnationId,
      phase: journal.phase,
      releaseTransition,
    },
    providerState,
    guest,
  });
}

export default {
  SINGLE_NODE_DEPLOYMENT_STATUS_KIND,
  SINGLE_NODE_DEPLOYMENT_STATUS_SCHEMA_VERSION,
  createSingleNodeDeploymentStatus,
  validateSingleNodeDeploymentStatus,
};
