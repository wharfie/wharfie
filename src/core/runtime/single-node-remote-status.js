/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow read-only composition root keeps its exact injected protocol beside the implementation. */

import path from 'node:path';

import { assertApplicationRevisionId } from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { createBoundedProcessRunner } from './bounded-process.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { createDeploymentOpenSshTransport } from './deployment-openssh-transport.js';
import { readDeploymentSshHostKey } from './deployment-ssh-host-key.js';
import { createDeploymentSshIdentityStore } from './deployment-ssh-identity.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  createSingleNodeCloudInit,
} from './single-node-cloud-init.js';
import { validateSingleNodeDeploymentJournal } from './single-node-deployment-journal.js';
import {
  getSingleNodeRemoteArtifactPaths,
  validateSingleNodeRemoteServiceStatus,
} from './single-node-remote-activation.js';

const MAX_BOOTSTRAP_IDENTITY_BYTES = 16 * 1024;
const MAX_SERVICE_STATUS_BYTES = 256 * 1024;
const INPUT_KEYS = new Set(['journal', 'dataRoot']);
const DEPENDENCY_KEYS = new Set([
  'readIdentity',
  'readHostKey',
  'createTransport',
]);
const SSH_IDENTITY_KEYS = new Set([
  'privateKeyPath',
  'publicKey',
  'publicKeyFingerprint',
  'knownHostsPath',
]);
const HOST_KEY_KEYS = new Set(['address', 'algorithm', 'fingerprint']);
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/u;
const SERVICE_HEALTH_STATES = new Set([
  'healthy',
  'starting',
  'degraded',
  'stopped',
  'failed',
  'absent',
  'unknown',
]);
const DESIRED_CONVERGENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'unit',
  'desired',
  'disposition',
  'basis',
]);
const DESIRED_RELEASE_KEYS = new Set(['artifactId', 'revisionId']);
const DESIRED_CONVERGENCE_DISPOSITIONS = new Set([
  'authorized',
  'conflict',
  'unknown',
]);
const DESIRED_CONVERGENCE_BASES = new Set([
  'physical-absence',
  'durable-install',
  'durable-change',
  'durable-active',
]);

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
  /** @type {Record<string, any>} */
  const result = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {string}
 */
