/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This narrow composition root keeps its exact read-only authority protocol beside the implementation. */

import { isIPv4 } from 'node:net';

import { validateProviderScope } from '../../deployment-provider-scope.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { validateSingleNodeDeploymentJournal } from '../../single-node-deployment-journal.js';
import { createAwsSingleNodeReadAuthority } from './authority.js';
import {
  AwsSingleNodeEvidenceConflictError,
  AwsSingleNodeEvidenceTransientError,
  AwsSingleNodeEvidenceUnknownError,
  inspectAwsSingleNodeInstance,
  inspectAwsSingleNodeRootVolume,
  inspectAwsSingleNodeSecurityGroup,
} from './single-node-evidence.js';

const INPUT_KEYS = new Set(['journal']);
const DEPENDENCY_KEYS = new Set([
  'createReadAuthority',
  'inspectSecurityGroup',
  'inspectInstance',
  'inspectRootVolume',
]);
const AUTHORITY_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerScope',
  'api',
  'resolveScope',
  'close',
]);
const INSPECTION_READ_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstances',
  'describeVolumes',
  'describeInstanceCreditSpecifications',
]);
const PUBLIC_ROLES = Object.freeze([
  Object.freeze({ internal: 'instance', public: 'instance' }),
  Object.freeze({ internal: 'rootVolume', public: 'root-volume' }),
  Object.freeze({ internal: 'securityGroup', public: 'security-group' }),
]);
const SECURITY_GROUP_OBSERVATION_KEYS = new Set([
  'status',
  'ownershipStatus',
  'specStatus',
  'securityGroupId',
  'missingIpv4',
]);
const INSTANCE_OBSERVATION_KEYS = new Set([
  'status',
  'ownershipStatus',
  'specStatus',
  'instanceId',
  'instanceState',
  'rootVolumeId',
  'publicIpv4',
]);
const ROOT_VOLUME_OBSERVATION_KEYS = new Set([
  'status',
  'ownershipStatus',
  'specStatus',
  'volumeId',
  'volumeState',
  'attachmentStatus',
]);
const AWS_ID_PATTERNS = Object.freeze({
  securityGroup: /^sg-[0-9a-f]{8,32}$/u,
  instance: /^i-[0-9a-f]{8,32}$/u,
  rootVolume: /^vol-[0-9a-f]{8,32}$/u,
});

/** Ambient AWS authority does not match the durable provider scope. */
export class AwsSingleNodeStatusScopeError extends Error {
  constructor() {
    super(
      'AWS single-node status ambient credentials do not match durable provider scope.',
    );
    this.name = 'AwsSingleNodeStatusScopeError';
    this.code = 'AWS_SINGLE_NODE_STATUS_SCOPE_MISMATCH';
  }
}

/** Provider reads could not produce trustworthy one-shot status evidence. */
export class AwsSingleNodeStatusReadError extends Error {
  constructor() {
    super('AWS single-node status could not read provider evidence.');
    this.name = 'AwsSingleNodeStatusReadError';
    this.code = 'AWS_SINGLE_NODE_STATUS_READ_FAILED';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * @param {unknown} value
 * @param {Set<string>} keys
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const ownKeys = Reflect.ownKeys(object);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  /** @type {Record<string, any>} */
  const result = {};
  for (const key of keys) {
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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Capture cleanup before inspecting the remainder of an opened authority.
 * @param {unknown} value
 * @returns {Readonly<{capability: Function, close(): Promise<void>}>}
 */
function captureLifecycle(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'awsSingleNodeStatus read authority close must be an own function.',
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
      'awsSingleNodeStatus read authority close must be an own function.',
    );
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
 * Project only evidence reads without retaining an authority-bearing receiver.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('awsSingleNodeStatus read API is invalid.');
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const api = {};
  for (const method of INSPECTION_READ_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `awsSingleNodeStatus read API.${method} must be an own function.`,
      );
    }
    const capability = descriptor.value;
    api[method] = (/** @type {unknown} */ request) =>
      Reflect.apply(capability, undefined, [request]);
  }
  return Object.freeze(api);
}

