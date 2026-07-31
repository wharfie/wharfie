/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This narrow composition root keeps its exact read-only port protocol beside the implementation. */

import { isIPv4 } from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { validateSingleNodeDeploymentJournal } from '../../single-node-deployment-journal.js';
import { createHetznerStatusApiClient } from './api-client.js';
import {
  createHetznerCredentialBindingStore,
  validateHetznerCredentialBindingEvidence,
} from './credential-binding.js';
import { inspectHetznerSingleNodeProvisioning } from './single-node-provisioning.js';

const INPUT_KEYS = new Set(['journal', 'dataRoot']);
const DEPENDENCY_KEYS = new Set([
  'readToken',
  'requireBinding',
  'createReadClient',
  'inspectResources',
]);
const INSPECTION_READ_METHODS = Object.freeze([
  'listFirewalls',
  'getFirewall',
  'listPrimaryIps',
  'getPrimaryIp',
  'listServers',
  'getServer',
]);
const INTERNAL_ROLES = Object.freeze(['firewall', 'primaryIp', 'server']);
const PUBLIC_ROLES = Object.freeze([
  Object.freeze({ internal: 'firewall', public: 'firewall' }),
  Object.freeze({ internal: 'primaryIp', public: 'primary-ip' }),
  Object.freeze({ internal: 'server', public: 'server' }),
]);
const OBSERVATION_KEYS = new Set(INTERNAL_ROLES);
const RESOURCE_OBSERVATION_KEYS = new Set(['id', 'state', 'publicIpv4']);
const RESOURCE_STATES = new Set(['absent', 'settling', 'exact', 'conflict']);

/** Ambient Hetzner authority does not match the durable local binding. */
export class HetznerSingleNodeStatusCredentialError extends Error {
  constructor() {
    super(
      'Hetzner single-node status could not authenticate durable credential authority.',
    );
    this.name = 'HetznerSingleNodeStatusCredentialError';
    this.code = 'HETZNER_SINGLE_NODE_STATUS_CREDENTIAL_FAILED';
  }
}

/** Provider reads could not produce trustworthy one-shot status evidence. */
export class HetznerSingleNodeStatusReadError extends Error {
  constructor() {
    super('Hetzner single-node status could not read provider evidence.');
    this.name = 'HetznerSingleNodeStatusReadError';
    this.code = 'HETZNER_SINGLE_NODE_STATUS_READ_FAILED';
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

/** @param {unknown} value @returns {string} */
function canonicalDataRoot(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 16 * 1024 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(
      'hetznerSingleNodeStatus.dataRoot must be one canonical absolute path.',
    );
  }
  return value;
}

/**
 * Retain only resource reads without keeping a receiver that may expose
 * sibling mutation powers.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HetznerSingleNodeStatusReadError();
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
      throw new HetznerSingleNodeStatusReadError();
    }
    const capability = descriptor.value;
    api[method] = (/** @type {unknown} */ request) =>
      Reflect.apply(capability, undefined, [request]);
  }
  return Object.freeze(api);
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function validateDependencies(value) {
  const dependencies = exactDataObject(
    value,
    DEPENDENCY_KEYS,
    'hetznerSingleNodeStatus dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `hetznerSingleNodeStatus dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Readonly<Record<string, any>>>>}
 */
function validateInspection(value) {
  const observation = exactDataObject(
    value,
    OBSERVATION_KEYS,
    'hetznerSingleNodeStatus provider observation',
  );
  /** @type {Record<string, Readonly<Record<string, any>>>} */
  const result = {};
  for (const role of INTERNAL_ROLES) {
    const resource = exactDataObject(
      observation[role],
      RESOURCE_OBSERVATION_KEYS,
      `hetznerSingleNodeStatus provider observation.${role}`,
    );
    if (
      resource.id !== null &&
      (!Number.isSafeInteger(resource.id) || resource.id < 1)
    ) {
      throw new HetznerSingleNodeStatusReadError();
    }
    if (!RESOURCE_STATES.has(resource.state)) {
      throw new HetznerSingleNodeStatusReadError();
    }
    if (
      resource.publicIpv4 !== null &&
      (typeof resource.publicIpv4 !== 'string' ||
        !isIPv4(resource.publicIpv4) ||
        resource.publicIpv4 !==
          resource.publicIpv4.split('.').map(Number).join('.'))
    ) {
      throw new HetznerSingleNodeStatusReadError();
    }
    if (role === 'firewall' && resource.publicIpv4 !== null) {
      throw new HetznerSingleNodeStatusReadError();
    }
    result[role] = Object.freeze({
      id: resource.id,
      state: resource.state,
      publicIpv4: resource.publicIpv4,
    });
  }
  return Object.freeze(result);
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
 * Bind one provider observation back to its immutable journal authority.
 * @param {Readonly<Record<string, any>>} journal
 * @param {string} role
 * @param {Readonly<Record<string, any>>} observed
 * @returns {Readonly<{id: string|null, state: 'absent'|'settling'|'exact'|'conflict', publicIpv4: string|null}>}
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
    id: id === null ? null : String(id),
    state,
    publicIpv4: state === 'conflict' ? null : observed.publicIpv4,
  });
}

