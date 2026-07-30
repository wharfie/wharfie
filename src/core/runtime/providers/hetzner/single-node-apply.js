/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow composition root keeps its injected port protocol beside the implementation. */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { createBoundedProcessRunner } from '../../bounded-process.js';
import { ensureDeploymentSshHostKey } from '../../deployment-ssh-host-key.js';
import { createDeploymentSshIdentityStore } from '../../deployment-ssh-identity.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS,
  SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS,
  createSingleNodeRemoteActivator,
  validateSingleNodeRemoteActivationEvidence,
} from '../../single-node-remote-activation.js';
import { createSingleNodeCloudInit } from '../../single-node-cloud-init.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentProvisioningRecoveryState,
  prepareSingleNodeDeploymentMutation,
  rejectSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  validateSingleNodeDeploymentJournal,
} from '../../single-node-deployment-journal.js';
import {
  createSingleNodeDeploymentDesired,
  validateSingleNodeDeploymentDesired,
} from '../../single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../../single-node-deployment-identity.js';
import { acquireSingleNodeDeploymentOperationLock } from '../../single-node-deployment-operation-lock.js';
import { createHetznerActionWaiter } from './action-waiter.js';
import { createHetznerApiClient } from './api-client.js';
import {
  createHetznerCredentialBindingStore,
  validateHetznerCredentialBindingEvidence,
} from './credential-binding.js';
import { getHetznerDeploymentLabelSelector } from './ownership.js';
import {
  convergeHetznerSingleNodeProvisioning,
  createHetznerSingleNodeProvisioningIntent,
  validateHetznerProvisionedResourceRecord,
} from './single-node-provisioning.js';
import {
  resolveHetznerSingleNodePlan,
  validateHetznerSingleNodePlan,
} from './single-node-plan.js';

export const HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION = 1;
export const HETZNER_SINGLE_NODE_APPLY_RESULT_KIND =
  'hetznerSingleNodeApplyResult';

const APPLY_COMMON_KEYS = new Set([
  'revision',
  'artifactRecord',
  'observation',
  'dataRoot',
]);
const DEPENDENCY_KEYS = new Set([
  'acquireOperationLock',
  'readToken',
  'bindCredential',
  'createApi',
  'resolvePlan',
  'createJournalStore',
  'ensureSshIdentity',
  'waitForAction',
  'convergeProvisioning',
  'enrollSshHost',
  'activate',
  'randomBytes',
  'wait',
]);
const SSH_IDENTITY_KEYS = new Set([
  'privateKeyPath',
  'publicKey',
  'publicKeyFingerprint',
  'knownHostsPath',
]);
const HELD_SOURCE_KEYS = new Set([
  'observation',
  'createReadStream',
  'verifyUnchanged',
  'close',
]);
const PROVISIONING_RESULT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  'planId',
  'providerSpecId',
  'desiredRevisionId',
  'deploymentInstanceId',
  'incarnationId',
  'resources',
  'publicIpv4',
  'status',
]);
const PROVISIONING_RESOURCE_KEYS = new Set([
  'firewallId',
  'primaryIpId',
  'serverId',
]);
const SSH_HOST_KEYS = new Set(['address', 'algorithm', 'fingerprint']);
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/u;
const RECOVERY_RESOURCE_READS = Object.freeze([
  ['server', 'getServer'],
  ['primaryIp', 'getPrimaryIp'],
  ['firewall', 'getFirewall'],
]);

/**
 * @param {unknown} value - Candidate plain object.
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * Snapshot only enumerable own data properties with an exact key set.
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function snapshotExactObject(value, expected, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an exact object.`);
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
 * @param {string} valuePath
 * @returns {number}
 */
