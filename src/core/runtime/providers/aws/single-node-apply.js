/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow composition root keeps its complete injected effect protocol beside the implementation. */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';
import path from 'node:path';

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
  prepareSingleNodeDeploymentMutations,
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
import { validateProviderScope } from '../../deployment-provider-scope.js';
import { createAwsSingleNodeReadAuthority } from './authority.js';
import { createAwsSingleNodeOperationAuthority } from './operation-authority.js';
import {
  convergeAwsSingleNodeProvisioning,
  verifyAwsSingleNodeProvisioning,
} from './single-node-provisioning.js';
import {
  resolveAwsSingleNodePlan,
  validateAwsSingleNodePlan,
} from './single-node-plan.js';
import { createAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

export const AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_APPLY_RESULT_KIND = 'awsSingleNodeApplyResult';

const APPLY_COMMON_KEYS = new Set([
  'revision',
  'artifactRecord',
  'observation',
  'dataRoot',
]);
const DEPENDENCY_KEYS = new Set([
  'acquireOperationLock',
  'createReadAuthority',
  'createOperationAuthority',
  'resolvePlan',
  'createJournalStore',
  'ensureSshIdentity',
  'convergeProvisioning',
  'verifyProvisioning',
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
const AUTHORITY_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerScope',
  'api',
  'resolveScope',
  'close',
]);
const PLAN_READ_METHODS = Object.freeze([
  'describeImages',
  'describeInstanceAttribute',
  'describeInstanceTypeOfferings',
  'describeInstances',
  'describeInternetGateways',
  'describeNetworkAcls',
  'describeRouteTables',
  'describeSecurityGroups',
  'describeSubnets',
  'describeVolumes',
  'describeVpcs',
  'describeInstanceCreditSpecifications',
]);
const PROVISIONING_READ_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstances',
  'describeVolumes',
  'describeInstanceCreditSpecifications',
]);
const PROVISIONING_MUTATION_METHODS = Object.freeze([
  'createSecurityGroup',
  'authorizeSecurityGroupIngress',
  'runInstances',
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
  'securityGroupId',
  'instanceId',
  'rootVolumeId',
]);
const SSH_HOST_KEYS = new Set(['address', 'algorithm', 'fingerprint']);
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/u;
const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8,32}$/u;
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/u;

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
 * @param {RegExp} pattern
 * @param {string} valuePath
 * @returns {string}
 */
function providerId(value, pattern, valuePath) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${valuePath} must be a canonical AWS resource ID.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function validateSshIdentity(value) {
  const identity = snapshotExactObject(
    value,
    SSH_IDENTITY_KEYS,
    'awsSingleNodeApply.sshIdentity',
  );
  return Object.freeze({
    privateKeyPath: canonicalAbsolutePath(
      identity.privateKeyPath,
      'awsSingleNodeApply.sshIdentity.privateKeyPath',
    ),
    publicKey: identity.publicKey,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    knownHostsPath: canonicalAbsolutePath(
      identity.knownHostsPath,
      'awsSingleNodeApply.sshIdentity.knownHostsPath',
    ),
  });
}