/**
 * @param {Readonly<Record<string, any>>} journal
 * @param {Readonly<Record<string, Readonly<Record<string, any>>>>} observation
 * @returns {Readonly<{status: 'exact'|'converging'|'degraded', resources: readonly Readonly<Record<string, any>>[]}>}
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
  assertManifestIsSecretFree(result, 'hetznerSingleNodeStatus.result');
  return result;
}

/**
 * Create a structurally read-only journal-bound Hetzner status operation.
 * @param {unknown} dependencies
 * @returns {(value: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createHetznerSingleNodeStatusFactory(dependencies) {
  const ports = validateDependencies(dependencies);

  return async function inspect(value) {
    const input = exactDataObject(value, INPUT_KEYS, 'hetznerSingleNodeStatus');
    const journal = validateSingleNodeDeploymentJournal(
      input.journal,
      'hetznerSingleNodeStatus.journal',
    );
    if (journal.providerIntent.provider !== 'hetzner') {
      throw new TypeError(
        'hetznerSingleNodeStatus journal must target Hetzner.',
      );
    }
    const dataRoot = canonicalDataRoot(input.dataRoot);
    let token;
    try {
      token = await Reflect.apply(ports.readToken, undefined, []);
    } catch {
      throw new HetznerSingleNodeStatusCredentialError();
    }
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.trim() !== token
    ) {
      throw new HetznerSingleNodeStatusCredentialError();
    }
    let binding;
    try {
      binding = validateHetznerCredentialBindingEvidence(
        await Reflect.apply(ports.requireBinding, undefined, [
          {
            dataRoot,
            deploymentInstanceId: journal.deploymentInstanceId,
            token,
          },
        ]),
      );
    } catch {
      throw new HetznerSingleNodeStatusCredentialError();
    }
    if (binding.deploymentInstanceId !== journal.deploymentInstanceId) {
      throw new HetznerSingleNodeStatusCredentialError();
    }

    let observation;
    try {
      const api = snapshotReadApi(
        await Reflect.apply(ports.createReadClient, undefined, [{ token }]),
      );
      const storedResourceIds = Object.freeze(
        Object.fromEntries(
          INTERNAL_ROLES.map((role) => [
            role,
            durableResource(journal, role)?.providerResourceId ?? null,
          ]),
        ),
      );
      observation = validateInspection(
        await Reflect.apply(ports.inspectResources, undefined, [
          {
            intent: journal.providerIntent.intent,
            storedResourceIds,
            api,
          },
        ]),
      );
    } catch (error) {
      if (error instanceof HetznerSingleNodeStatusReadError) throw error;
      throw new HetznerSingleNodeStatusReadError();
    }
    return createResult(journal, observation);
  };
}

const productionStatus = createHetznerSingleNodeStatusFactory({
  readToken: () => process.env.HCLOUD_TOKEN,
  requireBinding: async (/** @type {Readonly<Record<string, any>>} */ value) =>
    await createHetznerCredentialBindingStore({
      root: path.join(value.dataRoot, 'single-node-deployment-credentials'),
    }).requireBinding({
      deploymentInstanceId: value.deploymentInstanceId,
      token: value.token,
    }),
  createReadClient: createHetznerStatusApiClient,
  inspectResources: inspectHetznerSingleNodeProvisioning,
});

/**
 * Inspect one production Hetzner deployment through ambient bound authority.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function inspectHetznerSingleNodeStatus(value) {
  return await Reflect.apply(productionStatus, undefined, [value]);
}

export default {
  HetznerSingleNodeStatusCredentialError,
  HetznerSingleNodeStatusReadError,
  createHetznerSingleNodeStatusFactory,
  inspectHetznerSingleNodeStatus,
};
