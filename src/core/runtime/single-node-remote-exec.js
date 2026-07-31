/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import path from 'node:path';

import { createBoundedProcessRunner } from './bounded-process.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES,
  DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS,
  createDeploymentOpenSshTransport,
  encodePosixArgv,
} from './deployment-openssh-transport.js';
import { readDeploymentSshHostKey } from './deployment-ssh-host-key.js';
import { createDeploymentSshIdentityStore } from './deployment-ssh-identity.js';
import { cloneBoundedJsonObject } from './json-value.js';
import {
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  createSingleNodeCloudInit,
} from './single-node-cloud-init.js';
import { validateSingleNodeDeploymentJournal } from './single-node-deployment-journal.js';
import { validateSingleNodeRemoteServiceStatus } from './single-node-remote-activation.js';

export const SINGLE_NODE_REMOTE_EXEC_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;
export const SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES =
  DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES;
export const SINGLE_NODE_REMOTE_EXEC_MAX_STDERR_BYTES =
  DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES;

const MAX_BOOTSTRAP_IDENTITY_BYTES = 16 * 1024;
const MAX_SERVICE_STATUS_BYTES = 256 * 1024;
const INPUT_KEYS = new Set(['journal', 'dataRoot', 'argv']);
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
const PROCESS_OUTCOME_KEYS = new Set([
  'status',
  'exitCode',
  'signal',
  'timedOut',
  'stdout',
  'stderr',
]);
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/u;

/**
 * Snapshot one exact plain object without invoking accessors.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} expectedKeys - Exact fields.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, any>} - Independent shallow snapshot.
 */