function providerId(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive provider ID.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function validateSshIdentity(value) {
  const identity = snapshotExactObject(
    value,
    SSH_IDENTITY_KEYS,
    'hetznerSingleNodeApply.sshIdentity',
  );
  return Object.freeze({
    privateKeyPath: canonicalAbsolutePath(
      identity.privateKeyPath,
      'hetznerSingleNodeApply.sshIdentity.privateKeyPath',
    ),
    publicKey: identity.publicKey,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    knownHostsPath: canonicalAbsolutePath(
      identity.knownHostsPath,
      'hetznerSingleNodeApply.sshIdentity.knownHostsPath',
    ),
  });
}

/**
 * Snapshot a held source behind an idempotent close guard. This lets apply
 * close a source that was never needed while the activator may also close a
 * source it consumed, without releasing the underlying bytes twice.
 * @param {Record<string, any>} source - Already-inspected held source.
 * @param {Record<string, any>} target - Original method receiver.
 * @returns {Readonly<Record<string, any>>}
 */
function guardHeldSource(source, target) {
  const createReadStream = source.createReadStream.bind(target);
  const verifyUnchanged = source.verifyUnchanged.bind(target);
  const closeSource = source.close.bind(target);
  /** @type {Promise<unknown>|undefined} */
  let closePromise;
  return Object.freeze({
    observation: source.observation,
    createReadStream,
    verifyUnchanged,
    close() {
      if (closePromise === undefined) {
        closePromise = Promise.resolve().then(() => closeSource());
      }
      return closePromise;
    },
  });
}

/**
 * Validate one exact apply request and bind either local-path or held-source
 * bytes to the same canonical desired state.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function validateApplyInput(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'hetznerSingleNodeApply input must be an exact object.',
    );
  }
  const object = /** @type {Record<string, any>} */ (value);
  const hasIntent = Object.hasOwn(object, 'intent');
  const hasDesired = Object.hasOwn(object, 'desired');
  const hasArtifactPath = Object.hasOwn(object, 'artifactPath');
  const hasArtifactSource = Object.hasOwn(object, 'artifactSource');
  if (hasIntent === hasDesired || hasArtifactPath === hasArtifactSource) {
    throw new TypeError(
      'hetznerSingleNodeApply requires exactly one intent or desired and exactly one artifactPath or artifactSource.',
    );
  }
  const expected = new Set([
    ...APPLY_COMMON_KEYS,
    hasIntent ? 'intent' : 'desired',
    hasArtifactPath ? 'artifactPath' : 'artifactSource',
  ]);
  const input = snapshotExactObject(value, expected, 'hetznerSingleNodeApply');
  const suppliedDesired = hasDesired
    ? validateSingleNodeDeploymentDesired(
        input.desired,
        'hetznerSingleNodeApply.desired',
      )
    : null;
  const intent = hasIntent ? input.intent : suppliedDesired?.intent;
  const observedDesired = createSingleNodeDeploymentDesired({
    intent,
    revision: input.revision,
    artifactRecord: input.artifactRecord,
    observation: input.observation,
  });
  if (
    suppliedDesired !== null &&
    JSON.stringify(suppliedDesired) !== JSON.stringify(observedDesired)
  ) {
    throw new Error(
      'hetznerSingleNodeApply desired state does not match the held artifact authority.',
    );
  }
  if (observedDesired.intent.provider.kind !== 'hetzner') {
    throw new TypeError(
      'hetznerSingleNodeApply desired state must target Hetzner.',
    );
  }
  const dataRoot = canonicalAbsolutePath(
    input.dataRoot,
    'hetznerSingleNodeApply.dataRoot',
  );
  if (hasArtifactPath) {
    return Object.freeze({
      desired: observedDesired,
      dataRoot,
      artifactPath: canonicalAbsolutePath(
        input.artifactPath,
        'hetznerSingleNodeApply.artifactPath',
      ),
    });
  }
  const source = snapshotExactObject(
    input.artifactSource,
    HELD_SOURCE_KEYS,
    'hetznerSingleNodeApply.artifactSource',
  );
  for (const name of ['createReadStream', 'verifyUnchanged', 'close']) {
    if (typeof source[name] !== 'function') {
      throw new TypeError(
        `hetznerSingleNodeApply.artifactSource.${name} must be a function.`,
      );
    }
  }
  const sourceDesired = createSingleNodeDeploymentDesired({
    intent: observedDesired.intent,
    revision: input.revision,
    artifactRecord: input.artifactRecord,
    observation: source.observation,
  });
  if (sourceDesired.desiredRevisionId !== observedDesired.desiredRevisionId) {
    throw new Error(
      'hetznerSingleNodeApply artifactSource does not match its held observation.',
    );
  }
  const artifactSource = guardHeldSource(
    source,
    /** @type {Record<string, any>} */ (input.artifactSource),
  );
  return Object.freeze({
    desired: observedDesired,
    dataRoot,
    artifactSource,
  });
}

