/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow composition root keeps its complete injected recovery protocol beside the implementation. */

import path from 'node:path';

import { createBoundedProcessRunner } from '../../bounded-process.js';
import { validateProviderScope } from '../../deployment-provider-scope.js';
import { createDeploymentSshIdentityStore } from '../../deployment-ssh-identity.js';
import { createSingleNodeCloudInit } from '../../single-node-cloud-init.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentDestructionRecoveryState,
  getSingleNodeDeploymentProvisioningRecoveryState,
  prepareSingleNodeDeploymentDestruction,
  prepareSingleNodeDeploymentMutations,
  recordSingleNodeDeploymentDeletion,
  validateSingleNodeDeploymentJournal,
} from '../../single-node-deployment-journal.js';
import { assertSingleNodeDeploymentInstanceId } from '../../single-node-deployment-identity.js';
import { acquireSingleNodeDeploymentOperationLock } from '../../single-node-deployment-operation-lock.js';
import { assertLogicalId } from '../../logical-id.js';
import {
  AWS_SINGLE_NODE_OPERATION_AUTHORITY_KIND,
  AWS_SINGLE_NODE_OPERATION_AUTHORITY_SCHEMA_VERSION,
  createAwsSingleNodeOperationAuthority,
} from './operation-authority.js';
import {
  AWS_SINGLE_NODE_DESTRUCTION_RESULT_KIND,
  AWS_SINGLE_NODE_DESTRUCTION_RESULT_SCHEMA_VERSION,
  convergeAwsSingleNodeDestruction,
} from './single-node-destruction.js';
import {
  AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND,
  AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_SCHEMA_VERSION,
  reconcileAwsSingleNodePreparedCreatesForDestroy,
} from './single-node-provisioning.js';

export const AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_DESTROY_RESULT_KIND = 'awsSingleNodeDestroyResult';

const INPUT_KEYS = new Set(['appId', 'deploymentInstanceId', 'dataRoot']);
const DEPENDENCY_KEYS = new Set([
  'acquireOperationLock',
  'createOperationAuthority',
  'createJournalStore',
  'ensureSshIdentity',
  'reconcilePreparedCreates',
  'convergeDestruction',
]);
const AUTHORITY_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerScope',
  'api',
  'resolveScope',
  'close',
]);
const AUTHORITY_API_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstances',
  'describeVolumes',
  'describeInstanceCreditSpecifications',
  'createSecurityGroup',
  'authorizeSecurityGroupIngress',
  'runInstances',
  'terminateInstances',
  'deleteVolume',
  'deleteSecurityGroup',
]);
const STORE_METHODS = Object.freeze(['prepareStorage', 'read', 'commit']);
const SSH_IDENTITY_KEYS = new Set([
  'privateKeyPath',
  'publicKey',
  'publicKeyFingerprint',
  'knownHostsPath',
]);
const RECONCILIATION_RESULT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'resources',
  'status',
]);
const RECONCILIATION_RESOURCE_KEYS = new Set([
  'securityGroupId',
  'instanceId',
  'rootVolumeId',
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
const DESTRUCTION_ROLES = Object.freeze([
  'instance',
  'rootVolume',
  'securityGroup',
]);
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
 * Snapshot named own-data function capabilities without retaining a receiver.
 * @param {unknown} value
 * @param {readonly string[]} methods
 * @param {string} valuePath
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotFunctions(value, methods, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`${valuePath}.${method} must be an own function.`);
    }
    result[method] = descriptor.value;
  }
  return Object.freeze(result);
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
  const input = snapshotExactObject(value, INPUT_KEYS, 'awsSingleNodeDestroy');
  assertLogicalId(input.appId, 'awsSingleNodeDestroy.appId');
  assertSingleNodeDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsSingleNodeDestroy.deploymentInstanceId',
  );
  return Object.freeze({
    appId: input.appId,
    deploymentInstanceId: input.deploymentInstanceId,
    dataRoot: canonicalAbsolutePath(
      input.dataRoot,
      'awsSingleNodeDestroy.dataRoot',
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
    'awsSingleNodeDestroy dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `awsSingleNodeDestroy dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function validateJournalStore(value) {
  return snapshotFunctions(
    value,
    STORE_METHODS,
    'awsSingleNodeDestroy.journalStore',
  );
}

/**
 * Capture close authority before validating the remaining opened resource.
 * @param {unknown} value
 * @returns {() => Promise<void>}
 */
function createAuthorityCloser(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'awsSingleNodeDestroy.operationAuthority must be an object.',
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'close');
  if (
    !descriptor ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, 'value') ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeDestroy.operationAuthority.close must be an own function.',
    );
  }
  const closeCapability = descriptor.value;
  /** @type {Promise<void>|undefined} */
  let closePromise;
  return function close() {
    if (closePromise === undefined) {
      closePromise = Promise.resolve().then(
        async () => await Reflect.apply(closeCapability, undefined, []),
      );
    }
    return closePromise;
  };
}