function snapshotExactObject(value, expectedKeys, valuePath) {
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
    keys.length !== expectedKeys.size ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !expectedKeys.has(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  /** @type {Record<string, any>} */
  const result = {};
  for (const key of expectedKeys) {
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
 * Require one bounded canonical absolute local path.
 * @param {unknown} value - Candidate path.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Validated path.
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
 * Snapshot application arguments without invoking array accessors.
 * The executable is never accepted from this boundary.
 * @param {unknown} value - Candidate forwarded argv.
 * @returns {Readonly<string[]>} - Immutable argument snapshot.
 */
function applicationArgv(value) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS - 1
  ) {
    throw new TypeError(
      `singleNodeRemoteExec.argv must contain at most ${DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS - 1} application arguments.`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= value.length),
    )
  ) {
    throw new TypeError(
      'singleNodeRemoteExec.argv must be one dense exact array.',
    );
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.includes('\0')
    ) {
      throw new TypeError(
        `singleNodeRemoteExec.argv[${index}] must be a string without NUL.`,
      );
    }
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

/**
 * Validate the local private identity projection.
 * Public-key validity and fingerprint agreement are checked by cloud-init
 * construction before any transport is opened.
 * @param {unknown} value - Candidate identity.
 * @returns {Readonly<Record<string, any>>} - Exact identity projection.
 */
function validateSshIdentity(value) {
  const identity = snapshotExactObject(
    value,
    SSH_IDENTITY_KEYS,
    'singleNodeRemoteExec.sshIdentity',
  );
  const privateKeyPath = canonicalAbsolutePath(
    identity.privateKeyPath,
    'singleNodeRemoteExec.sshIdentity.privateKeyPath',
  );
  const knownHostsPath = canonicalAbsolutePath(
    identity.knownHostsPath,
    'singleNodeRemoteExec.sshIdentity.knownHostsPath',
  );
  if (privateKeyPath === knownHostsPath) {
    throw new TypeError('singleNodeRemoteExec SSH identity paths must differ.');
  }
  return Object.freeze({
    privateKeyPath,
    publicKey: identity.publicKey,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    knownHostsPath,
  });
}

/**
 * Validate a host-key record against the provider-observed address.
 * @param {unknown} value - Candidate host key.
 * @param {string} address - Exact durable address.
 * @returns {Readonly<Record<string, string>>} - Exact host-key projection.
 */
function validateHostKey(value, address) {
  const host = snapshotExactObject(
    value,
    HOST_KEY_KEYS,
    'singleNodeRemoteExec.hostKey',
  );
  if (
    host.address !== address ||
    host.algorithm !== 'ssh-ed25519' ||
    typeof host.fingerprint !== 'string' ||
    !SSH_FINGERPRINT_PATTERN.test(host.fingerprint)
  ) {
    throw new Error(
      'Remote execution host key does not match durable authority.',
    );
  }
  return Object.freeze({
    address,
    algorithm: 'ssh-ed25519',
    fingerprint: host.fingerprint,
  });
}

/**
 * Require one exact bounded process outcome while preserving its identity.
 * @param {unknown} value - Candidate outcome.
 * @param {number} maximumStdoutBytes - Applied stdout bound.
 * @param {number} maximumStderrBytes - Applied stderr bound.
 * @param {string} valuePath - Safe boundary label.
 * @returns {import('./bounded-process.js').BoundedProcessOutcome} - Same exact outcome.
 */
function validateProcessOutcome(
  value,
  maximumStdoutBytes,
  maximumStderrBytes,
  valuePath,
) {
  const outcome = snapshotExactObject(value, PROCESS_OUTCOME_KEYS, valuePath);
  if (
    !['exited', 'ambiguous'].includes(outcome.status) ||
    (outcome.exitCode !== null &&
      (typeof outcome.exitCode !== 'number' ||
        !Number.isSafeInteger(outcome.exitCode) ||
        outcome.exitCode < 0 ||
        outcome.exitCode > 255)) ||
    (outcome.signal !== null && typeof outcome.signal !== 'string') ||
    typeof outcome.timedOut !== 'boolean' ||
    !Buffer.isBuffer(outcome.stdout) ||
    outcome.stdout.byteLength > maximumStdoutBytes ||
    !Buffer.isBuffer(outcome.stderr) ||
    outcome.stderr.byteLength > maximumStderrBytes ||
    (outcome.status === 'exited' && outcome.exitCode === null)
  ) {
    throw new Error(`${valuePath} returned an invalid bounded outcome.`);
  }
  return /** @type {import('./bounded-process.js').BoundedProcessOutcome} */ (
    value
  );
}

/**
 * @param {import('./bounded-process.js').BoundedProcessOutcome} outcome - Validated outcome.
 * @returns {boolean} - Whether the command exited successfully.
 */
function succeeded(outcome) {
  return outcome.status === 'exited' && outcome.exitCode === 0;
}

/**
 * Decode one bounded UTF-8 JSON object.
 * @param {Buffer} bytes - Bounded process output.
 * @param {number} maximumBytes - Exact response bound.
 * @param {string} valuePath - Safe boundary label.
 * @returns {Record<string, any>} - Independent bounded JSON object.
 */
function decodeJsonObject(bytes, maximumBytes, valuePath) {
  if (bytes.byteLength > maximumBytes) {
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
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} - Whether canonical JSON is identical.
 */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * Extract an own transport method without accepting inherited authority.
 * @param {unknown} value - Candidate transport.
 * @returns {(request: unknown) => Promise<unknown>} - Unbound transport method.
 */
function transportRunner(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('singleNodeRemoteExec transport must be an object.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'runRemoteArgv');
  if (
    !descriptor ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, 'value') ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(
      'singleNodeRemoteExec transport must provide an own runRemoteArgv().',
    );
  }
  return descriptor.value;
}

/**
 * Create a provider-free, journal-bound remote application executor.
 * @param {unknown} dependencies - Exact local identity and SSH ports.
 * @returns {Readonly<{execute(value: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}>} - Strict executor.
 */
export function createSingleNodeRemoteExecutor(dependencies) {
  const ports = snapshotExactObject(
    dependencies,
    DEPENDENCY_KEYS,
    'singleNodeRemoteExec dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof ports[key] !== 'function') {
      throw new TypeError(
        `singleNodeRemoteExec dependency ${key} must be a function.`,
      );
    }
  }

  return Object.freeze({
    /**
     * Re-prove an already-active deployment, then execute its exact artifact
     * with application arguments only.
     * @param {unknown} value - Existing journal, data root, and app argv.
     * @returns {Promise<import('./bounded-process.js').BoundedProcessOutcome>} - Exact bounded application outcome.
     */
    async execute(value) {
      const input = snapshotExactObject(
        value,
        INPUT_KEYS,
        'singleNodeRemoteExec',
      );
      const journal = validateSingleNodeDeploymentJournal(
        input.journal,
        'singleNodeRemoteExec.journal',
      );
      if (
        journal.phase !== 'active' ||
        journal.sshHost === null ||
        journal.artifact === null ||
        journal.activation === null
      ) {
        throw new Error(
          'Remote application execution requires an active deployment with exact activation evidence.',
        );
      }
      const dataRoot = canonicalAbsolutePath(
        input.dataRoot,
        'singleNodeRemoteExec.dataRoot',
      );
      const argv = applicationArgv(input.argv);
      const remoteArtifactPath = journal.activation.artifact.remotePath;

      // Validate the complete projected command before opening local identity.
      encodePosixArgv([remoteArtifactPath, ...argv]);

      /** @type {Readonly<Record<string, any>>} */
      let identity;
      /** @type {Readonly<Record<string, any>>} */
      let expectedCloudInit;
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
        expectedCloudInit = createSingleNodeCloudInit({
          deploymentInstanceId: journal.deploymentInstanceId,
          incarnationId: journal.incarnationId,
          publicKey: identity.publicKey,
          publicKeyFingerprint: identity.publicKeyFingerprint,
        });
      } catch {
        throw new Error(
          'Remote application execution could not authenticate its local SSH identity.',
        );
      }
      const expectedDigest = journal.providerIntent.intent.cloudInitDigest;
      if (
        expectedCloudInit.digest.algorithm !== expectedDigest.algorithm ||
        expectedCloudInit.digest.value !== expectedDigest.value
      ) {
        throw new Error(
          'Remote application execution SSH identity does not match cloud-init authority.',
        );
      }

      const address = journal.sshHost.address;
      let hostKey;
      try {
        hostKey = validateHostKey(
          await Reflect.apply(ports.readHostKey, undefined, [
            { address, knownHostsPath: identity.knownHostsPath },
          ]),
          address,
        );
      } catch {
        throw new Error(
          'Remote application execution could not authenticate the pinned SSH host key.',
        );
      }
      if (hostKey.fingerprint !== journal.sshHost.fingerprint) {
        throw new Error(
          'Remote application execution SSH host key conflicts with durable authority.',
        );
      }

      const runRemoteArgv = transportRunner(
        Reflect.apply(ports.createTransport, undefined, [
          {
            address,
            privateKeyPath: identity.privateKeyPath,
            knownHostsPath: identity.knownHostsPath,
          },
        ]),
      );

      let bootstrapOutcome;
      try {
        bootstrapOutcome = validateProcessOutcome(
          await Reflect.apply(runRemoteArgv, undefined, [
            {
              argv: ['/usr/bin/cat', '--', SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH],
              stdin: null,
              timeoutMilliseconds: 20_000,
              maximumStdoutBytes: MAX_BOOTSTRAP_IDENTITY_BYTES,
              maximumStderrBytes: 8 * 1024,
            },
          ]),
          MAX_BOOTSTRAP_IDENTITY_BYTES,
          8 * 1024,
          'singleNodeRemoteExec bootstrap identity',
        );
      } catch {
        throw new Error(
          'Remote application execution could not verify bootstrap identity.',
        );
      }
      if (!succeeded(bootstrapOutcome)) {
        throw new Error(
          'Remote application execution could not verify bootstrap identity.',
        );
      }
      let actualBootstrap;
      try {
        actualBootstrap = decodeJsonObject(
          bootstrapOutcome.stdout,
          MAX_BOOTSTRAP_IDENTITY_BYTES,
          'singleNodeRemoteExec bootstrap identity',
        );
      } catch {
        throw new Error(
          'Remote application execution received invalid bootstrap identity evidence.',
        );
      }
      if (!sameJson(actualBootstrap, expectedCloudInit.bootstrapIdentity)) {
        throw new Error(
          'Remote application execution bootstrap identity conflicts with durable authority.',
        );
      }

      let serviceOutcome;
      try {
        serviceOutcome = validateProcessOutcome(
          await Reflect.apply(runRemoteArgv, undefined, [
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
          ]),
          MAX_SERVICE_STATUS_BYTES,
          16 * 1024,
          'singleNodeRemoteExec service status',
        );
      } catch {
        throw new Error(
          'Remote application execution could not verify durable service status.',
        );
      }
      if (!succeeded(serviceOutcome)) {
        throw new Error(
          'Remote application execution could not verify durable service status.',
        );
      }
      try {
        validateSingleNodeRemoteServiceStatus(
          decodeJsonObject(
            serviceOutcome.stdout,
            MAX_SERVICE_STATUS_BYTES,
            'singleNodeRemoteExec service status',
          ),
          journal.desired,
        );
      } catch {
        throw new Error(
          'Remote application execution service is not the exact healthy active release.',
        );
      }

      try {
        return validateProcessOutcome(
          await Reflect.apply(runRemoteArgv, undefined, [
            {
              argv: [remoteArtifactPath, ...argv],
              stdin: null,
              timeoutMilliseconds: SINGLE_NODE_REMOTE_EXEC_TIMEOUT_MILLISECONDS,
              maximumStdoutBytes: SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES,
              maximumStderrBytes: SINGLE_NODE_REMOTE_EXEC_MAX_STDERR_BYTES,
            },
          ]),
          SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES,
          SINGLE_NODE_REMOTE_EXEC_MAX_STDERR_BYTES,
          'singleNodeRemoteExec application',
        );
      } catch {
        throw new Error(
          'Remote application execution failed before a bounded outcome was available.',
        );
      }
    },
  });
}

/**
 * Create the production journal-bound remote executor.
 * @returns {ReturnType<typeof createSingleNodeRemoteExecutor>} - Production executor.
 */
export function createProductionSingleNodeRemoteExecutor() {
  const runProcess = createBoundedProcessRunner();
  return createSingleNodeRemoteExecutor({
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

const productionExecutor = createProductionSingleNodeRemoteExecutor();

/**
 * Execute one application command against an existing active deployment.
 * @param {unknown} value - Existing journal, data root, and app argv.
 * @returns {Promise<import('./bounded-process.js').BoundedProcessOutcome>} - Exact bounded application outcome.
 */
export async function executeSingleNodeRemoteApplication(value) {
  return await Reflect.apply(productionExecutor.execute, undefined, [value]);
}

export default {
  SINGLE_NODE_REMOTE_EXEC_MAX_STDERR_BYTES,
  SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES,
  SINGLE_NODE_REMOTE_EXEC_TIMEOUT_MILLISECONDS,
  createProductionSingleNodeRemoteExecutor,
  createSingleNodeRemoteExecutor,
  executeSingleNodeRemoteApplication,
};
