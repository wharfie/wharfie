/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow coordinator keeps its injected port protocol beside the implementation. */

import path from 'node:path';

import { createBoundedProcessRunner } from './bounded-process.js';
import { createDeploymentSshIdentityStore } from './deployment-ssh-identity.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  abandonSingleNodeDeploymentReleaseUpdate,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentCurrentRelease,
  getSingleNodeDeploymentEffectiveDesired,
  getSingleNodeDeploymentEffectiveTargetRelease,
  prepareSingleNodeDeploymentReleaseUpdate,
  recordSingleNodeDeploymentActivation,
  settleSingleNodeDeploymentReleaseTransition,
  validateSingleNodeDeploymentJournal,
} from './single-node-deployment-journal.js';
import {
  createSingleNodeDeploymentDesired,
  validateSingleNodeDeploymentDesired,
} from './single-node-deployment-desired.js';
import { acquireSingleNodeDeploymentOperationLock } from './single-node-deployment-operation-lock.js';
import {
  createSingleNodeRemoteActivator,
  validateSingleNodeRemoteActivationEvidence,
} from './single-node-remote-activation.js';

export const SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_SCHEMA_VERSION = 1;
export const SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_KIND =
  'singleNodeDeploymentUpdateResult';

const INPUT_COMMON_KEYS = new Set([
  'desired',
  'revision',
  'artifactRecord',
  'observation',
  'dataRoot',
]);
const DEPENDENCY_KEYS = new Set([
  'acquireOperationLock',
  'createJournalStore',
  'readSshIdentity',
  'activate',
]);
const HELD_SOURCE_KEYS = new Set([
  'observation',
  'createReadStream',
  'verifyUnchanged',
  'close',
]);
const SSH_IDENTITY_KEYS = new Set([
  'privateKeyPath',
  'publicKey',
  'publicKeyFingerprint',
  'knownHostsPath',
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactObject(value, expected, valuePath) {
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
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
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
 * Bind held-source methods once and make close idempotent. Both this
 * coordinator and the remote activator own local cleanup on their boundary.
 * @param {Record<string, any>} source
 * @param {Record<string, any>} receiver
 * @returns {Readonly<Record<string, any>>}
 */
function guardHeldSource(source, receiver) {
  const createReadStream = source.createReadStream.bind(receiver);
  const verifyUnchanged = source.verifyUnchanged.bind(receiver);
  const closeSource = source.close.bind(receiver);
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
 * Validate one exact target and bind its embedded artifact bytes to the same
 * desired state before any durable or remote effect.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function validateUpdateInput(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'singleNodeDeploymentUpdate input must be an exact object.',
    );
  }
  const object = /** @type {Record<string, any>} */ (value);
  const hasArtifactPath = Object.hasOwn(object, 'artifactPath');
  const hasArtifactSource = Object.hasOwn(object, 'artifactSource');
  if (hasArtifactPath === hasArtifactSource) {
    throw new TypeError(
      'singleNodeDeploymentUpdate requires exactly one artifactPath or artifactSource.',
    );
  }
  const input = exactObject(
    value,
    new Set([
      ...INPUT_COMMON_KEYS,
      hasArtifactPath ? 'artifactPath' : 'artifactSource',
    ]),
    'singleNodeDeploymentUpdate',
  );
  const suppliedDesired = validateSingleNodeDeploymentDesired(
    input.desired,
    'singleNodeDeploymentUpdate.desired',
  );
  const desired = createSingleNodeDeploymentDesired({
    intent: suppliedDesired.intent,
    revision: input.revision,
    artifactRecord: input.artifactRecord,
    observation: input.observation,
  });
  if (JSON.stringify(suppliedDesired) !== JSON.stringify(desired)) {
    throw new Error(
      'singleNodeDeploymentUpdate desired state does not match the held artifact authority.',
    );
  }
  const dataRoot = canonicalAbsolutePath(
    input.dataRoot,
    'singleNodeDeploymentUpdate.dataRoot',
  );
  if (hasArtifactPath) {
    return Object.freeze({
      desired,
      dataRoot,
      artifactPath: canonicalAbsolutePath(
        input.artifactPath,
        'singleNodeDeploymentUpdate.artifactPath',
      ),
    });
  }
  const source = exactObject(
    input.artifactSource,
    HELD_SOURCE_KEYS,
    'singleNodeDeploymentUpdate.artifactSource',
  );
  for (const name of ['createReadStream', 'verifyUnchanged', 'close']) {
    if (typeof source[name] !== 'function') {
      throw new TypeError(
        `singleNodeDeploymentUpdate.artifactSource.${name} must be a function.`,
      );
    }
  }
  const sourceDesired = createSingleNodeDeploymentDesired({
    intent: desired.intent,
    revision: input.revision,
    artifactRecord: input.artifactRecord,
    observation: source.observation,
  });
  if (sourceDesired.desiredRevisionId !== desired.desiredRevisionId) {
    throw new Error(
      'singleNodeDeploymentUpdate artifactSource does not match its held observation.',
    );
  }
  return Object.freeze({
    desired,
    dataRoot,
    artifactSource: guardHeldSource(
      source,
      /** @type {Record<string, any>} */ (input.artifactSource),
    ),
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, string>>}
 */
function validateSshIdentity(value) {
  const identity = exactObject(
    value,
    SSH_IDENTITY_KEYS,
    'singleNodeDeploymentUpdate.sshIdentity',
  );
  return Object.freeze({
    privateKeyPath: canonicalAbsolutePath(
      identity.privateKeyPath,
      'singleNodeDeploymentUpdate.sshIdentity.privateKeyPath',
    ),
    publicKey: identity.publicKey,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    knownHostsPath: canonicalAbsolutePath(
      identity.knownHostsPath,
      'singleNodeDeploymentUpdate.sshIdentity.knownHostsPath',
    ),
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function validateDependencies(value) {
  const dependencies = exactObject(
    value,
    DEPENDENCY_KEYS,
    'singleNodeDeploymentUpdate dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `singleNodeDeploymentUpdate dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * @param {Readonly<Record<string, any>>} left
 * @param {Readonly<Record<string, any>>} right
 * @returns {boolean}
 */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Derive the bounded guest wrapper retention authority. A normal update keeps
 * committed current, rollback, and target; failed-target restoration excludes
 * the target that will be abandoned after current is re-proven.
 * @param {Readonly<Record<string, any>>} journal
 * @param {Readonly<Record<string, any>>} targetDesired
 * @param {boolean} restoreCurrent
 * @returns {readonly string[]}
 */
function retainedArtifactIds(journal, targetDesired, restoreCurrent) {
  const ids = [
    journal.release.current?.desired.artifact.artifactId,
    journal.release.rollback?.desired.artifact.artifactId,
    restoreCurrent ? null : targetDesired.artifact.artifactId,
  ].filter((value) => typeof value === 'string');
  return Object.freeze([...new Set(ids)].sort());
}

/**
 * @param {Readonly<Record<string, any>>|null} value
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
function requireCompleteRelease(value, valuePath) {
  if (value === null || value.artifact === null || value.activation === null) {
    throw new Error(`${valuePath} must be one complete release authority.`);
  }
  return value;
}

/**
 * Create the provider-neutral update and recovery coordinator. Provider state
 * is immutable here: only exact local journal authority and its pinned SSH
 * identity can authorize remote convergence.
 * @param {unknown} dependencies
 * @returns {Readonly<{update(value: unknown): Promise<Readonly<Record<string, any>>>, recover(value: unknown): Promise<Readonly<Record<string, any>>>}>}
 */
export function createSingleNodeDeploymentUpdateCoordinator(dependencies) {
  const ports = validateDependencies(dependencies);

  /**
   * Install a new exact release, resume that same transition, repair current,
   * or restore current before abandoning a failed target during recovery.
   * @param {unknown} value
   * @param {boolean} recovery - Whether failed-target restoration is allowed.
   * @returns {Promise<Readonly<Record<string, any>>>}
   */
  async function run(value, recovery) {
    const input = validateUpdateInput(value);
    const targetDesired = input.desired;
    /** @type {undefined|(() => Promise<void>)} */
    let releaseLock;
    /** @type {Readonly<Record<string, any>>|undefined} */
    let result;
    /** @type {unknown} */
    let operationError;

    try {
      releaseLock = await ports.acquireOperationLock(
        targetDesired.deploymentInstanceId,
      );
      if (typeof releaseLock !== 'function') {
        throw new TypeError(
          'singleNodeDeploymentUpdate operation lock must return release().',
        );
      }
      const store = ports.createJournalStore({
        appId: targetDesired.intent.appId,
        deploymentInstanceId: targetDesired.deploymentInstanceId,
        dataRoot: input.dataRoot,
      });
      if (
        store === null ||
        typeof store !== 'object' ||
        typeof store.read !== 'function' ||
        typeof store.commit !== 'function'
      ) {
        throw new TypeError(
          'singleNodeDeploymentUpdate journal store is invalid.',
        );
      }
      const journalValue = await store.read();
      if (journalValue === null) {
        throw new Error(
          'singleNodeDeploymentUpdate requires existing local deployment authority.',
        );
      }
      let journal = validateSingleNodeDeploymentJournal(journalValue);
      const journalDesired = getSingleNodeDeploymentEffectiveDesired(journal);
      if (
        journal.deploymentInstanceId !== targetDesired.deploymentInstanceId ||
        journalDesired.intent.appId !== targetDesired.intent.appId
      ) {
        throw new Error(
          'singleNodeDeploymentUpdate journal does not match the target application authority.',
        );
      }
      if (journal.phase !== 'active') {
        throw new Error(
          'singleNodeDeploymentUpdate requires active deployment authority.',
        );
      }
      const priorRelease = requireCompleteRelease(
        getSingleNodeDeploymentCurrentRelease(journal),
        'singleNodeDeploymentUpdate current release',
      );

      /**
       * @param {Readonly<Record<string, any>>} next
       * @returns {Promise<void>}
       */
      async function commit(next) {
        if (next.journalId === journal.journalId) return;
        const committed = validateSingleNodeDeploymentJournal(
          await store.commit({
            expectedGeneration: journal.generation,
            expectedJournalId: journal.journalId,
            next,
          }),
        );
        if (committed.journalId !== next.journalId) {
          throw new Error(
            'singleNodeDeploymentUpdate journal commit returned a conflicting successor.',
          );
        }
        journal = committed;
      }

      const transition = journal.release.transition;
      const targetsCurrent = sameJson(targetDesired, priorRelease.desired);
      const targetsTransition =
        transition !== null &&
        sameJson(targetDesired, transition.target.desired);
      if (
        recovery &&
        ((transition === null && !targetsCurrent) ||
          (transition !== null && !targetsTransition && !targetsCurrent))
      ) {
        throw new Error(
          'singleNodeDeploymentUpdate recovery requires the exact current or in-flight target release.',
        );
      }
      const restoreCurrent = recovery && transition !== null && targetsCurrent;

      if (!restoreCurrent) {
        // The pure journal transition rejects an incompatible desired state
        // and, critically, a different in-flight target before SSH is read.
        await commit(
          prepareSingleNodeDeploymentReleaseUpdate(journal, targetDesired),
        );
        const effectiveDesired =
          getSingleNodeDeploymentEffectiveDesired(journal);
        const targetRelease =
          getSingleNodeDeploymentEffectiveTargetRelease(journal);
        if (
          effectiveDesired.desiredRevisionId !==
            targetDesired.desiredRevisionId ||
          targetRelease.desired.desiredRevisionId !==
            targetDesired.desiredRevisionId ||
          !sameJson(effectiveDesired, targetDesired)
        ) {
          throw new Error(
            'singleNodeDeploymentUpdate target conflicts with durable release authority.',
          );
        }
      }
      const sshHost = journal.sshHost;
      if (
        sshHost === null ||
        sshHost.address !== priorRelease.activation.address ||
        sshHost.fingerprint !== priorRelease.activation.sshHostKey.fingerprint
      ) {
        throw new Error(
          'singleNodeDeploymentUpdate lacks exact pinned SSH host authority.',
        );
      }
      const sshIdentity = validateSshIdentity(
        await ports.readSshIdentity({
          dataRoot: input.dataRoot,
          deploymentInstanceId: journal.deploymentInstanceId,
          incarnationId: journal.incarnationId,
        }),
      );
      if (
        sshIdentity.publicKeyFingerprint !==
        priorRelease.activation.bootstrap.sshPublicKeyFingerprint
      ) {
        throw new Error(
          'singleNodeDeploymentUpdate SSH identity conflicts with durable activation authority.',
        );
      }
      const artifactInput = Object.hasOwn(input, 'artifactPath')
        ? { artifactPath: input.artifactPath }
        : { artifactSource: input.artifactSource };
      const activationContext = {
        desired: targetDesired,
        incarnationId: journal.incarnationId,
        providerAddress: sshHost.address,
        sshHostKeyFingerprint: sshHost.fingerprint,
        sshPublicKeyFingerprint: sshIdentity.publicKeyFingerprint,
      };
      const observedActivation = validateSingleNodeRemoteActivationEvidence(
        await ports.activate({
          desired: targetDesired,
          incarnationId: journal.incarnationId,
          providerAddress: sshHost.address,
          retainedArtifactIds: retainedArtifactIds(
            journal,
            targetDesired,
            restoreCurrent,
          ),
          sshIdentity,
          ...artifactInput,
        }),
        activationContext,
      );

      const currentBeforeActivation = requireCompleteRelease(
        getSingleNodeDeploymentCurrentRelease(journal),
        'singleNodeDeploymentUpdate current release before activation',
      );
      if (restoreCurrent) {
        if (!sameJson(priorRelease.activation, observedActivation)) {
          throw new Error(
            'singleNodeDeploymentUpdate restored-current evidence conflicts with committed authority.',
          );
        }
        await commit(abandonSingleNodeDeploymentReleaseUpdate(journal));
      } else if (
        currentBeforeActivation.desired.desiredRevisionId ===
          targetDesired.desiredRevisionId &&
        journal.release.transition === null
      ) {
        if (!sameJson(currentBeforeActivation.activation, observedActivation)) {
          throw new Error(
            'singleNodeDeploymentUpdate repair evidence conflicts with the settled current release.',
          );
        }
      } else {
        await commit(
          recordSingleNodeDeploymentActivation(journal, observedActivation),
        );
        await commit(settleSingleNodeDeploymentReleaseTransition(journal));
      }
      const currentRelease = requireCompleteRelease(
        getSingleNodeDeploymentCurrentRelease(journal),
        'singleNodeDeploymentUpdate settled current release',
      );
      if (
        journal.phase !== 'active' ||
        journal.release.transition !== null ||
        currentRelease.desired.desiredRevisionId !==
          targetDesired.desiredRevisionId ||
        !sameJson(currentRelease.activation, observedActivation)
      ) {
        throw new Error(
          'singleNodeDeploymentUpdate did not settle exact active release authority.',
        );
      }
      result = Object.freeze({
        schemaVersion: SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_SCHEMA_VERSION,
        kind: SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_KIND,
        provider: journal.providerIntent.provider,
        status: 'active',
        deploymentInstanceId: journal.deploymentInstanceId,
        incarnationId: journal.incarnationId,
        publicIpv4: sshHost.address,
        priorDesiredRevisionId: priorRelease.desired.desiredRevisionId,
        priorArtifactId: priorRelease.desired.artifact.artifactId,
        desiredRevisionId: currentRelease.desired.desiredRevisionId,
        artifactId: currentRelease.desired.artifact.artifactId,
        activationEvidenceId: currentRelease.activation.activationEvidenceId,
        journalId: journal.journalId,
        journalGeneration: journal.generation,
      });
      assertManifestIsSecretFree(result, 'singleNodeDeploymentUpdate.result');
    } catch (error) {
      operationError = error;
    }

    const cleanup = [];
    if (Object.hasOwn(input, 'artifactSource')) {
      cleanup.push(
        Promise.resolve().then(async () => await input.artifactSource.close()),
      );
    }
    if (releaseLock !== undefined) {
      cleanup.push(Promise.resolve().then(async () => await releaseLock()));
    }
    const cleanupResults = await Promise.allSettled(cleanup);
    const cleanupErrors = cleanupResults
      .filter((outcome) => outcome.status === 'rejected')
      .map((outcome) => outcome.reason);
    if (operationError !== undefined && cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        'Single-node deployment update failed and local cleanup was incomplete.',
      );
    }
    if (operationError !== undefined) throw operationError;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'Single-node deployment update local cleanup was incomplete.',
      );
    }
    return /** @type {Readonly<Record<string, any>>} */ (result);
  }

  return Object.freeze({
    /**
     * @param {unknown} value - Exact target release authority.
     * @returns {Promise<Readonly<Record<string, any>>>} - Settled update result.
     */
    async update(value) {
      return await run(value, false);
    },
    /**
     * @param {unknown} value - Exact current or target recovery authority.
     * @returns {Promise<Readonly<Record<string, any>>>} - Settled recovery result.
     */
    async recover(value) {
      return await run(value, true);
    },
  });
}

/**
 * Create the production coordinator from the bounded subprocess, immutable
 * journal store, and read-only existing SSH identity capabilities.
 * @returns {ReturnType<typeof createSingleNodeDeploymentUpdateCoordinator>}
 */
export function createProductionSingleNodeDeploymentUpdateCoordinator() {
  const runProcess = createBoundedProcessRunner();
  const activator = createSingleNodeRemoteActivator({ runProcess });
  return createSingleNodeDeploymentUpdateCoordinator({
    acquireOperationLock: acquireSingleNodeDeploymentOperationLock,
    createJournalStore: createSingleNodeDeploymentJournalStore,
    readSshIdentity: async (/** @type {Record<string, any>} */ value) =>
      await createDeploymentSshIdentityStore({
        root: path.join(value.dataRoot, 'single-node-deployment-ssh', 'v1'),
        runProcess,
      }).readIdentity({
        deploymentInstanceId: value.deploymentInstanceId,
        incarnationId: value.incarnationId,
      }),
    activate: activator.activate,
  });
}

export default {
  SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_KIND,
  SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_SCHEMA_VERSION,
  createProductionSingleNodeDeploymentUpdateCoordinator,
  createSingleNodeDeploymentUpdateCoordinator,
};