function canonicalAbsolutePath(value, valuePath) {
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
    throw new TypeError(`${valuePath} must be a canonical absolute path.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function validateSshIdentity(value) {
  const identity = exactObject(
    value,
    SSH_IDENTITY_KEYS,
    'singleNodeRemoteStatus.sshIdentity',
  );
  const privateKeyPath = canonicalAbsolutePath(
    identity.privateKeyPath,
    'singleNodeRemoteStatus.sshIdentity.privateKeyPath',
  );
  const knownHostsPath = canonicalAbsolutePath(
    identity.knownHostsPath,
    'singleNodeRemoteStatus.sshIdentity.knownHostsPath',
  );
  if (privateKeyPath === knownHostsPath) {
    throw new TypeError(
      'singleNodeRemoteStatus SSH identity paths must differ.',
    );
  }
  return Object.freeze({
    privateKeyPath,
    publicKey: identity.publicKey,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    knownHostsPath,
  });
}

/**
 * @param {unknown} value
 * @param {string} address
 * @returns {Readonly<Record<string, string>>}
 */
function validateHostKey(value, address) {
  const host = exactObject(
    value,
    HOST_KEY_KEYS,
    'singleNodeRemoteStatus.hostKey',
  );
  if (
    host.address !== address ||
    host.algorithm !== 'ssh-ed25519' ||
    typeof host.fingerprint !== 'string' ||
    !SSH_FINGERPRINT_PATTERN.test(host.fingerprint)
  ) {
    throw new Error(
      'singleNodeRemoteStatus host key does not match durable authority.',
    );
  }
  return Object.freeze({
    address,
    algorithm: 'ssh-ed25519',
    fingerprint: host.fingerprint,
  });
}

/**
 * @param {unknown} value
 * @param {number} maximumBytes
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function decodeJsonObject(value, maximumBytes, valuePath) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (bytes === null || bytes.byteLength > maximumBytes) {
    throw new Error(`${valuePath} returned invalid bounded output.`);
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
 * @param {unknown} value
 * @returns {boolean}
 */
function succeeded(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    /** @type {Record<string, any>} */ (value).status === 'exited' &&
    /** @type {Record<string, any>} */ (value).exitCode === 0
  );
}

/**
 * Project only bounded release and health evidence from a status-V3 response.
 * The complete manager receipt intentionally stays on the guest.
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} desired
 * @returns {Readonly<{health: string, activeArtifactId: string|null, activeRevisionId: string|null, desiredMatches: boolean}>}
 */
function projectServiceStatus(value, desired) {
  const status = cloneBoundedJsonObject(
    value,
    MAX_SERVICE_STATUS_BYTES,
    'singleNodeRemoteStatus service status',
  );
  const expectedAppId = desired.intent.appId;
  const expectedUnit = `wharfie-${expectedAppId}.service`;
  if (
    status.schemaVersion !== 3 ||
    status.kind !== 'wharfie.service.status' ||
    status.appId !== expectedAppId ||
    status.unit !== expectedUnit ||
    !SERVICE_HEALTH_STATES.has(status.health)
  ) {
    throw new Error(
      'singleNodeRemoteStatus service status has an unsupported contract.',
    );
  }

  const convergence = exactObject(
    status.desiredConvergence,
    DESIRED_CONVERGENCE_KEYS,
    'singleNodeRemoteStatus service status.desiredConvergence',
  );
  const convergenceDesired = exactObject(
    convergence.desired,
    DESIRED_RELEASE_KEYS,
    'singleNodeRemoteStatus service status.desiredConvergence.desired',
  );
  assertArtifactId(
    convergenceDesired.artifactId,
    'singleNodeRemoteStatus service status.desiredConvergence.desired.artifactId',
  );
  assertApplicationRevisionId(
    convergenceDesired.revisionId,
    'singleNodeRemoteStatus service status.desiredConvergence.desired.revisionId',
  );
  if (
    convergence.schemaVersion !== 1 ||
    convergence.kind !== 'wharfie.service.desired-convergence' ||
    convergence.appId !== expectedAppId ||
    convergence.unit !== expectedUnit ||
    !DESIRED_CONVERGENCE_DISPOSITIONS.has(convergence.disposition) ||
    (convergence.disposition === 'authorized'
      ? !DESIRED_CONVERGENCE_BASES.has(convergence.basis)
      : convergence.basis !== null) ||
    convergenceDesired.artifactId !== desired.artifact.artifactId ||
    convergenceDesired.revisionId !== desired.artifact.revisionId
  ) {
    throw new Error(
      'singleNodeRemoteStatus desired convergence does not match durable authority.',
    );
  }

  if (
    status.installation === null ||
    typeof status.installation !== 'object' ||
    Array.isArray(status.installation)
  ) {
    throw new Error(
      'singleNodeRemoteStatus service installation evidence is invalid.',
    );
  }
  const installation = /** @type {Record<string, any>} */ (status.installation);
  /** @type {string|null} */
  let activeArtifactId = null;
  /** @type {string|null} */
  let activeRevisionId = null;
  if (installation.state === 'installed') {
    assertArtifactId(
      installation.activeArtifactId,
      'singleNodeRemoteStatus service status.installation.activeArtifactId',
    );
    assertApplicationRevisionId(
      installation.activeRevisionId,
      'singleNodeRemoteStatus service status.installation.activeRevisionId',
    );
    activeArtifactId = installation.activeArtifactId;
    activeRevisionId = installation.activeRevisionId;
  } else if (!['absent', 'uninstalled'].includes(installation.state)) {
    throw new Error(
      'singleNodeRemoteStatus service installation state is unsupported.',
    );
  }
  if (status.health === 'healthy' && activeArtifactId === null) {
    throw new Error(
      'singleNodeRemoteStatus healthy service lacks an active release.',
    );
  }
  if (
    status.health === 'healthy' &&
    (convergence.disposition !== 'authorized' ||
      convergence.basis !== 'durable-active')
  ) {
    throw new Error(
      'singleNodeRemoteStatus healthy service lacks durable active convergence authority.',
    );
  }
  const desiredMatches =
    activeArtifactId === desired.artifact.artifactId &&
    activeRevisionId === desired.artifact.revisionId;
  if (status.health === 'healthy' && desiredMatches) {
    validateSingleNodeRemoteServiceStatus(status, desired);
  }
  return Object.freeze({
    health: status.health,
    activeArtifactId,
    activeRevisionId,
    desiredMatches,
  });
}

/**
 * @param {'not-applicable'|'not-ready'|'unreachable'|'invalid'|'observed'} state
 * @param {string|null} address
 * @param {string|null} hostKeyFingerprint
 * @param {Readonly<Record<string, any>>|null} service
 * @returns {Readonly<Record<string, any>>}
 */
function observation(state, address, hostKeyFingerprint, service) {
  const result = deepFreeze(
    sortCanonicalJsonValue({
      state,
      address,
      hostKeyFingerprint,
      service,
    }),
  );
  assertManifestIsSecretFree(result, 'singleNodeRemoteStatus');
  return result;
}

/**
 * Create a structurally read-only remote status inspector.
 * @param {unknown} dependencies
 * @returns {Readonly<{inspect(value: unknown): Promise<Readonly<Record<string, any>>>}>}
 */
export function createSingleNodeRemoteStatusInspector(dependencies) {
  const ports = exactObject(
    dependencies,
    DEPENDENCY_KEYS,
    'singleNodeRemoteStatus dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof ports[key] !== 'function') {
      throw new TypeError(
        `singleNodeRemoteStatus dependency ${key} must be a function.`,
      );
    }
  }

  return Object.freeze({
    /**
     * Read the pinned bootstrap identity and exact application service status.
     * @param {unknown} value
     * @returns {Promise<Readonly<Record<string, any>>>}
     */
    async inspect(value) {
      const input = exactObject(value, INPUT_KEYS, 'singleNodeRemoteStatus');
      const journal = validateSingleNodeDeploymentJournal(
        input.journal,
        'singleNodeRemoteStatus.journal',
      );
      const dataRoot = canonicalAbsolutePath(
        input.dataRoot,
        'singleNodeRemoteStatus.dataRoot',
      );
      if (['destroying', 'destroyed'].includes(journal.phase)) {
        return observation('not-applicable', null, null, null);
      }
      if (journal.sshHost === null) {
        return observation(
          'not-ready',
          journal.sshHost?.address ?? null,
          journal.sshHost?.fingerprint ?? null,
          null,
        );
      }

      const address = journal.sshHost.address;
      const fingerprint = journal.sshHost.fingerprint;
      const remoteArtifactPath = getSingleNodeRemoteArtifactPaths(
        journal.desired,
        journal.incarnationId,
      ).remoteArtifactPath;
      /** @type {Readonly<Record<string, any>>} */
      let identity;
      /** @type {Readonly<Record<string, string>>} */
      let hostKey;
      try {
        identity = validateSshIdentity(
          await Reflect.apply(ports.readIdentity, undefined, [
            {
              dataRoot,
              deploymentInstanceId: journal.deploymentInstanceId,
              incarnationId: journal.incarnationId,
            },
          ]),
        );
        const cloudInit = createSingleNodeCloudInit({
          deploymentInstanceId: journal.deploymentInstanceId,
          incarnationId: journal.incarnationId,
          publicKey: identity.publicKey,
          publicKeyFingerprint: identity.publicKeyFingerprint,
        });
        const expectedDigest = journal.providerIntent.intent.cloudInitDigest;
        if (
          cloudInit.digest.algorithm !== expectedDigest.algorithm ||
          cloudInit.digest.value !== expectedDigest.value
        ) {
          return observation('invalid', address, fingerprint, null);
        }
        hostKey = validateHostKey(
          await Reflect.apply(ports.readHostKey, undefined, [
            { address, knownHostsPath: identity.knownHostsPath },
          ]),
          address,
        );
        if (hostKey.fingerprint !== fingerprint) {
          return observation('invalid', address, fingerprint, null);
        }
      } catch {
        return observation('invalid', address, fingerprint, null);
      }

      const transport = Reflect.apply(ports.createTransport, undefined, [
        {
          address,
          privateKeyPath: identity.privateKeyPath,
          knownHostsPath: identity.knownHostsPath,
        },
      ]);
      if (
        transport === null ||
        typeof transport !== 'object' ||
        Array.isArray(transport)
      ) {
        throw new TypeError(
          'singleNodeRemoteStatus transport must be an object.',
        );
      }
      const runDescriptor = Object.getOwnPropertyDescriptor(
        transport,
        'runRemoteArgv',
      );
      if (
        !runDescriptor ||
        !runDescriptor.enumerable ||
        !Object.hasOwn(runDescriptor, 'value') ||
        typeof runDescriptor.value !== 'function'
      ) {
        throw new TypeError(
          'singleNodeRemoteStatus transport must provide an own runRemoteArgv().',
        );
      }
      const runRemoteArgv = runDescriptor.value;

      /** @type {unknown} */
      let bootstrapOutcome;
      try {
        bootstrapOutcome = await Reflect.apply(runRemoteArgv, undefined, [
          {
            argv: ['/usr/bin/cat', '--', SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH],
            stdin: null,
            timeoutMilliseconds: 20_000,
            maximumStdoutBytes: MAX_BOOTSTRAP_IDENTITY_BYTES,
            maximumStderrBytes: 8 * 1024,
          },
        ]);
      } catch {
        return observation('unreachable', address, fingerprint, null);
      }
      if (!succeeded(bootstrapOutcome)) {
        return observation('unreachable', address, fingerprint, null);
      }
      try {
        const actualBootstrap = decodeJsonObject(
          /** @type {Record<string, any>} */ (bootstrapOutcome).stdout,
          MAX_BOOTSTRAP_IDENTITY_BYTES,
          'singleNodeRemoteStatus bootstrap identity',
        );
        const expectedBootstrap = createSingleNodeCloudInit({
          deploymentInstanceId: journal.deploymentInstanceId,
          incarnationId: journal.incarnationId,
          publicKey: identity.publicKey,
          publicKeyFingerprint: identity.publicKeyFingerprint,
        }).bootstrapIdentity;
        if (
          JSON.stringify(sortCanonicalJsonValue(actualBootstrap)) !==
          JSON.stringify(sortCanonicalJsonValue(expectedBootstrap))
        ) {
          return observation('invalid', address, fingerprint, null);
        }
      } catch {
        return observation('invalid', address, fingerprint, null);
      }

      /** @type {unknown} */
      let serviceOutcome;
      try {
        serviceOutcome = await Reflect.apply(runRemoteArgv, undefined, [
          {
            argv: [
              remoteArtifactPath,
              'wharfie',
              'service',
              'status',
              '--json',
            ],
            stdin: null,
            timeoutMilliseconds: 2 * 60 * 1000,
            maximumStdoutBytes: MAX_SERVICE_STATUS_BYTES,
            maximumStderrBytes: 16 * 1024,
          },
        ]);
      } catch {
        return observation('unreachable', address, fingerprint, null);
      }
      if (!succeeded(serviceOutcome)) {
        return observation('unreachable', address, fingerprint, null);
      }
      try {
        const service = projectServiceStatus(
          decodeJsonObject(
            /** @type {Record<string, any>} */ (serviceOutcome).stdout,
            MAX_SERVICE_STATUS_BYTES,
            'singleNodeRemoteStatus service status',
          ),
          journal.desired,
        );
        return observation('observed', address, fingerprint, service);
      } catch {
        return observation('invalid', address, fingerprint, null);
      }
    },
  });
}

/**
 * Create the production read-only remote inspector.
 * @returns {ReturnType<typeof createSingleNodeRemoteStatusInspector>}
 */
export function createProductionSingleNodeRemoteStatusInspector() {
  const runProcess = createBoundedProcessRunner();
  return createSingleNodeRemoteStatusInspector({
    readIdentity: async (/** @type {Record<string, any>} */ value) =>
      await createDeploymentSshIdentityStore({
        root: path.join(value.dataRoot, 'single-node-deployment-ssh', 'v1'),
        runProcess,
      }).readIdentity({
        deploymentInstanceId: value.deploymentInstanceId,
        incarnationId: value.incarnationId,
      }),
    readHostKey: readDeploymentSshHostKey,
    createTransport: (/** @type {Record<string, any>} */ value) =>
      createDeploymentOpenSshTransport({
        address: value.address,
        privateKeyPath: value.privateKeyPath,
        knownHostsPath: value.knownHostsPath,
        runProcess,
      }),
  });
}

const productionInspector = createProductionSingleNodeRemoteStatusInspector();

/**
 * Inspect one existing remote deployment without modifying local or guest
 * state.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function inspectSingleNodeRemoteStatus(value) {
  return await Reflect.apply(productionInspector.inspect, undefined, [value]);
}

export default {
  createProductionSingleNodeRemoteStatusInspector,
  createSingleNodeRemoteStatusInspector,
  inspectSingleNodeRemoteStatus,
};