/**
 * @param {unknown} value
 * @param {Readonly<{capability: Function, close(): Promise<void>}>} lifecycle
 * @returns {Readonly<Record<string, any>>}
 */
function validateAuthority(value, lifecycle) {
  const authority = exactDataObject(
    value,
    AUTHORITY_KEYS,
    'awsSingleNodeStatus read authority',
  );
  if (
    authority.schemaVersion !== 1 ||
    authority.kind !== 'awsSingleNodeReadAuthority' ||
    typeof authority.resolveScope !== 'function' ||
    authority.close !== lifecycle.capability
  ) {
    throw new TypeError(
      'awsSingleNodeStatus read authority has an unsupported contract.',
    );
  }
  const resolveScope = authority.resolveScope;
  return Object.freeze({
    providerScope: validateProviderScope(
      authority.providerScope,
      'awsSingleNodeStatus read authority providerScope',
    ),
    api: snapshotReadApi(authority.api),
    async resolveScope() {
      return validateProviderScope(
        await Reflect.apply(resolveScope, undefined, []),
        'awsSingleNodeStatus resolved providerScope',
      );
    },
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function validateDependencies(value) {
  const dependencies = exactDataObject(
    value,
    DEPENDENCY_KEYS,
    'awsSingleNodeStatus dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `awsSingleNodeStatus dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * @param {unknown} value
 * @param {string} role
 * @returns {string|null}
 */
function optionalAwsId(value, role) {
  if (value === null) return null;
  const pattern =
    AWS_ID_PATTERNS[/** @type {keyof typeof AWS_ID_PATTERNS} */ (role)];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AwsSingleNodeStatusReadError();
  }
  return value;
}

/** @param {unknown} value @returns {string|null} */
function optionalIpv4(value) {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !isIPv4(value) ||
    value !== value.split('.').map(Number).join('.')
  ) {
    throw new AwsSingleNodeStatusReadError();
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {Readonly<{id: string|null, state: 'absent'|'settling'|'exact'|'conflict', publicIpv4: null}>}
 */
function normalizeSecurityGroup(value) {
  const observed = exactDataObject(
    value,
    SECURITY_GROUP_OBSERVATION_KEYS,
    'awsSingleNodeStatus security-group observation',
  );
  const id = optionalAwsId(observed.securityGroupId, 'securityGroup');
  let state = /** @type {'absent'|'settling'|'exact'|'conflict'} */ (
    'conflict'
  );
  if (
    observed.status === 'absent' &&
    observed.ownershipStatus === 'absent' &&
    observed.specStatus === 'absent' &&
    id === null
  ) {
    state = 'absent';
  } else if (
    observed.status === 'present' &&
    observed.ownershipStatus === 'owned' &&
    observed.specStatus === 'exact' &&
    Array.isArray(observed.missingIpv4) &&
    observed.missingIpv4.length === 0 &&
    id !== null
  ) {
    state = 'exact';
  } else if (
    observed.status === 'present' &&
    observed.ownershipStatus === 'owned' &&
    observed.specStatus === 'incomplete' &&
    Array.isArray(observed.missingIpv4) &&
    observed.missingIpv4.length > 0 &&
    id !== null
  ) {
    state = 'settling';
  }
  return Object.freeze({ id, state, publicIpv4: null });
}

/**
 * @param {unknown} value
 * @returns {Readonly<{id: string|null, rootVolumeId: string|null, state: 'absent'|'settling'|'exact'|'conflict', publicIpv4: string|null}>}
 */
function normalizeInstance(value) {
  const observed = exactDataObject(
    value,
    INSTANCE_OBSERVATION_KEYS,
    'awsSingleNodeStatus instance observation',
  );
  const id = optionalAwsId(observed.instanceId, 'instance');
  const rootVolumeId = optionalAwsId(observed.rootVolumeId, 'rootVolume');
  const publicIpv4 = optionalIpv4(observed.publicIpv4);
  let state = /** @type {'absent'|'settling'|'exact'|'conflict'} */ (
    'conflict'
  );
  if (
    observed.status === 'absent' &&
    observed.ownershipStatus === 'absent' &&
    observed.specStatus === 'absent' &&
    id === null &&
    rootVolumeId === null &&
    publicIpv4 === null
  ) {
    state = 'absent';
  } else if (
    observed.status === 'present' &&
    observed.ownershipStatus === 'owned' &&
    observed.specStatus === 'exact' &&
    observed.instanceState === 'running' &&
    id !== null &&
    rootVolumeId !== null &&
    publicIpv4 !== null
  ) {
    state = 'exact';
  } else if (
    observed.status === 'terminal' &&
    observed.ownershipStatus === 'owned' &&
    ['shutting-down', 'terminated'].includes(observed.instanceState) &&
    id !== null
  ) {
    // EC2 retains terminal instance tombstones after destruction has already
    // accepted them as authoritative absence.
    state = 'absent';
  } else if (
    observed.ownershipStatus === 'owned' &&
    id !== null &&
    (observed.status === 'settling' || observed.specStatus === 'incomplete')
  ) {
    state = 'settling';
  }
  return Object.freeze({
    id,
    rootVolumeId,
    state,
    publicIpv4: state === 'absent' ? null : publicIpv4,
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<{id: string|null, state: 'absent'|'settling'|'exact'|'conflict', publicIpv4: null}>}
 */
function normalizeRootVolume(value) {
  const observed = exactDataObject(
    value,
    ROOT_VOLUME_OBSERVATION_KEYS,
    'awsSingleNodeStatus root-volume observation',
  );
  const id = optionalAwsId(observed.volumeId, 'rootVolume');
  let state = /** @type {'absent'|'settling'|'exact'|'conflict'} */ (
    'conflict'
  );
  if (
    observed.status === 'absent' &&
    observed.ownershipStatus === 'absent' &&
    observed.specStatus === 'absent' &&
    id === null
  ) {
    state = 'absent';
  } else if (
    observed.status === 'present' &&
    observed.ownershipStatus === 'owned' &&
    observed.specStatus === 'exact' &&
    observed.volumeState === 'in-use' &&
    observed.attachmentStatus === 'expected' &&
    id !== null
  ) {
    state = 'exact';
  } else if (
    observed.ownershipStatus === 'owned' &&
    id !== null &&
    (['settling', 'available', 'deleting'].includes(observed.status) ||
      observed.specStatus === 'incomplete')
  ) {
    state = 'settling';
  }
  return Object.freeze({ id, state, publicIpv4: null });
}

/**
 * @param {Function} inspect
 * @param {Readonly<Record<string, any>>} input
 * @param {(value: unknown) => Readonly<Record<string, any>>} normalize
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function inspectSafely(inspect, input, normalize) {
  try {
    return normalize(await Reflect.apply(inspect, undefined, [input]));
  } catch (error) {
    if (error instanceof AwsSingleNodeEvidenceConflictError) {
      return Object.freeze({
        id: null,
        state: /** @type {const} */ ('conflict'),
        publicIpv4: null,
      });
    }
    if (
      error instanceof AwsSingleNodeEvidenceTransientError ||
      error instanceof AwsSingleNodeEvidenceUnknownError ||
      error instanceof AwsSingleNodeStatusReadError
    ) {
      throw new AwsSingleNodeStatusReadError();
    }
    throw new AwsSingleNodeStatusReadError();
  }
}

/**
 * @param {Readonly<Record<string, any>>} journal
 * @param {string} role
 * @returns {Readonly<Record<string, any>>|null}
 */
function durableResource(journal, role) {
  return (
    journal.resources.find(
      (/** @type {Readonly<Record<string, any>>} */ resource) =>
        resource.role === role,
    ) ?? null
  );
}

/**
 * @param {Readonly<Record<string, any>>} journal
 * @param {string} role
 * @returns {Readonly<Record<string, any>>|null}
 */
function durableAttempt(journal, role) {
  return (
    journal.mutationAttempts.find(
      (/** @type {Readonly<Record<string, any>>} */ attempt) =>
        attempt.role === role,
    ) ?? null
  );
}

/**
 * @param {Readonly<Record<string, any>>} journal
 * @param {string} role
 * @param {Readonly<Record<string, any>>} observed
 * @returns {Readonly<Record<string, any>>}
 */
function bindResource(journal, role, observed) {
  const durable = durableResource(journal, role);
  const attempt = durableAttempt(journal, role);
  const durableId = durable?.providerResourceId ?? null;
  const id = durableId ?? observed.id;
  let state = observed.state;

  if (
    (durableId !== null && observed.id !== null && durableId !== observed.id) ||
    (durable !== null &&
      durable.publicIpv4 !== null &&
      observed.publicIpv4 !== null &&
      durable.publicIpv4 !== observed.publicIpv4)
  ) {
    state = 'conflict';
  } else if (durable === null && observed.state === 'absent') {
    state = attempt === null ? 'absent' : 'settling';
  } else if (
    durable === null &&
    attempt !== null &&
    ['provisioning', 'destroying'].includes(journal.phase)
  ) {
    state = observed.state;
  } else if (durable === null) {
    state = 'conflict';
  }

  return Object.freeze({
    id,
    state,
    publicIpv4: state === 'conflict' ? null : observed.publicIpv4,
  });
}

/**
 * @param {Readonly<Record<string, any>>} journal
 * @param {Readonly<Record<string, Readonly<Record<string, any>>>>} observation
 * @returns {Readonly<Record<string, any>>}
 */
function createResult(journal, observation) {
  const resources = PUBLIC_ROLES.map(({ internal, public: publicRole }) => {
    const resource = bindResource(journal, internal, observation[internal]);
    return Object.freeze({
      role: publicRole,
      id: resource.id,
      state: resource.state,
      publicIpv4: resource.publicIpv4,
    });
  });
  const states = resources.map((resource) => resource.state);
  const result = deepFreeze({
    status: states.includes('conflict')
      ? 'degraded'
      : states.includes('settling')
        ? 'converging'
        : 'exact',
    resources,
  });
  assertManifestIsSecretFree(result, 'awsSingleNodeStatus.result');
  return result;
}

/**
 * Create a one-shot, structurally read-only AWS status operation.
 * @param {unknown} dependencies
 * @returns {(value: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createAwsSingleNodeStatusFactory(dependencies) {
  const ports = validateDependencies(dependencies);

  return async function inspect(value) {
    const input = exactDataObject(value, INPUT_KEYS, 'awsSingleNodeStatus');
    const journal = validateSingleNodeDeploymentJournal(
      input.journal,
      'awsSingleNodeStatus.journal',
    );
    if (journal.providerIntent.provider !== 'aws') {
      throw new TypeError('awsSingleNodeStatus journal must target AWS.');
    }
    const expectedScope = validateProviderScope(
      journal.providerIntent.intent.plan.providerSpec.providerScope,
      'awsSingleNodeStatus durable providerScope',
    );

    /** @type {Readonly<{capability: Function, close(): Promise<void>}>|undefined} */
    let lifecycle;
    /** @type {unknown} */
    let operationError;
    /** @type {Readonly<Record<string, any>>|undefined} */
    let result;
    try {
      const opened = await Reflect.apply(ports.createReadAuthority, undefined, [
        { region: expectedScope.region },
      ]);
      lifecycle = captureLifecycle(opened);
      const authority = validateAuthority(opened, lifecycle);
      const resolvedScope = await authority.resolveScope();
      if (
        authority.providerScope.providerScopeId !==
          expectedScope.providerScopeId ||
        resolvedScope.providerScopeId !==
          authority.providerScope.providerScopeId ||
        resolvedScope.providerScopeId !== expectedScope.providerScopeId
      ) {
        throw new AwsSingleNodeStatusScopeError();
      }

      const intent = journal.providerIntent.intent;
      const securityGroupDurable = durableResource(journal, 'securityGroup');
      const instanceDurable = durableResource(journal, 'instance');
      const rootVolumeDurable = durableResource(journal, 'rootVolume');
      const securityGroup = await inspectSafely(
        ports.inspectSecurityGroup,
        {
          intent,
          storedResourceId: securityGroupDurable?.providerResourceId ?? null,
          api: authority.api,
        },
        normalizeSecurityGroup,
      );
      const securityGroupId =
        securityGroup.id ?? securityGroupDurable?.providerResourceId ?? null;
      /** @type {Readonly<Record<string, any>>} */
      let instance;
      if (securityGroupId === null) {
        instance =
          instanceDurable === null
            ? Object.freeze({
                id: null,
                rootVolumeId: null,
                state: /** @type {const} */ ('absent'),
                publicIpv4: null,
              })
            : Object.freeze({
                id: instanceDurable.providerResourceId,
                rootVolumeId: rootVolumeDurable?.providerResourceId ?? null,
                state: /** @type {const} */ ('conflict'),
                publicIpv4: null,
              });
      } else {
        instance = await inspectSafely(
          ports.inspectInstance,
          {
            intent,
            securityGroupId,
            storedResourceId: instanceDurable?.providerResourceId ?? null,
            api: authority.api,
          },
          normalizeInstance,
        );
      }

      const instanceId =
        instance.id ?? instanceDurable?.providerResourceId ?? null;
      const rootVolumeId =
        instance.rootVolumeId ?? rootVolumeDurable?.providerResourceId ?? null;
      /** @type {Readonly<Record<string, any>>} */
      let rootVolume;
      if (instanceId === null || rootVolumeId === null) {
        rootVolume =
          rootVolumeDurable === null
            ? Object.freeze({
                id: null,
                state: /** @type {const} */ ('absent'),
                publicIpv4: null,
              })
            : Object.freeze({
                id: rootVolumeDurable.providerResourceId,
                state: /** @type {const} */ ('conflict'),
                publicIpv4: null,
              });
      } else {
        rootVolume = await inspectSafely(
          ports.inspectRootVolume,
          {
            intent,
            instanceId,
            rootVolumeId,
            api: authority.api,
          },
          normalizeRootVolume,
        );
      }
      if (
        instance.rootVolumeId !== null &&
        rootVolume.id !== null &&
        instance.rootVolumeId !== rootVolume.id
      ) {
        instance = Object.freeze({ ...instance, state: 'conflict' });
        rootVolume = Object.freeze({ ...rootVolume, state: 'conflict' });
      }
      result = createResult(
        journal,
        Object.freeze({ instance, rootVolume, securityGroup }),
      );
    } catch (error) {
      operationError =
        error instanceof AwsSingleNodeStatusScopeError ||
        error instanceof AwsSingleNodeStatusReadError
          ? error
          : new AwsSingleNodeStatusReadError();
    }

    /** @type {unknown} */
    let cleanupError;
    if (lifecycle !== undefined) {
      try {
        await lifecycle.close();
      } catch {
        cleanupError = new AwsSingleNodeStatusReadError();
      }
    }
    if (operationError !== undefined && cleanupError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        'AWS single-node status failed and its read authority could not be closed.',
      );
    }
    if (operationError !== undefined) throw operationError;
    if (cleanupError !== undefined) throw cleanupError;
    return /** @type {Readonly<Record<string, any>>} */ (result);
  };
}

const productionStatus = createAwsSingleNodeStatusFactory({
  createReadAuthority: createAwsSingleNodeReadAuthority,
  inspectSecurityGroup: inspectAwsSingleNodeSecurityGroup,
  inspectInstance: inspectAwsSingleNodeInstance,
  inspectRootVolume: inspectAwsSingleNodeRootVolume,
});

/**
 * Inspect one production AWS deployment through ambient read authority.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function inspectAwsSingleNodeStatus(value) {
  return await Reflect.apply(productionStatus, undefined, [value]);
}

export default {
  AwsSingleNodeStatusReadError,
  AwsSingleNodeStatusScopeError,
  createAwsSingleNodeStatusFactory,
  inspectAwsSingleNodeStatus,
};
