/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow composition root keeps its injected port protocol beside the implementation. */

import path from 'node:path';
import process from 'node:process';

import { assertLogicalId } from '../../logical-id.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentDestructionRecoveryState,
  prepareSingleNodeDeploymentDestruction,
  recordSingleNodeDeploymentDeletion,
  validateSingleNodeDeploymentJournal,
} from '../../single-node-deployment-journal.js';
import { assertSingleNodeDeploymentInstanceId } from '../../single-node-deployment-identity.js';
import { acquireSingleNodeDeploymentOperationLock } from '../../single-node-deployment-operation-lock.js';
import { createHetznerActionWaiter } from './action-waiter.js';
import { createHetznerApiClient } from './api-client.js';
import {
  HETZNER_PROVISIONED_RESOURCE_KIND,
  reconcileHetznerPreparedCreateForDestroy,
} from './single-node-provisioning.js';
import {
  createHetznerCredentialBindingStore,
  validateHetznerCredentialBindingEvidence,
} from './credential-binding.js';
import { convergeHetznerSingleNodeDestruction } from './single-node-destruction.js';

export const HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION = 1;
export const HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND =
  'hetznerSingleNodeDestroyResult';

const INPUT_KEYS = new Set(['appId', 'deploymentInstanceId', 'dataRoot']);
const DEPENDENCY_KEYS = new Set([
  'acquireOperationLock',
  'readToken',
  'requireCredentialBinding',
  'createApi',
  'createJournalStore',
  'reconcilePreparedMutation',
  'waitForAction',
  'convergeDestruction',
]);
const DESTRUCTION_RESULT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  'planId',
  'providerSpecId',
  'deploymentInstanceId',
  'incarnationId',
  'status',
  'resources',
]);
const DESTRUCTION_ROLES = Object.freeze(['server', 'primaryIp', 'firewall']);
const DESTRUCTION_RESOURCE_KEYS = new Set([
  'providerResourceId',
  'state',
  'deletionId',
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
  const snapshot = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
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
 * @returns {Readonly<{appId: string, deploymentInstanceId: string, dataRoot: string}>}
 */
function validateInput(value) {
  const input = snapshotExactObject(
    value,
    INPUT_KEYS,
    'hetznerSingleNodeDestroy',
  );
  assertLogicalId(input.appId, 'hetznerSingleNodeDestroy.appId');
  assertSingleNodeDeploymentInstanceId(
    input.deploymentInstanceId,
    'hetznerSingleNodeDestroy.deploymentInstanceId',
  );
  return Object.freeze({
    appId: input.appId,
    deploymentInstanceId: input.deploymentInstanceId,
    dataRoot: canonicalAbsolutePath(
      input.dataRoot,
      'hetznerSingleNodeDestroy.dataRoot',
    ),
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
    'hetznerSingleNodeDestroy dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `hetznerSingleNodeDestroy dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @param {Readonly<Record<string, any>>} journal
 * @returns {Readonly<Record<string, any>>}
 */
function validateDestructionResult(value, intent, journal) {
  const result = snapshotExactObject(
    value,
    DESTRUCTION_RESULT_KEYS,
    'hetznerSingleNodeDestroy.destructionResult',
  );
  if (
    result.schemaVersion !== 1 ||
    result.kind !== 'hetznerSingleNodeDestructionResult' ||
    result.status !== 'destroyed' ||
    result.provisioningIntentId !== intent.provisioningIntentId ||
    result.planId !== intent.plan.planId ||
    result.providerSpecId !== intent.plan.providerSpec.providerSpecId ||
    result.deploymentInstanceId !== journal.deploymentInstanceId ||
    result.incarnationId !== journal.incarnationId
  ) {
    throw new Error(
      'hetznerSingleNodeDestroy result does not match its durable authority.',
    );
  }
  const resources = snapshotExactObject(
    result.resources,
    new Set(DESTRUCTION_ROLES),
    'hetznerSingleNodeDestroy.destructionResult.resources',
  );
  const recovery = getSingleNodeDeploymentDestructionRecoveryState(journal);
  for (const role of DESTRUCTION_ROLES) {
    const resource = snapshotExactObject(
      resources[role],
      DESTRUCTION_RESOURCE_KEYS,
      `hetznerSingleNodeDestroy.destructionResult.resources.${role}`,
    );
    const expectedDeletion = recovery.storedDeletionRecords[role];
    if (
      resource.providerResourceId !== recovery.storedResourceIds[role] ||
      resource.state !== 'absent' ||
      resource.deletionId !== (expectedDeletion?.deletionId ?? null)
    ) {
      throw new Error(
        `hetznerSingleNodeDestroy ${role} result does not match durable absence evidence.`,
      );
    }
  }
  return Object.freeze(result);
}

/**
 * @param {Readonly<Record<string, any>>} journal
 * @returns {Readonly<Record<string, any>>}
 */
function createResult(journal) {
  return Object.freeze({
    schemaVersion: HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
    kind: HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
    provider: 'hetzner',
    status: 'destroyed',
    appId: journal.desired.intent.appId,
    deploymentInstanceId: journal.deploymentInstanceId,
    incarnationId: journal.incarnationId,
    provisioningIntentId: journal.providerIntent.intent.provisioningIntentId,
    journalId: journal.journalId,
    journalGeneration: journal.generation,
  });
}

/**
 * Create the testable Hetzner destroy composition root.
 * @param {unknown} dependencies
 * @returns {Readonly<{destroy(value: unknown): Promise<Readonly<Record<string, any>>>}>}
 */
export function createHetznerSingleNodeDestroyCoordinator(dependencies) {
  const ports = validateDependencies(dependencies);

  return Object.freeze({
    /**
     * Destroy or recover one exact locally authorized deployment.
     * @param {unknown} value
     * @returns {Promise<Readonly<Record<string, any>>>}
     */
    async destroy(value) {
      const input = validateInput(value);
      /** @type {undefined|(() => Promise<void>)} */
      let release;
      let succeeded = false;
      /** @type {unknown} */
      let operationError;
      /** @type {Readonly<Record<string, any>>|undefined} */
      let result;

      try {
        release = await ports.acquireOperationLock(input.deploymentInstanceId);
        if (typeof release !== 'function') {
          throw new TypeError(
            'hetznerSingleNodeDestroy operation lock must return release().',
          );
        }
        const journalStore = ports.createJournalStore(input);
        if (
          journalStore === null ||
          typeof journalStore !== 'object' ||
          typeof journalStore.prepareStorage !== 'function' ||
          typeof journalStore.read !== 'function' ||
          typeof journalStore.commit !== 'function'
        ) {
          throw new TypeError(
            'hetznerSingleNodeDestroy journal store is invalid.',
          );
        }
        await journalStore.prepareStorage();
        const stored = await journalStore.read();
        if (stored === null) {
          throw new Error(
            'hetznerSingleNodeDestroy has no durable local deployment authority.',
          );
        }
        let journal = validateSingleNodeDeploymentJournal(stored);
        if (
          journal.deploymentInstanceId !== input.deploymentInstanceId ||
          journal.desired.intent.appId !== input.appId ||
          journal.providerIntent.provider !== 'hetzner'
        ) {
          throw new Error(
            'hetznerSingleNodeDestroy journal conflicts with the requested deployment.',
          );
        }
        if (journal.phase === 'destroyed') {
          result = createResult(journal);
          succeeded = true;
        } else {
          const token = await ports.readToken();
          if (
            typeof token !== 'string' ||
            token.length === 0 ||
            token.trim() !== token
          ) {
            throw new Error(
              'Hetzner destroy requires ambient HCLOUD_TOKEN authority.',
            );
          }
          const binding = validateHetznerCredentialBindingEvidence(
            await ports.requireCredentialBinding({
              dataRoot: input.dataRoot,
              deploymentInstanceId: input.deploymentInstanceId,
              token,
            }),
          );
          if (binding.deploymentInstanceId !== input.deploymentInstanceId) {
            throw new Error(
              'hetznerSingleNodeDestroy credential binding conflicts with the deployment.',
            );
          }
          const api = ports.createApi({ token });
          if (api === null || typeof api !== 'object') {
            throw new TypeError(
              'hetznerSingleNodeDestroy provider API is invalid.',
            );
          }

          /**
           * @param {Readonly<Record<string, any>>} next
           * @returns {Promise<void>}
           */
          async function commit(next) {
            if (next.journalId === journal.journalId) return;
            const expectedGeneration = journal.generation;
            const expectedJournalId = journal.journalId;
            const committed = validateSingleNodeDeploymentJournal(
              await journalStore.commit({
                expectedGeneration,
                expectedJournalId,
                next,
              }),
            );
            if (committed.journalId !== next.journalId) {
              throw new Error(
                'hetznerSingleNodeDestroy journal commit returned a conflicting successor.',
              );
            }
            journal = committed;
          }

          const intent = journal.providerIntent.intent;
          if (journal.phase !== 'destroying') {
            await commit(
              advanceSingleNodeDeploymentJournal(journal, 'destroying'),
            );
          }
          for (const prepared of journal.mutationAttempts.filter(
            (/** @type {Record<string, any>} */ attempt) =>
              attempt.state === 'prepared',
          )) {
            const recovered = await ports.reconcilePreparedMutation({
              intent,
              mutationAttempt: prepared.evidence,
              api,
            });
            if (
              recovered !== null &&
              typeof recovered === 'object' &&
              !Array.isArray(recovered) &&
              recovered.kind === HETZNER_PROVISIONED_RESOURCE_KIND
            ) {
              await commit(
                completeSingleNodeDeploymentMutation(journal, recovered),
              );
            } else {
              throw new Error(
                'hetznerSingleNodeDestroy prepared mutation recovery returned invalid evidence.',
              );
            }
          }
          const recovery =
            getSingleNodeDeploymentDestructionRecoveryState(journal);
          const destroyed = await ports.convergeDestruction({
            intent,
            storedResourceIds: recovery.storedResourceIds,
            storedDestroyAttempts: recovery.storedDestroyAttempts,
            storedDeletionRecords: recovery.storedDeletionRecords,
            api,
            waitForAction: (/** @type {number} */ actionId) =>
              ports.waitForAction(api, actionId),
            recordDestroyAttempt: async (/** @type {unknown} */ attempt) => {
              await commit(
                prepareSingleNodeDeploymentDestruction(journal, attempt),
              );
            },
            recordDeletion: async (/** @type {unknown} */ deletion) => {
              await commit(
                recordSingleNodeDeploymentDeletion(journal, deletion),
              );
            },
          });
          validateDestructionResult(destroyed, intent, journal);
          await commit(
            advanceSingleNodeDeploymentJournal(journal, 'destroyed'),
          );
          result = createResult(journal);
          succeeded = true;
        }
      } catch (error) {
        operationError = error;
      }

      let releaseError;
      if (release !== undefined) {
        try {
          await release();
        } catch (error) {
          releaseError = error;
        }
      }
      if (!succeeded && releaseError !== undefined) {
        throw new AggregateError(
          [operationError, releaseError],
          'Hetzner single-node destroy failed and its operation lock could not be released.',
        );
      }
      if (!succeeded) throw operationError;
      if (releaseError !== undefined) throw releaseError;
      return /** @type {Readonly<Record<string, any>>} */ (result);
    },
  });
}

/**
 * Build production destruction with ambient HCLOUD_TOKEN authority.
 * @returns {ReturnType<typeof createHetznerSingleNodeDestroyCoordinator>}
 */
export function createProductionHetznerSingleNodeDestroyCoordinator() {
  return createHetznerSingleNodeDestroyCoordinator({
    acquireOperationLock: acquireSingleNodeDeploymentOperationLock,
    readToken: () => process.env.HCLOUD_TOKEN,
    requireCredentialBinding: async (
      /** @type {Record<string, any>} */ value,
    ) =>
      await createHetznerCredentialBindingStore({
        root: path.join(value.dataRoot, 'single-node-deployment-credentials'),
      }).requireBinding({
        deploymentInstanceId: value.deploymentInstanceId,
        token: value.token,
      }),
    createApi: createHetznerApiClient,
    createJournalStore: createSingleNodeDeploymentJournalStore,
    reconcilePreparedMutation: reconcileHetznerPreparedCreateForDestroy,
    waitForAction: async (
      /** @type {Record<string, any>} */ api,
      /** @type {number} */ actionId,
    ) =>
      await createHetznerActionWaiter({
        getAction: api.getAction.bind(api),
      }).waitForAction(actionId),
    convergeDestruction: convergeHetznerSingleNodeDestruction,
  });
}

export default {
  HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
  HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
  createHetznerSingleNodeDestroyCoordinator,
  createProductionHetznerSingleNodeDestroyCoordinator,
};