/**
 * @param {Record<string, any>} source
 * @param {Record<string, any>} target
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
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function validateApplyInput(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeApply input must be an exact object.');
  }
  const object = /** @type {Record<string, any>} */ (value);
  const hasIntent = Object.hasOwn(object, 'intent');
  const hasDesired = Object.hasOwn(object, 'desired');
  const hasArtifactPath = Object.hasOwn(object, 'artifactPath');
  const hasArtifactSource = Object.hasOwn(object, 'artifactSource');
  if (hasIntent === hasDesired || hasArtifactPath === hasArtifactSource) {
    throw new TypeError(
      'awsSingleNodeApply requires exactly one intent or desired and exactly one artifactPath or artifactSource.',
    );
  }
  const expected = new Set([
    ...APPLY_COMMON_KEYS,
    hasIntent ? 'intent' : 'desired',
    hasArtifactPath ? 'artifactPath' : 'artifactSource',
  ]);
  const input = snapshotExactObject(value, expected, 'awsSingleNodeApply');
  const suppliedDesired = hasDesired
    ? validateSingleNodeDeploymentDesired(
        input.desired,
        'awsSingleNodeApply.desired',
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
      'awsSingleNodeApply desired state does not match the held artifact authority.',
    );
  }
  if (observedDesired.intent.provider.kind !== 'aws') {
    throw new TypeError('awsSingleNodeApply desired state must target AWS.');
  }
  const dataRoot = canonicalAbsolutePath(
    input.dataRoot,
    'awsSingleNodeApply.dataRoot',
  );
  if (hasArtifactPath) {
    return Object.freeze({
      desired: observedDesired,
      dataRoot,
      artifactPath: canonicalAbsolutePath(
        input.artifactPath,
        'awsSingleNodeApply.artifactPath',
      ),
    });
  }
  const source = snapshotExactObject(
    input.artifactSource,
    HELD_SOURCE_KEYS,
    'awsSingleNodeApply.artifactSource',
  );
  for (const name of ['createReadStream', 'verifyUnchanged', 'close']) {
    if (typeof source[name] !== 'function') {
      throw new TypeError(
        `awsSingleNodeApply.artifactSource.${name} must be a function.`,
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
      'awsSingleNodeApply artifactSource does not match its held observation.',
    );
  }
  return Object.freeze({
    desired: observedDesired,
    dataRoot,
    artifactSource: guardHeldSource(
      source,
      /** @type {Record<string, any>} */ (input.artifactSource),
    ),
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
 * @param {'read'|'operation'} mode
 * @param {Readonly<Record<string, any>>} lifecycle
 * @returns {Readonly<Record<string, any>>}
 */
function validateAuthority(value, mode, lifecycle) {
  const pathName = `awsSingleNodeApply.${mode}Authority`;
  const authority = snapshotExactObject(value, AUTHORITY_KEYS, pathName);
  const expectedKind =
    mode === 'read'
      ? 'awsSingleNodeReadAuthority'
      : 'awsSingleNodeOperationAuthority';
  if (authority.schemaVersion !== 1 || authority.kind !== expectedKind) {
    throw new TypeError(`${pathName} has an unsupported contract.`);
  }
  const providerScope = validateProviderScope(
    authority.providerScope,
    `${pathName}.providerScope`,
  );
  const api = snapshotFunctions(
    authority.api,
    mode === 'read'
      ? PLAN_READ_METHODS
      : [...PROVISIONING_READ_METHODS, ...PROVISIONING_MUTATION_METHODS],
    `${pathName}.api`,
  );
  if (
    typeof authority.resolveScope !== 'function' ||
    authority.close !== lifecycle.capability
  ) {
    throw new TypeError(`${pathName} lifecycle methods are invalid.`);
  }
  return Object.freeze({
    providerScope,
    api,
    async resolveScope() {
      return validateProviderScope(
        await Reflect.apply(authority.resolveScope, undefined, []),
        `${pathName}.resolvedScope`,
      );
    },
    close: lifecycle.close,
  });
}

/**
 * @param {Readonly<Record<string, any>>} authority
 * @param {string|null} expectedScopeId
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function authenticateAuthorityScope(authority, expectedScopeId) {
  const observed = await authority.resolveScope();
  if (
    observed.providerScopeId !== authority.providerScope.providerScopeId ||
    (expectedScopeId !== null && observed.providerScopeId !== expectedScopeId)
  ) {
    throw new Error(
      'awsSingleNodeApply ambient credentials do not match durable provider scope.',
    );
  }
  return observed;
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
    'awsSingleNodeApply.provisioningResult',
  );
  const resources = snapshotExactObject(
    result.resources,
    PROVISIONING_RESOURCE_KEYS,
    'awsSingleNodeApply.provisioningResult.resources',
  );
  if (
    result.schemaVersion !== 1 ||
    result.kind !== 'awsSingleNodeProvisioningResult' ||
    result.status !== 'provisioned' ||
    result.provisioningIntentId !== intent.provisioningIntentId ||
    result.planId !== intent.plan.planId ||
    result.providerSpecId !== intent.plan.providerSpec.providerSpecId ||
    result.desiredRevisionId !== intent.plan.desired.desiredRevisionId ||
    result.deploymentInstanceId !== intent.plan.deploymentInstanceId ||
    result.incarnationId !== intent.incarnationId
  ) {
    throw new Error(
      'awsSingleNodeApply provisioning result does not match durable intent.',
    );
  }
  if (
    typeof result.publicIpv4 !== 'string' ||
    !isIPv4(result.publicIpv4) ||
    result.publicIpv4 !== result.publicIpv4.split('.').map(Number).join('.')
  ) {
    throw new TypeError(
      'awsSingleNodeApply provisioning result has an invalid public IPv4 address.',
    );
  }
  return Object.freeze({
    ...result,
    resources: Object.freeze({
      securityGroupId: providerId(
        resources.securityGroupId,
        SECURITY_GROUP_ID_PATTERN,
        'awsSingleNodeApply.provisioningResult.resources.securityGroupId',
      ),
      instanceId: providerId(
        resources.instanceId,
        INSTANCE_ID_PATTERN,
        'awsSingleNodeApply.provisioningResult.resources.instanceId',
      ),
      rootVolumeId: providerId(
        resources.rootVolumeId,
        VOLUME_ID_PATTERN,
        'awsSingleNodeApply.provisioningResult.resources.rootVolumeId',
      ),
    }),
  });
}

/**
 * @param {Readonly<Record<string, any>>} result
 * @param {Readonly<Record<string, any>>} journal
 */
function assertProvisioningResultMatchesJournal(result, journal) {
  /** @type {Record<string, string>} */
  const ids = {
    securityGroup: result.resources.securityGroupId,
    instance: result.resources.instanceId,
    rootVolume: result.resources.rootVolumeId,
  };
  for (const role of ['securityGroup', 'instance', 'rootVolume']) {
    const resource = journal.resources.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === role,
    );
    if (
      resource?.state !== 'present' ||
      resource.providerResourceId !== ids[role] ||
      (role === 'instance'
        ? resource.publicIpv4 !== result.publicIpv4
        : resource.publicIpv4 !== null)
    ) {
      throw new Error(
        'awsSingleNodeApply provider verification conflicts with durable resource authority.',
      );
    }
  }
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
    'awsSingleNodeApply.sshHost',
  );
  if (
    host.address !== address ||
    host.algorithm !== 'ssh-ed25519' ||
    typeof host.fingerprint !== 'string' ||
    !SSH_FINGERPRINT_PATTERN.test(host.fingerprint)
  ) {
    throw new Error(
      'awsSingleNodeApply SSH host key does not match its provider address.',
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
    'awsSingleNodeApply dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `awsSingleNodeApply dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
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
 * Capture only an own data-property close capability before inspecting the
 * rest of an opened authority. Exact contract validation can then fail
 * without leaking authority-local resources.
 * @param {unknown} value
 * @param {'read'|'operation'} mode
 * @returns {Readonly<Record<string, any>>}
 */
function captureAuthorityLifecycle(value, mode) {
  const valuePath = `awsSingleNodeApply.${mode}Authority.close`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an own function.`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'close');
  if (
    !descriptor ||
    !Object.hasOwn(descriptor, 'value') ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`${valuePath} must be an own function.`);
  }
  const capability = descriptor.value;
  /** @type {Promise<void>|undefined} */
  let closePromise;
  return Object.freeze({
    capability,
    close() {
      if (closePromise === undefined) {
        closePromise = Promise.resolve().then(
          async () => await Reflect.apply(capability, undefined, []),
        );
      }
      return closePromise;
    },
  });
}

/**
 * Open and immediately register cleanup before exact authority validation.
 * @param {Function} createAuthority
 * @param {unknown} request
 * @param {'read'|'operation'} mode
 * @param {Readonly<Record<string, any>>[]} lifecycles
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function openAuthority(createAuthority, request, mode, lifecycles) {
  const value = await invoke(createAuthority, request);
  const lifecycle = captureAuthorityLifecycle(value, mode);
  lifecycles.push(lifecycle);
  return validateAuthority(value, mode, lifecycle);
}

/**
 * Create the AWS single-node apply composition root.
 * @param {unknown} dependencies
 * @returns {Readonly<{apply(value: unknown): Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeApplyCoordinator(dependencies) {
  const ports = validateDependencies(dependencies);

  return Object.freeze({
    /**
     * @param {unknown} value
     * @returns {Promise<Readonly<Record<string, any>>>}
     */
    async apply(value) {
      const input = validateApplyInput(value);
      const desired = input.desired;
      /** @type {undefined|(() => Promise<void>)} */
      let release;
      /** @type {Readonly<Record<string, any>>[]} */
      const authorities = [];
      let succeeded = false;
      /** @type {unknown} */
      let operationError;
      /** @type {Readonly<Record<string, any>>|undefined} */
      let result;

      try {
        release = await invoke(
          ports.acquireOperationLock,
          desired.deploymentInstanceId,
        );
        if (typeof release !== 'function') {
          throw new TypeError(
            'awsSingleNodeApply operation lock must return release().',
          );
        }
        const journalStore = Reflect.apply(
          ports.createJournalStore,
          undefined,
          [
            {
              appId: desired.intent.appId,
              deploymentInstanceId: desired.deploymentInstanceId,
              dataRoot: input.dataRoot,
            },
          ],
        );
        if (
          journalStore === null ||
          typeof journalStore !== 'object' ||
          typeof journalStore.prepareStorage !== 'function' ||
          typeof journalStore.read !== 'function' ||
          typeof journalStore.initialize !== 'function' ||
          typeof journalStore.commit !== 'function'
        ) {
          throw new TypeError('awsSingleNodeApply journal store is invalid.');
        }
        await Reflect.apply(journalStore.prepareStorage, journalStore, []);
        let journalValue = await Reflect.apply(
          journalStore.read,
          journalStore,
          [],
        );
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
            'awsSingleNodeApply durable desired state conflicts with this apply.',
          );
        }
        if (
          journal !== null &&
          (journal.providerIntent.provider !== 'aws' ||
            ['destroying', 'destroyed'].includes(journal.phase))
        ) {
          throw new Error(
            'awsSingleNodeApply cannot resume this deployment journal.',
          );
        }

        /** @type {Readonly<Record<string, any>>|null} */
        let observedPlan = null;
        /** @type {Readonly<Record<string, any>>} */
        let authority;
        if (journal === null) {
          const readAuthority = await openAuthority(
            ports.createReadAuthority,
            {
              region: desired.intent.provider.region,
            },
            'read',
            authorities,
          );
          const providerScope = await authenticateAuthorityScope(
            readAuthority,
            null,
          );
          observedPlan = validateAwsSingleNodePlan(
            await invoke(ports.resolvePlan, {
              desired,
              providerScope,
              api: readAuthority.api,
            }),
          );
          if (
            observedPlan.deploymentInstanceId !==
              desired.deploymentInstanceId ||
            observedPlan.desired.desiredRevisionId !==
              desired.desiredRevisionId ||
            observedPlan.providerSpec.providerScope.providerScopeId !==
              providerScope.providerScopeId
          ) {
            throw new Error(
              'awsSingleNodeApply observed plan conflicts with desired scope.',
            );
          }
          if (observedPlan.status !== 'actionable') {
            throw new Error(
              'awsSingleNodeApply found provider resources without durable local authority.',
            );
          }
          await readAuthority.close();

          const operationAuthority = await openAuthority(
            ports.createOperationAuthority,
            {
              region: desired.intent.provider.region,
            },
            'operation',
            authorities,
          );
          await authenticateAuthorityScope(
            operationAuthority,
            providerScope.providerScopeId,
          );
          authority = operationAuthority;
        } else {
          const expectedScopeId =
            journal.providerIntent.intent.plan.providerSpec.providerScope
              .providerScopeId;
          const mode = ['planned', 'provisioning'].includes(journal.phase)
            ? 'operation'
            : 'read';
          authority = await openAuthority(
            mode === 'operation'
              ? ports.createOperationAuthority
              : ports.createReadAuthority,
            { region: desired.intent.provider.region },
            mode,
            authorities,
          );
          await authenticateAuthorityScope(authority, expectedScopeId);
        }

        const incarnationId =
          journal === null
            ? createSingleNodeDeploymentIncarnationId(
                snapshotEntropy(
                  Reflect.apply(ports.randomBytes, undefined, [32]),
                  32,
                  'awsSingleNodeApply incarnation entropy',
                ),
              )
            : journal.incarnationId;
        const sshIdentity = validateSshIdentity(
          await invoke(ports.ensureSshIdentity, {
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
          providerIntent = createAwsSingleNodeProvisioningIntent({
            plan: /** @type {Readonly<Record<string, any>>} */ (observedPlan),
            incarnationId,
            cloudInitDigest: cloudInit.digest,
          });
          journalValue = await Reflect.apply(
            journalStore.initialize,
            journalStore,
            [
              {
                desired,
                providerIntent: { provider: 'aws', intent: providerIntent },
              },
            ],
          );
          journal = validateSingleNodeDeploymentJournal(journalValue);
        } else {
          providerIntent = journal.providerIntent.intent;
          if (
            cloudInit.digest.algorithm !==
              providerIntent.cloudInitDigest.algorithm ||
            cloudInit.digest.value !== providerIntent.cloudInitDigest.value
          ) {
            throw new Error(
              'awsSingleNodeApply SSH identity conflicts with durable cloud-init authority.',
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
          currentJournal.providerIntent.provider !== 'aws' ||
          currentJournal.providerIntent.intent.provisioningIntentId !==
            providerIntent.provisioningIntentId
        ) {
          throw new Error(
            'awsSingleNodeApply journal initialization returned conflicting authority.',
          );
        }

        /**
         * @param {Readonly<Record<string, any>>} next
         */
        async function commit(next) {
          if (next.journalId === currentJournal.journalId) return;
          const committed = validateSingleNodeDeploymentJournal(
            await Reflect.apply(journalStore.commit, journalStore, [
              {
                expectedGeneration: currentJournal.generation,
                expectedJournalId: currentJournal.journalId,
                next,
              },
            ]),
          );
          if (committed.journalId !== next.journalId) {
            throw new Error(
              'awsSingleNodeApply journal commit returned a conflicting successor.',
            );
          }
          currentJournal = committed;
        }

        if (currentJournal.phase === 'planned') {
          await commit(
            advanceSingleNodeDeploymentJournal(currentJournal, 'provisioning'),
          );
        }

        /** @type {Readonly<Record<string, any>>} */
        let provisioned;
        if (currentJournal.phase === 'provisioning') {
          const recovery =
            getSingleNodeDeploymentProvisioningRecoveryState(currentJournal);
          provisioned = validateProvisioningResult(
            await invoke(ports.convergeProvisioning, {
              intent: providerIntent,
              cloudInitBytes: cloudInit.bytes,
              storedResourceIds: recovery.storedResourceIds,
              storedMutationAttempts: recovery.storedMutationAttempts,
              api: authority.api,
              recordMutationAttempts: async (
                /** @type {unknown} */ attempts,
              ) => {
                await commit(
                  prepareSingleNodeDeploymentMutations(
                    currentJournal,
                    attempts,
                  ),
                );
              },
              recordResource: async (/** @type {unknown} */ resourceRecord) => {
                await commit(
                  completeSingleNodeDeploymentMutation(
                    currentJournal,
                    resourceRecord,
                  ),
                );
              },
            }),
            providerIntent,
          );
          await commit(
            recordSingleNodeDeploymentResource(currentJournal, {
              provider: 'aws',
              role: 'instance',
              providerResourceId: provisioned.resources.instanceId,
              publicIpv4: provisioned.publicIpv4,
              state: 'present',
            }),
          );
          assertProvisioningResultMatchesJournal(provisioned, currentJournal);
          await commit(
            advanceSingleNodeDeploymentJournal(currentJournal, 'provisioned'),
          );
        } else {
          const recovery =
            getSingleNodeDeploymentProvisioningRecoveryState(currentJournal);
          provisioned = validateProvisioningResult(
            await invoke(ports.verifyProvisioning, {
              intent: providerIntent,
              storedResourceIds: recovery.storedResourceIds,
              storedMutationAttempts: recovery.storedMutationAttempts,
              api: authority.api,
            }),
            providerIntent,
          );
          assertProvisioningResultMatchesJournal(provisioned, currentJournal);
        }

        const instanceResource = currentJournal.resources.find(
          (/** @type {Record<string, any>} */ resource) =>
            resource.role === 'instance',
        );
        if (
          !['provisioned', 'activating', 'active'].includes(
            currentJournal.phase,
          ) ||
          instanceResource?.state !== 'present' ||
          typeof instanceResource.publicIpv4 !== 'string'
        ) {
          throw new Error(
            'awsSingleNodeApply did not reach exact provisioned address authority.',
          );
        }
        const providerAddress = instanceResource.publicIpv4;
        if (providerAddress !== provisioned.publicIpv4) {
          throw new Error(
            'awsSingleNodeApply provider address conflicts with exact readback.',
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
              await invoke(ports.enrollSshHost, {
                address: providerAddress,
                knownHostsPath: sshIdentity.knownHostsPath,
              }),
              providerAddress,
            );
            break;
          } catch {
            if (
              attempt === SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS
            ) {
              throw new Error(
                'AWS single-node SSH host key could not be established before the bounded deadline.',
              );
            }
            await invoke(
              ports.wait,
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
              'awsSingleNodeApply active SSH host conflicts with pinned authority.',
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
          await invoke(ports.activate, {
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
            'awsSingleNodeApply activation conflicts with durable evidence.',
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
            'awsSingleNodeApply did not reach active durable state.',
          );
        }
        result = Object.freeze({
          schemaVersion: AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
          kind: AWS_SINGLE_NODE_APPLY_RESULT_KIND,
          provider: 'aws',
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

      /** @type {unknown[]} */
      const cleanupErrors = [];
      for (const authority of [...authorities].reverse()) {
        try {
          await authority.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (Object.hasOwn(input, 'artifactSource')) {
        try {
          await /** @type {Record<string, any>} */ (
            input.artifactSource
          ).close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (release !== undefined) {
        try {
          await release();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (!succeeded && cleanupErrors.length > 0) {
        throw new AggregateError(
          [operationError, ...cleanupErrors],
          'AWS single-node apply failed and local cleanup was incomplete.',
        );
      }
      if (!succeeded) throw operationError;
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          'AWS single-node apply local cleanup was incomplete.',
        );
      }
      return /** @type {Readonly<Record<string, any>>} */ (result);
    },
  });
}

/**
 * Build the production AWS coordinator using only ambient credential-chain
 * authorities.
 * @returns {ReturnType<typeof createAwsSingleNodeApplyCoordinator>}
 */
export function createProductionAwsSingleNodeApplyCoordinator() {
  const runProcess = createBoundedProcessRunner();
  const activator = createSingleNodeRemoteActivator({ runProcess });
  return createAwsSingleNodeApplyCoordinator({
    acquireOperationLock: acquireSingleNodeDeploymentOperationLock,
    createReadAuthority: createAwsSingleNodeReadAuthority,
    createOperationAuthority: createAwsSingleNodeOperationAuthority,
    resolvePlan: resolveAwsSingleNodePlan,
    createJournalStore: createSingleNodeDeploymentJournalStore,
    ensureSshIdentity: async (/** @type {Record<string, any>} */ value) =>
      await createDeploymentSshIdentityStore({
        root: path.join(value.dataRoot, 'single-node-deployment-ssh', 'v1'),
        runProcess,
      }).ensureIdentity({
        deploymentInstanceId: value.deploymentInstanceId,
        incarnationId: value.incarnationId,
      }),
    convergeProvisioning: convergeAwsSingleNodeProvisioning,
    verifyProvisioning: verifyAwsSingleNodeProvisioning,
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
  AWS_SINGLE_NODE_APPLY_RESULT_KIND,
  AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
  createAwsSingleNodeApplyCoordinator,
  createProductionAwsSingleNodeApplyCoordinator,
};