/**
 * @param {unknown} value
 * @param {number} expectedLength
 * @param {string} valuePath
 * @returns {Buffer}
 */
function snapshotEntropy(value, expectedLength, valuePath) {
  if (!(value instanceof Uint8Array) || value.byteLength !== expectedLength) {
    throw new TypeError(
      `${valuePath} must return exactly ${expectedLength} bytes.`,
    );
  }
  return Buffer.from(value);
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @returns {Readonly<Record<string, any>>}
 */
function validateProvisioningResult(value, intent) {
  const result = snapshotExactObject(
    value,
    PROVISIONING_RESULT_KEYS,
    'hetznerSingleNodeApply.provisioningResult',
  );
  const resources = snapshotExactObject(
    result.resources,
    PROVISIONING_RESOURCE_KEYS,
    'hetznerSingleNodeApply.provisioningResult.resources',
  );
  if (
    result.schemaVersion !== 1 ||
    result.kind !== 'hetznerSingleNodeProvisioningResult' ||
    result.status !== 'provisioned' ||
    result.provisioningIntentId !== intent.provisioningIntentId ||
    result.planId !== intent.plan.planId ||
    result.providerSpecId !== intent.plan.providerSpec.providerSpecId ||
    result.desiredRevisionId !== intent.plan.desired.desiredRevisionId ||
    result.deploymentInstanceId !== intent.plan.deploymentInstanceId ||
    result.incarnationId !== intent.incarnationId
  ) {
    throw new Error(
      'hetznerSingleNodeApply provisioning result does not match its durable intent.',
    );
  }
  if (
    typeof result.publicIpv4 !== 'string' ||
    !isIPv4(result.publicIpv4) ||
    result.publicIpv4 !== result.publicIpv4.split('.').map(Number).join('.')
  ) {
    throw new TypeError(
      'hetznerSingleNodeApply provisioning result has an invalid public IPv4 address.',
    );
  }
  return Object.freeze({
    ...result,
    resources: Object.freeze({
      firewallId: providerId(
        resources.firewallId,
        'hetznerSingleNodeApply.provisioningResult.resources.firewallId',
      ),
      primaryIpId: providerId(
        resources.primaryIpId,
        'hetznerSingleNodeApply.provisioningResult.resources.primaryIpId',
      ),
      serverId: providerId(
        resources.serverId,
        'hetznerSingleNodeApply.provisioningResult.resources.serverId',
      ),
    }),
  });
}

/**
 * @param {unknown} value
 * @param {string} address
 * @returns {Readonly<{address: string, algorithm: 'ssh-ed25519', fingerprint: string}>}
 */
function validateSshHost(value, address) {
  const host = snapshotExactObject(
    value,
    SSH_HOST_KEYS,
    'hetznerSingleNodeApply.sshHost',
  );
  if (
    host.address !== address ||
    host.algorithm !== 'ssh-ed25519' ||
    typeof host.fingerprint !== 'string' ||
    !SSH_FINGERPRINT_PATTERN.test(host.fingerprint)
  ) {
    throw new Error(
      'hetznerSingleNodeApply SSH host key does not match its provider address.',
    );
  }
  return Object.freeze({
    address,
    algorithm: /** @type {const} */ ('ssh-ed25519'),
    fingerprint: host.fingerprint,
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function validateDependencies(value) {
  const dependencies = snapshotExactObject(
    value,
    DEPENDENCY_KEYS,
    'hetznerSingleNodeApply dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `hetznerSingleNodeApply dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * Authenticate recovery credentials through durable provider identity, without
 * consulting mutable catalog selection and before publishing a first binding.
 * A 404 is authenticated exact-ID absence and is left for convergence to
 * classify as drift.
 * @param {Record<string, any>} api
 * @param {Readonly<Record<string, any>>} journal
 * @returns {Promise<void>}
 */
async function authenticateRecoveryApi(api, journal) {
  for (const [role, methodName] of RECOVERY_RESOURCE_READS) {
    const resource = journal.resources.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === role,
    );
    if (resource === undefined) continue;
    const method = api[methodName];
    if (typeof method !== 'function') {
      throw new TypeError(
        `hetznerSingleNodeApply provider API must provide ${methodName}().`,
      );
    }
    try {
      await Reflect.apply(method, api, [resource.providerResourceId]);
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        /** @type {Record<string, any>} */ (error).status === 404
      ) {
        return;
      }
      throw error;
    }
    return;
  }

  if (typeof api.listServers !== 'function') {
    throw new TypeError(
      'hetznerSingleNodeApply provider API must provide listServers().',
    );
  }
  const observations = await Reflect.apply(api.listServers, api, [
    {
      labelSelector: getHetznerDeploymentLabelSelector(
        journal.deploymentInstanceId,
      ),
    },
  ]);
  if (!Array.isArray(observations)) {
    throw new TypeError(
      'hetznerSingleNodeApply recovery authentication returned invalid inventory.',
    );
  }
}

/**
 * Require convergence output to reproduce every durable provider identity and
 * address before later phases may use it.
 * @param {Readonly<Record<string, any>>} result
 * @param {Readonly<Record<string, any>>} journal
 * @returns {void}
 */
function assertProvisioningResultMatchesJournal(result, journal) {
  /** @type {Record<string, number>} */
  const ids = {
    firewall: result.resources.firewallId,
    primaryIp: result.resources.primaryIpId,
    server: result.resources.serverId,
  };
  for (const role of ['firewall', 'primaryIp', 'server']) {
    const resource = journal.resources.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === role,
    );
    if (
      resource?.state !== 'present' ||
      resource.providerResourceId !== ids[role] ||
      (role !== 'firewall' && resource.publicIpv4 !== result.publicIpv4)
    ) {
      throw new Error(
        'hetznerSingleNodeApply provider verification conflicts with durable resource authority.',
      );
    }
  }
}

/**
 * Create the thin Hetzner apply composition root. All external effects are
 * injected so recovery ordering can be proved without provider or subprocess
 * access.
 * @param {unknown} dependencies
 * @returns {Readonly<{apply(value: unknown): Promise<Readonly<Record<string, any>>>}>}
 */
export function createHetznerSingleNodeApplyCoordinator(dependencies) {
  const ports = validateDependencies(dependencies);

  return Object.freeze({
    /**
     * Apply or recover one exact single-node deployment.
     * @param {unknown} value
     * @returns {Promise<Readonly<Record<string, any>>>}
     */
    async apply(value) {
      const input = validateApplyInput(value);
      const desired = input.desired;
      /** @type {undefined|(() => Promise<void>)} */
      let release;
      let succeeded = false;
      /** @type {unknown} */
      let operationError;
      /** @type {Readonly<Record<string, any>>|undefined} */
      let result;

      try {
        release = await ports.acquireOperationLock(
          desired.deploymentInstanceId,
        );
        if (typeof release !== 'function') {
          throw new TypeError(
            'hetznerSingleNodeApply operation lock must return release().',
          );
        }
        const journalStore = ports.createJournalStore({
          appId: desired.intent.appId,
          deploymentInstanceId: desired.deploymentInstanceId,
          dataRoot: input.dataRoot,
        });
        if (
          journalStore === null ||
          typeof journalStore !== 'object' ||
          typeof journalStore.prepareStorage !== 'function' ||
          typeof journalStore.read !== 'function' ||
          typeof journalStore.initialize !== 'function' ||
          typeof journalStore.commit !== 'function'
        ) {
          throw new TypeError(
            'hetznerSingleNodeApply journal store is invalid.',
          );
        }
        await journalStore.prepareStorage();
        let journalValue = await journalStore.read();
        /** @type {Readonly<Record<string, any>>|null} */
        let journal =
          journalValue === null
            ? null
            : validateSingleNodeDeploymentJournal(journalValue);
        if (
          journal !== null &&
          journal.desired.desiredRevisionId !== desired.desiredRevisionId
        ) {
          throw new Error(
            'hetznerSingleNodeApply durable desired state conflicts with this apply.',
          );
        }
        if (
          journal !== null &&
          ['destroying', 'destroyed'].includes(journal.phase)
        ) {
          throw new Error(
            'hetznerSingleNodeApply cannot resume a destroyed deployment incarnation.',
          );
        }

        const token = await ports.readToken();
        if (
          typeof token !== 'string' ||
          token.length === 0 ||
          token.trim() !== token
        ) {
          throw new Error(
            'Hetzner apply requires ambient HCLOUD_TOKEN authority.',
          );
        }
        const api = ports.createApi({ token });
        if (api === null || typeof api !== 'object') {
          throw new TypeError(
            'hetznerSingleNodeApply provider API is invalid.',
          );
        }

        /** @type {Readonly<Record<string, any>>|null} */
        let observedPlan = null;
        if (journal === null) {
          observedPlan = validateHetznerSingleNodePlan(
            await ports.resolvePlan({ desired, api }),
          );
          if (
            observedPlan.deploymentInstanceId !==
              desired.deploymentInstanceId ||
            observedPlan.desired.desiredRevisionId !== desired.desiredRevisionId
          ) {
            throw new Error(
              'hetznerSingleNodeApply observed plan does not match its exact desired state.',
            );
          }
          if (observedPlan.status !== 'actionable') {
            throw new Error(
              'hetznerSingleNodeApply found provider resources without durable local authority.',
            );
          }
        } else {
          await authenticateRecoveryApi(
            /** @type {Record<string, any>} */ (api),
            journal,
          );
        }

        const binding = validateHetznerCredentialBindingEvidence(
          await ports.bindCredential({
            dataRoot: input.dataRoot,
            deploymentInstanceId: desired.deploymentInstanceId,
            token,
          }),
        );
        if (binding.deploymentInstanceId !== desired.deploymentInstanceId) {
          throw new Error(
            'hetznerSingleNodeApply credential binding does not match the deployment.',
          );
        }

        const incarnationId =
          journal === null
            ? createSingleNodeDeploymentIncarnationId(
                snapshotEntropy(
                  ports.randomBytes(32),
                  32,
                  'hetznerSingleNodeApply incarnation entropy',
                ),
              )
            : journal.incarnationId;
        const sshIdentity = validateSshIdentity(
          await ports.ensureSshIdentity({
            dataRoot: input.dataRoot,
            deploymentInstanceId: desired.deploymentInstanceId,
            incarnationId,
          }),
        );
        const cloudInit = createSingleNodeCloudInit({
          deploymentInstanceId: desired.deploymentInstanceId,
          incarnationId,
          publicKey: sshIdentity.publicKey,
          publicKeyFingerprint: sshIdentity.publicKeyFingerprint,
        });

        /** @type {Readonly<Record<string, any>>} */
        let providerIntent;
        if (journal === null) {
          /** @type {Record<string, string>} */
          const ownershipNonces = {};
          for (const role of ['firewall', 'primaryIp', 'server']) {
            ownershipNonces[role] = snapshotEntropy(
              ports.randomBytes(32),
              32,
              `hetznerSingleNodeApply ${role} ownership entropy`,
            ).toString('base64url');
          }
          providerIntent = createHetznerSingleNodeProvisioningIntent({
            plan: /** @type {Readonly<Record<string, any>>} */ (observedPlan),
            incarnationId,
            ownershipNonces,
            cloudInitDigest: cloudInit.digest,
          });
          journalValue = await journalStore.initialize({
            desired,
            providerIntent: { provider: 'hetzner', intent: providerIntent },
          });
          journal = validateSingleNodeDeploymentJournal(journalValue);
        } else {
          providerIntent = journal.providerIntent.intent;
          if (
            cloudInit.digest.algorithm !==
              providerIntent.cloudInitDigest.algorithm ||
            cloudInit.digest.value !== providerIntent.cloudInitDigest.value
          ) {
            throw new Error(
              'hetznerSingleNodeApply SSH identity does not match its durable cloud-init authority.',
            );
          }
        }

        let currentJournal = /** @type {Readonly<Record<string, any>>} */ (
          journal
        );
        if (
          currentJournal.desired.desiredRevisionId !==
            desired.desiredRevisionId ||
          currentJournal.incarnationId !== incarnationId ||
          currentJournal.providerIntent.intent.provisioningIntentId !==
            providerIntent.provisioningIntentId
        ) {
          throw new Error(
            'hetznerSingleNodeApply journal initialization returned conflicting authority.',
          );
        }

        /**
         * @param {Readonly<Record<string, any>>} next
         * @returns {Promise<void>}
         */
        async function commit(next) {
          if (next.journalId === currentJournal.journalId) return;
          const expectedGeneration = currentJournal.generation;
          const expectedJournalId = currentJournal.journalId;
          const committed = validateSingleNodeDeploymentJournal(
            await journalStore.commit({
              expectedGeneration,
              expectedJournalId,
              next,
            }),
          );
          if (committed.journalId !== next.journalId) {
            throw new Error(
              'hetznerSingleNodeApply journal commit returned a conflicting successor.',
            );
          }
          currentJournal = committed;
        }

        if (currentJournal.phase === 'planned') {
          await commit(
            advanceSingleNodeDeploymentJournal(currentJournal, 'provisioning'),
          );
        }

        /**
         * Verify or converge exact durable provider authority. Later lifecycle
         * phases use callbacks that categorically reject new create attempts.
         * @param {boolean} allowMutations
         * @returns {Promise<Readonly<Record<string, any>>>}
         */
        async function convergeProvider(allowMutations) {
          const recovery =
            getSingleNodeDeploymentProvisioningRecoveryState(currentJournal);
          return validateProvisioningResult(
            await ports.convergeProvisioning({
              intent: providerIntent,
              cloudInitBytes: cloudInit.bytes,
              storedResourceIds: recovery.storedResourceIds,
              storedMutationAttempts: recovery.storedMutationAttempts,
              api,
              waitForAction: (/** @type {number} */ actionId) =>
                ports.waitForAction(api, actionId),
              wait: ports.wait,
              recordMutationAttempt: async (/** @type {unknown} */ attempt) => {
                if (!allowMutations) {
                  throw new Error(
                    'hetznerSingleNodeApply provider verification cannot create resources.',
                  );
                }
                await commit(
                  prepareSingleNodeDeploymentMutation(currentJournal, attempt),
                );
              },
              recordMutationRejection: async (
                /** @type {unknown} */ attempt,
              ) => {
                if (!allowMutations) {
                  throw new Error(
                    'hetznerSingleNodeApply provider verification cannot reject mutations.',
                  );
                }
                await commit(
                  rejectSingleNodeDeploymentMutation(currentJournal, attempt),
                );
              },
              recordResource: async (/** @type {unknown} */ resourceRecord) => {
                if (allowMutations) {
                  await commit(
                    completeSingleNodeDeploymentMutation(
                      currentJournal,
                      resourceRecord,
                    ),
                  );
                  return;
                }
                const verified = validateHetznerProvisionedResourceRecord(
                  resourceRecord,
                  providerIntent,
                );
                if (
                  recovery.storedResourceIds[verified.role] !==
                  verified.providerResourceId
                ) {
                  throw new Error(
                    'hetznerSingleNodeApply provider verification changed a durable resource identity.',
                  );
                }
              },
            }),
            providerIntent,
          );
        }

        /** @type {Readonly<Record<string, any>>} */
        let provisioned;
        if (currentJournal.phase === 'provisioning') {
          provisioned = await convergeProvider(true);
          for (const [role, providerResourceId] of [
            ['primaryIp', provisioned.resources.primaryIpId],
            ['server', provisioned.resources.serverId],
          ]) {
            await commit(
              recordSingleNodeDeploymentResource(currentJournal, {
                provider: 'hetzner',
                role,
                providerResourceId,
                publicIpv4: provisioned.publicIpv4,
                state: 'present',
              }),
            );
          }
          assertProvisioningResultMatchesJournal(provisioned, currentJournal);
          await commit(
            advanceSingleNodeDeploymentJournal(currentJournal, 'provisioned'),
          );
        } else {
          provisioned = await convergeProvider(false);
          assertProvisioningResultMatchesJournal(provisioned, currentJournal);
        }

        const primaryIp = currentJournal.resources.find(
          (/** @type {Record<string, any>} */ resource) =>
            resource.role === 'primaryIp',
        );
        if (
          !['provisioned', 'activating', 'active'].includes(
            currentJournal.phase,
          ) ||
          primaryIp?.state !== 'present' ||
          typeof primaryIp.publicIpv4 !== 'string'
        ) {
          throw new Error(
            'hetznerSingleNodeApply did not reach exact provisioned address authority.',
          );
        }
        const providerAddress = primaryIp.publicIpv4;
        if (providerAddress !== provisioned.publicIpv4) {
          throw new Error(
            'hetznerSingleNodeApply provider address conflicts with exact readback.',
          );
        }

        /** @type {Readonly<{address: string, algorithm: 'ssh-ed25519', fingerprint: string}>|undefined} */
        let sshHost;
        for (
          let attempt = 1;
          attempt <= SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS;
          attempt += 1
        ) {
          try {
            sshHost = validateSshHost(
              await ports.enrollSshHost({
                address: providerAddress,
                knownHostsPath: sshIdentity.knownHostsPath,
              }),
              providerAddress,
            );
            break;
          } catch (error) {
            if (
              attempt === SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS
            ) {
              throw new Error(
                'Hetzner single-node SSH host key could not be established before the bounded deadline.',
                { cause: error },
              );
            }
            await ports.wait(
              SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS,
            );
          }
        }
        const enrolledHost =
          /** @type {Readonly<{address: string, algorithm: 'ssh-ed25519', fingerprint: string}>} */ (
            sshHost
          );
        if (currentJournal.phase === 'active') {
          if (
            currentJournal.sshHost?.address !== enrolledHost.address ||
            currentJournal.sshHost?.algorithm !== enrolledHost.algorithm ||
            currentJournal.sshHost?.fingerprint !== enrolledHost.fingerprint
          ) {
            throw new Error(
              'hetznerSingleNodeApply active SSH host key conflicts with local pinned authority.',
            );
          }
        } else {
          await commit(
            recordSingleNodeDeploymentSshHost(currentJournal, enrolledHost),
          );
          if (currentJournal.phase === 'provisioned') {
            await commit(
              advanceSingleNodeDeploymentJournal(currentJournal, 'activating'),
            );
          }
        }

        const artifactInput = Object.hasOwn(input, 'artifactPath')
          ? { artifactPath: input.artifactPath }
          : { artifactSource: input.artifactSource };
        const activationContext = {
          desired,
          incarnationId,
          providerAddress,
          sshHostKeyFingerprint: enrolledHost.fingerprint,
          sshPublicKeyFingerprint: sshIdentity.publicKeyFingerprint,
        };
        const observedActivation = validateSingleNodeRemoteActivationEvidence(
          await ports.activate({
            desired,
            incarnationId,
            providerAddress,
            sshIdentity,
            ...artifactInput,
          }),
          activationContext,
        );
        if (currentJournal.activation === null) {
          await commit(
            recordSingleNodeDeploymentActivation(
              currentJournal,
              observedActivation,
            ),
          );
        } else if (
          JSON.stringify(currentJournal.activation) !==
          JSON.stringify(observedActivation)
        ) {
          throw new Error(
            'hetznerSingleNodeApply reconciled activation conflicts with durable evidence.',
          );
        }
        const activation = validateSingleNodeRemoteActivationEvidence(
          currentJournal.activation,
          activationContext,
        );
        if (currentJournal.phase === 'activating') {
          await commit(
            advanceSingleNodeDeploymentJournal(currentJournal, 'active'),
          );
        }
        if (currentJournal.phase !== 'active') {
          throw new Error(
            'hetznerSingleNodeApply did not reach active durable state.',
          );
        }
        result = Object.freeze({
          schemaVersion: HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
          kind: HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
          provider: 'hetzner',
          status: 'active',
          deploymentInstanceId: desired.deploymentInstanceId,
          desiredRevisionId: desired.desiredRevisionId,
          incarnationId,
          publicIpv4: providerAddress,
          artifactId: desired.artifact.artifactId,
          activationEvidenceId: activation.activationEvidenceId,
          journalId: currentJournal.journalId,
          journalGeneration: currentJournal.generation,
        });
        succeeded = true;
      } catch (error) {
        operationError = error;
      }

      const cleanup = [];
      if (Object.hasOwn(input, 'artifactSource')) {
        cleanup.push(
          Promise.resolve().then(
            async () =>
              await /** @type {Record<string, any>} */ (
                input.artifactSource
              ).close(),
          ),
        );
      }
      if (release !== undefined) {
        cleanup.push(Promise.resolve().then(async () => await release()));
      }
      const cleanupResults = await Promise.allSettled(cleanup);
      const cleanupErrors = cleanupResults
        .filter((outcome) => outcome.status === 'rejected')
        .map((outcome) => outcome.reason);
      if (!succeeded && cleanupErrors.length > 0) {
        throw new AggregateError(
          [operationError, ...cleanupErrors],
          'Hetzner single-node apply failed and local cleanup was incomplete.',
        );
      }
      if (!succeeded) throw operationError;
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          'Hetzner single-node apply local cleanup was incomplete.',
        );
      }
      return /** @type {Readonly<Record<string, any>>} */ (result);
    },
  });
}

/**
 * Build the production coordinator. Provider credentials are read only from
 * the invocation's ambient HCLOUD_TOKEN and remain inside these effect ports.
 * @returns {ReturnType<typeof createHetznerSingleNodeApplyCoordinator>}
 */
export function createProductionHetznerSingleNodeApplyCoordinator() {
  const runProcess = createBoundedProcessRunner();
  const activator = createSingleNodeRemoteActivator({ runProcess });
  return createHetznerSingleNodeApplyCoordinator({
    acquireOperationLock: acquireSingleNodeDeploymentOperationLock,
    readToken: () => process.env.HCLOUD_TOKEN,
    bindCredential: async (/** @type {Record<string, any>} */ value) =>
      await createHetznerCredentialBindingStore({
        root: path.join(value.dataRoot, 'single-node-deployment-credentials'),
      }).ensureBinding({
        deploymentInstanceId: value.deploymentInstanceId,
        token: value.token,
      }),
    createApi: createHetznerApiClient,
    resolvePlan: resolveHetznerSingleNodePlan,
    createJournalStore: createSingleNodeDeploymentJournalStore,
    ensureSshIdentity: async (/** @type {Record<string, any>} */ value) =>
      await createDeploymentSshIdentityStore({
        root: path.join(value.dataRoot, 'single-node-deployment-ssh', 'v1'),
        runProcess,
      }).ensureIdentity({
        deploymentInstanceId: value.deploymentInstanceId,
        incarnationId: value.incarnationId,
      }),
    waitForAction: async (
      /** @type {Record<string, any>} */ api,
      /** @type {number} */ actionId,
    ) =>
      await createHetznerActionWaiter({
        getAction: api.getAction.bind(api),
      }).waitForAction(actionId),
    convergeProvisioning: convergeHetznerSingleNodeProvisioning,
    enrollSshHost: async (/** @type {Record<string, any>} */ value) =>
      await ensureDeploymentSshHostKey({
        address: value.address,
        knownHostsPath: value.knownHostsPath,
        runProcess,
      }),
    activate: activator.activate,
    randomBytes: nodeRandomBytes,
    wait: async (/** @type {number} */ milliseconds) =>
      await new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
}

export default {
  HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
  HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
  createHetznerSingleNodeApplyCoordinator,
  createProductionHetznerSingleNodeApplyCoordinator,
};