/**
 * @param {Record<string, any>} authority
 * @returns {Readonly<Record<string, any>>}
 */
function validateAuthoritySnapshot(authority) {
  if (
    authority.schemaVersion !==
      AWS_SINGLE_NODE_OPERATION_AUTHORITY_SCHEMA_VERSION ||
    authority.kind !== AWS_SINGLE_NODE_OPERATION_AUTHORITY_KIND ||
    typeof authority.resolveScope !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeDestroy.operationAuthority has an unsupported contract.',
    );
  }
  const providerScope = validateProviderScope(
    authority.providerScope,
    'awsSingleNodeDestroy.operationAuthority.providerScope',
  );
  const api = snapshotFunctions(
    authority.api,
    AUTHORITY_API_METHODS,
    'awsSingleNodeDestroy.operationAuthority.api',
  );
  const resolveScopeCapability = authority.resolveScope;
  return Object.freeze({
    providerScope,
    api,
    async resolveScope() {
      return validateProviderScope(
        await Reflect.apply(resolveScopeCapability, undefined, []),
        'awsSingleNodeDestroy.operationAuthority.resolvedScope',
      );
    },
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, string>>}
 */
function validateSshIdentity(value) {
  const identity = snapshotExactObject(
    value,
    SSH_IDENTITY_KEYS,
    'awsSingleNodeDestroy.sshIdentity',
  );
  return Object.freeze({
    privateKeyPath: canonicalAbsolutePath(
      identity.privateKeyPath,
      'awsSingleNodeDestroy.sshIdentity.privateKeyPath',
    ),
    publicKey: identity.publicKey,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    knownHostsPath: canonicalAbsolutePath(
      identity.knownHostsPath,
      'awsSingleNodeDestroy.sshIdentity.knownHostsPath',
    ),
  });
}

/**
 * @param {Readonly<Record<string, any>>} authority
 * @param {Readonly<Record<string, any>>} expected
 */
async function authenticateAuthorityScope(authority, expected) {
  const observed = await authority.resolveScope();
  if (
    authority.providerScope.providerScopeId !== expected.providerScopeId ||
    observed.providerScopeId !== expected.providerScopeId ||
    observed.providerScopeId !== authority.providerScope.providerScopeId
  ) {
    throw new Error(
      'awsSingleNodeDestroy ambient credentials do not match durable provider scope.',
    );
  }
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @param {Readonly<Record<string, any>>} journal
 * @returns {Readonly<Record<string, any>>}
 */
function validateReconciliationResult(value, intent, journal) {
  const result = snapshotExactObject(
    value,
    RECONCILIATION_RESULT_KEYS,
    'awsSingleNodeDestroy.reconciliationResult',
  );
  if (
    result.schemaVersion !==
      AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_SCHEMA_VERSION ||
    result.kind !==
      AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND ||
    result.status !== 'reconciled' ||
    result.provisioningIntentId !== intent.provisioningIntentId ||
    result.planId !== intent.plan.planId ||
    result.deploymentInstanceId !== journal.deploymentInstanceId ||
    result.incarnationId !== journal.incarnationId
  ) {
    throw new Error(
      'awsSingleNodeDestroy prepared-create reconciliation does not match durable authority.',
    );
  }
  const resources = snapshotExactObject(
    result.resources,
    RECONCILIATION_RESOURCE_KEYS,
    'awsSingleNodeDestroy.reconciliationResult.resources',
  );
  const recovery = getSingleNodeDeploymentProvisioningRecoveryState(journal);
  if (
    resources.securityGroupId !== recovery.storedResourceIds.securityGroup ||
    resources.instanceId !== recovery.storedResourceIds.instance ||
    resources.rootVolumeId !== recovery.storedResourceIds.rootVolume ||
    journal.mutationAttempts.some(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.state === 'prepared',
    )
  ) {
    throw new Error(
      'awsSingleNodeDestroy prepared-create recovery did not establish exact durable resource authority.',
    );
  }
  return Object.freeze(result);
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
    'awsSingleNodeDestroy.destructionResult',
  );
  if (
    result.schemaVersion !==
      AWS_SINGLE_NODE_DESTRUCTION_RESULT_SCHEMA_VERSION ||
    result.kind !== AWS_SINGLE_NODE_DESTRUCTION_RESULT_KIND ||
    result.status !== 'destroyed' ||
    result.provisioningIntentId !== intent.provisioningIntentId ||
    result.planId !== intent.plan.planId ||
    result.providerSpecId !== intent.plan.providerSpec.providerSpecId ||
    result.deploymentInstanceId !== journal.deploymentInstanceId ||
    result.incarnationId !== journal.incarnationId
  ) {
    throw new Error(
      'awsSingleNodeDestroy result does not match its durable authority.',
    );
  }
  const resources = snapshotExactObject(
    result.resources,
    new Set(DESTRUCTION_ROLES),
    'awsSingleNodeDestroy.destructionResult.resources',
  );
  const recovery = getSingleNodeDeploymentDestructionRecoveryState(journal);
  for (const role of DESTRUCTION_ROLES) {
    const resource = snapshotExactObject(
      resources[role],
      DESTRUCTION_RESOURCE_KEYS,
      `awsSingleNodeDestroy.destructionResult.resources.${role}`,
    );
    const expectedDeletion = recovery.storedDeletionRecords[role];
    if (
      resource.providerResourceId !== recovery.storedResourceIds[role] ||
      resource.state !== 'absent' ||
      resource.deletionId !== (expectedDeletion?.deletionId ?? null)
    ) {
      throw new Error(
        `awsSingleNodeDestroy ${role} result does not match durable absence evidence.`,
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
    schemaVersion: AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
    provider: 'aws',
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
 * @param {Function} capability
 * @param {unknown} value
 * @returns {Promise<any>}
 */
async function invoke(capability, value) {
  return await Reflect.apply(capability, undefined, [value]);
}

/**
 * Create the testable AWS destroy composition root.
 * @param {unknown} dependencies
 * @returns {Readonly<{destroy(value: unknown): Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeDestroyCoordinator(dependencies) {
  const ports = validateDependencies(dependencies);

  return Object.freeze({
    /**
     * Destroy or recover one exact locally authorized AWS deployment.
     * @param {unknown} value
     * @returns {Promise<Readonly<Record<string, any>>>}
     */
    async destroy(value) {
      const input = validateInput(value);
      /** @type {undefined|(() => Promise<void>)} */
      let release;
      /** @type {undefined|(() => Promise<void>)} */
      let closeAuthority;
      let succeeded = false;
      /** @type {unknown} */
      let operationError;
      /** @type {Readonly<Record<string, any>>|undefined} */
      let result;

      try {
        release = await invoke(
          ports.acquireOperationLock,
          input.deploymentInstanceId,
        );
        if (typeof release !== 'function') {
          throw new TypeError(
            'awsSingleNodeDestroy operation lock must return release().',
          );
        }

        const journalStore = validateJournalStore(
          Reflect.apply(ports.createJournalStore, undefined, [input]),
        );
        await Reflect.apply(journalStore.prepareStorage, undefined, []);
        const stored = await Reflect.apply(journalStore.read, undefined, []);
        if (stored === null) {
          throw new Error(
            'awsSingleNodeDestroy has no durable local deployment authority.',
          );
        }
        let journal = validateSingleNodeDeploymentJournal(stored);
        if (
          journal.deploymentInstanceId !== input.deploymentInstanceId ||
          journal.desired.intent.appId !== input.appId ||
          journal.desired.intent.provider.kind !== 'aws' ||
          journal.providerIntent.provider !== 'aws'
        ) {
          throw new Error(
            'awsSingleNodeDestroy journal conflicts with the requested deployment.',
          );
        }
        if (journal.phase === 'destroyed') {
          result = createResult(journal);
          succeeded = true;
        } else {
          const intent = journal.providerIntent.intent;
          const providerScope = validateProviderScope(
            intent.plan.providerSpec.providerScope,
            'awsSingleNodeDestroy.durableProviderScope',
          );
          const openedAuthority = await invoke(ports.createOperationAuthority, {
            region: providerScope.region,
          });
          closeAuthority = createAuthorityCloser(openedAuthority);
          const rawAuthority = snapshotExactObject(
            openedAuthority,
            AUTHORITY_KEYS,
            'awsSingleNodeDestroy.operationAuthority',
          );
          const authority = validateAuthoritySnapshot(rawAuthority);
          await authenticateAuthorityScope(authority, providerScope);

          /**
           * @param {Readonly<Record<string, any>>} next
           */
          async function commit(next) {
            if (next.journalId === journal.journalId) return;
            const committed = validateSingleNodeDeploymentJournal(
              await Reflect.apply(journalStore.commit, undefined, [
                {
                  expectedGeneration: journal.generation,
                  expectedJournalId: journal.journalId,
                  next,
                },
              ]),
            );
            if (committed.journalId !== next.journalId) {
              throw new Error(
                'awsSingleNodeDestroy journal commit returned a conflicting successor.',
              );
            }
            journal = committed;
          }

          const prepared = journal.mutationAttempts.filter(
            (/** @type {Record<string, any>} */ attempt) =>
              attempt.state === 'prepared',
          );
          if (prepared.length > 0) {
            const needsCloudInit = prepared.some(
              (/** @type {Record<string, any>} */ attempt) =>
                ['instance', 'rootVolume'].includes(attempt.role),
            );
            /** @type {Buffer|null} */
            let cloudInitBytes = null;
            if (needsCloudInit) {
              const identity = validateSshIdentity(
                await invoke(ports.ensureSshIdentity, {
                  dataRoot: input.dataRoot,
                  deploymentInstanceId: journal.deploymentInstanceId,
                  incarnationId: journal.incarnationId,
                }),
              );
              const cloudInit = createSingleNodeCloudInit({
                deploymentInstanceId: journal.deploymentInstanceId,
                incarnationId: journal.incarnationId,
                publicKey: identity.publicKey,
                publicKeyFingerprint: identity.publicKeyFingerprint,
              });
              if (
                cloudInit.digest.algorithm !==
                  intent.cloudInitDigest.algorithm ||
                cloudInit.digest.value !== intent.cloudInitDigest.value
              ) {
                throw new Error(
                  'awsSingleNodeDestroy SSH identity conflicts with durable cloud-init authority.',
                );
              }
              cloudInitBytes = cloudInit.bytes;
            }
            const provisioningRecovery =
              getSingleNodeDeploymentProvisioningRecoveryState(journal);
            const reconciled = await invoke(ports.reconcilePreparedCreates, {
              intent,
              cloudInitBytes,
              storedResourceIds: provisioningRecovery.storedResourceIds,
              storedMutationAttempts:
                provisioningRecovery.storedMutationAttempts,
              api: authority.api,
              recordMutationAttempts: async (
                /** @type {unknown} */ attempts,
              ) => {
                await commit(
                  prepareSingleNodeDeploymentMutations(journal, attempts),
                );
              },
              recordResource: async (/** @type {unknown} */ resourceRecord) => {
                await commit(
                  completeSingleNodeDeploymentMutation(journal, resourceRecord),
                );
              },
            });
            validateReconciliationResult(reconciled, intent, journal);
          }

          if (
            journal.mutationAttempts.some(
              (/** @type {Record<string, any>} */ attempt) =>
                attempt.state === 'prepared',
            )
          ) {
            throw new Error(
              'awsSingleNodeDestroy cannot destroy while a prepared create remains unresolved.',
            );
          }
          if (journal.phase !== 'destroying') {
            await commit(
              advanceSingleNodeDeploymentJournal(journal, 'destroying'),
            );
          }

          const destructionRecovery =
            getSingleNodeDeploymentDestructionRecoveryState(journal);
          const destroyed = await invoke(ports.convergeDestruction, {
            intent,
            storedResourceIds: destructionRecovery.storedResourceIds,
            storedDestroyAttempts: destructionRecovery.storedDestroyAttempts,
            storedDeletionRecords: destructionRecovery.storedDeletionRecords,
            api: authority.api,
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

      /** @type {unknown[]} */
      const cleanupErrors = [];
      if (closeAuthority !== undefined) {
        try {
          await closeAuthority();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (release !== undefined) {
        try {
          await Reflect.apply(release, undefined, []);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (!succeeded && cleanupErrors.length > 0) {
        throw new AggregateError(
          [operationError, ...cleanupErrors],
          'AWS single-node destroy failed and local cleanup was incomplete.',
        );
      }
      if (!succeeded) throw operationError;
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          'AWS single-node destroy local cleanup was incomplete.',
        );
      }
      return /** @type {Readonly<Record<string, any>>} */ (result);
    },
  });
}

/**
 * Build production destruction with ambient refreshable AWS credentials.
 * @returns {ReturnType<typeof createAwsSingleNodeDestroyCoordinator>}
 */
export function createProductionAwsSingleNodeDestroyCoordinator() {
  const runProcess = createBoundedProcessRunner();
  return createAwsSingleNodeDestroyCoordinator({
    acquireOperationLock: acquireSingleNodeDeploymentOperationLock,
    createOperationAuthority: createAwsSingleNodeOperationAuthority,
    createJournalStore: createSingleNodeDeploymentJournalStore,
    ensureSshIdentity: async (/** @type {Record<string, any>} */ value) =>
      await createDeploymentSshIdentityStore({
        root: path.join(value.dataRoot, 'single-node-deployment-ssh', 'v1'),
        runProcess,
      }).ensureIdentity({
        deploymentInstanceId: value.deploymentInstanceId,
        incarnationId: value.incarnationId,
      }),
    reconcilePreparedCreates: reconcileAwsSingleNodePreparedCreatesForDestroy,
    convergeDestruction: convergeAwsSingleNodeDestruction,
  });
}

export default {
  AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
  AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
  createAwsSingleNodeDestroyCoordinator,
  createProductionAwsSingleNodeDestroyCoordinator,
};
