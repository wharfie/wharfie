/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { isIPv4 } from 'node:net';

import { validateBuildTarget } from './build-target.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const SINGLE_NODE_DEPLOYMENT_INTENT_SCHEMA_VERSION = 1;
export const SINGLE_NODE_DEPLOYMENT_INTENT_KIND = 'singleNodeDeploymentIntent';
export const SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN =
  'wharfie:single-node-deployment-intent:v1';
export const SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX = 'wdi1';
export const SINGLE_NODE_DEPLOYMENT_MODE = Object.freeze({
  kind: 'single-node-systemd-user',
  version: 1,
});
export const SINGLE_NODE_MACHINE = Object.freeze({ class: 'small' });
export const SINGLE_NODE_ACCESS_KIND = 'public-ssh';
export const SINGLE_NODE_MAX_SSH_SOURCES = 32;

const INPUT_KEYS = new Set([
  'deployment',
  'appId',
  'target',
  'mode',
  'machine',
  'access',
  'provider',
]);
const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'intentRevisionId',
  ...INPUT_KEYS,
]);
const DEPLOYMENT_KEYS = new Set(['id']);
const MODE_KEYS = new Set(['kind', 'version']);
const MACHINE_KEYS = new Set(['class']);
const ACCESS_KEYS = new Set(['kind', 'allowedIpv4']);
const AWS_PROVIDER_KEYS = new Set(['kind', 'region']);
const HETZNER_PROVIDER_KEYS = new Set(['kind', 'location']);
const AWS_REGION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const HETZNER_LOCATION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * @typedef SingleNodeDeploymentTarget
 * @property {string} nodeVersion - Exact canonical Node semantic version.
 * @property {'linux'} platform - Fixed guest platform.
 * @property {'x64'} architecture - Fixed first-preview guest architecture.
 * @property {'glibc'} libc - Fixed guest C library.
 */

/**
 * @typedef AwsSingleNodeDeploymentProvider
 * @property {'aws'} kind - Provider kind.
 * @property {string} region - Explicit AWS region.
 */

/**
 * @typedef HetznerSingleNodeDeploymentProvider
 * @property {'hetzner'} kind - Provider kind.
 * @property {string} location - Explicit Hetzner location.
 */

/**
 * @typedef {AwsSingleNodeDeploymentProvider | HetznerSingleNodeDeploymentProvider} SingleNodeDeploymentProvider
 */

/**
 * @typedef SingleNodeDeploymentIntent
 * @property {1} schemaVersion - Intent schema version.
 * @property {'singleNodeDeploymentIntent'} kind - Document kind.
 * @property {string} intentRevisionId - Immutable intent identity.
 * @property {{id: string}} deployment - Human-addressable deployment identity.
 * @property {string} appId - Application identity.
 * @property {SingleNodeDeploymentTarget} target - Exact Linux payload target.
 * @property {{kind: 'single-node-systemd-user', version: 1}} mode - Fixed deployment mode.
 * @property {{class: 'small'}} machine - Portable machine class.
 * @property {{kind: 'public-ssh', allowedIpv4: string[]}} access - Exact operator SSH sources.
 * @property {SingleNodeDeploymentProvider} provider - Provider and explicit placement.
 */

/**
 * Deeply freeze JSON owned by this module.
 * @param {any} value - JSON value.
 * @returns {any} - Frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expectedKeys - Exact required keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertAllKeys(value, expectedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate mode.
 * @param {string} valuePath - Human-readable value path.
 * @returns {typeof SINGLE_NODE_DEPLOYMENT_MODE} - Fixed mode.
 */
function validateMode(value, valuePath) {
  const mode = cloneJsonObject(value, valuePath);
  assertAllKeys(mode, MODE_KEYS, valuePath);
  if (
    mode.kind !== SINGLE_NODE_DEPLOYMENT_MODE.kind ||
    mode.version !== SINGLE_NODE_DEPLOYMENT_MODE.version
  ) {
    throw new TypeError(
      `${valuePath} must be single-node-systemd-user version 1.`,
    );
  }
  return { ...SINGLE_NODE_DEPLOYMENT_MODE };
}

/**
 * @param {unknown} value - Candidate machine class.
 * @param {string} valuePath - Human-readable value path.
 * @returns {typeof SINGLE_NODE_MACHINE} - Fixed machine class.
 */
function validateMachine(value, valuePath) {
  const machine = cloneJsonObject(value, valuePath);
  assertAllKeys(machine, MACHINE_KEYS, valuePath);
  if (machine.class !== SINGLE_NODE_MACHINE.class) {
    throw new TypeError(`${valuePath}.class must be 'small'.`);
  }
  return { ...SINGLE_NODE_MACHINE };
}

/**
 * @param {unknown} value - Candidate access policy.
 * @param {string} valuePath - Human-readable value path.
 * @returns {SingleNodeDeploymentIntent['access']} - Canonical access policy.
 */
function validateAccess(value, valuePath) {
  const access = cloneJsonObject(value, valuePath);
  assertAllKeys(access, ACCESS_KEYS, valuePath);
  if (access.kind !== SINGLE_NODE_ACCESS_KIND) {
    throw new TypeError(`${valuePath}.kind must be 'public-ssh'.`);
  }
  if (!Array.isArray(access.allowedIpv4)) {
    throw new TypeError(`${valuePath}.allowedIpv4 must be an array.`);
  }

  const addresses = access.allowedIpv4.map((source, index) => {
    const sourcePath = `${valuePath}.allowedIpv4[${index}]`;
    if (typeof source !== 'string' || !source.endsWith('/32')) {
      throw new TypeError(
        `${sourcePath} must be one canonical IPv4 address followed by /32.`,
      );
    }
    const address = source.slice(0, -3);
    if (!isIPv4(address) || source !== `${address}/32`) {
      throw new TypeError(
        `${sourcePath} must be one canonical IPv4 address followed by /32.`,
      );
    }
    return source;
  });

  const allowedIpv4 = [...new Set(addresses)].sort(compareCanonicalStrings);
  if (allowedIpv4.length === 0) {
    throw new TypeError(
      `${valuePath}.allowedIpv4 must contain at least one IPv4 /32 source.`,
    );
  }
  if (allowedIpv4.length > SINGLE_NODE_MAX_SSH_SOURCES) {
    throw new TypeError(
      `${valuePath}.allowedIpv4 must contain at most ${SINGLE_NODE_MAX_SSH_SOURCES} unique IPv4 /32 sources.`,
    );
  }
  return { kind: SINGLE_NODE_ACCESS_KIND, allowedIpv4 };
}

/**
 * @param {unknown} value - Candidate AWS region.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical AWS region.
 */
function validateAwsRegion(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length > 63 ||
    !AWS_REGION_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be an explicit canonical AWS region.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate Hetzner location.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical Hetzner location.
 */
function validateHetznerLocation(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length > 32 ||
    !HETZNER_LOCATION_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be an explicit canonical Hetzner location.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate provider selection.
 * @param {string} valuePath - Human-readable value path.
 * @returns {SingleNodeDeploymentProvider} - Canonical provider selection.
 */
function validateProvider(value, valuePath) {
  const provider = cloneJsonObject(value, valuePath);
  if (provider.kind === 'aws') {
    assertAllKeys(provider, AWS_PROVIDER_KEYS, valuePath);
    return {
      kind: 'aws',
      region: validateAwsRegion(provider.region, `${valuePath}.region`),
    };
  }
  if (provider.kind === 'hetzner') {
    assertAllKeys(provider, HETZNER_PROVIDER_KEYS, valuePath);
    return {
      kind: 'hetzner',
      location: validateHetznerLocation(
        provider.location,
        `${valuePath}.location`,
      ),
    };
  }
  throw new TypeError(`${valuePath}.kind must be 'aws' or 'hetzner'.`);
}

/**
 * Create one AWS provider selection without accepting credentials or a
 * provider resource graph.
 * @param {string} region - Explicit AWS region.
 * @returns {AwsSingleNodeDeploymentProvider} - Canonical provider selection.
 */
export function createAwsSingleNodeDeploymentProvider(region) {
  return /** @type {AwsSingleNodeDeploymentProvider} */ (
    validateProvider({ kind: 'aws', region }, 'awsSingleNodeDeploymentProvider')
  );
}

/**
 * Create one Hetzner provider selection without accepting credentials or a
 * provider resource graph.
 * @param {string} location - Explicit Hetzner location.
 * @returns {HetznerSingleNodeDeploymentProvider} - Canonical provider selection.
 */
export function createHetznerSingleNodeDeploymentProvider(location) {
  return /** @type {HetznerSingleNodeDeploymentProvider} */ (
    validateProvider(
      { kind: 'hetzner', location },
      'hetznerSingleNodeDeploymentProvider',
    )
  );
}

/**
 * @param {unknown} value - Candidate intent input.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Omit<SingleNodeDeploymentIntent, 'intentRevisionId'>} - Canonical payload.
 */
function createIntentPayload(value, valuePath) {
  const input = cloneJsonObject(value, valuePath);
  assertAllKeys(input, INPUT_KEYS, valuePath);

  const deployment = cloneJsonObject(
    input.deployment,
    `${valuePath}.deployment`,
  );
  assertAllKeys(deployment, DEPLOYMENT_KEYS, `${valuePath}.deployment`);
  assertLogicalId(deployment.id, `${valuePath}.deployment.id`);
  assertLogicalId(input.appId, `${valuePath}.appId`);

  const target = validateBuildTarget(input.target, `${valuePath}.target`);
  if (
    target.platform !== 'linux' ||
    target.architecture !== 'x64' ||
    target.libc !== 'glibc'
  ) {
    throw new TypeError(
      `${valuePath}.target must be Linux glibc on x64 for the single-node deployment preview.`,
    );
  }

  const payload =
    /** @type {Omit<SingleNodeDeploymentIntent, 'intentRevisionId'>} */ ({
      schemaVersion: SINGLE_NODE_DEPLOYMENT_INTENT_SCHEMA_VERSION,
      kind: SINGLE_NODE_DEPLOYMENT_INTENT_KIND,
      deployment: { id: deployment.id },
      appId: input.appId,
      target,
      mode: validateMode(input.mode, `${valuePath}.mode`),
      machine: validateMachine(input.machine, `${valuePath}.machine`),
      access: validateAccess(input.access, `${valuePath}.access`),
      provider: validateProvider(input.provider, `${valuePath}.provider`),
    });
  assertManifestIsSecretFree(payload, valuePath);
  return payload;
}

/**
 * Produce the canonical deeply frozen identity payload.
 * @param {unknown} value - Candidate intent input.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Omit<SingleNodeDeploymentIntent, 'intentRevisionId'>>} - Canonical payload.
 */
export function canonicalizeSingleNodeDeploymentIntentPayload(
  value,
  valuePath = 'singleNodeDeploymentIntent',
) {
  return deepFreeze(
    sortCanonicalJsonValue(createIntentPayload(value, valuePath)),
  );
}

/**
 * Compute the immutable identity of one intent payload.
 * @param {unknown} value - Candidate intent input.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - `wdi1_<base64url sha256>` identity.
 */
export function getSingleNodeDeploymentIntentRevisionId(
  value,
  valuePath = 'singleNodeDeploymentIntent',
) {
  const payload = canonicalizeSingleNodeDeploymentIntentPayload(
    value,
    valuePath,
  );
  return createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX,
    value: payload,
    valuePath,
  });
}

/**
 * Create one immutable single-node deployment intent.
 * @param {unknown} value - Candidate intent input.
 * @returns {Readonly<SingleNodeDeploymentIntent>} - Canonical intent.
 */
export function createSingleNodeDeploymentIntent(value) {
  const payload = canonicalizeSingleNodeDeploymentIntentPayload(value);
  const intentRevisionId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX,
    value: payload,
    valuePath: 'singleNodeDeploymentIntent',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, intentRevisionId }));
}

/**
 * Validate a serialized single-node deployment intent and recompute its identity.
 * @param {unknown} value - Candidate serialized intent.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<SingleNodeDeploymentIntent>} - Canonical intent.
 */
export function validateSingleNodeDeploymentIntent(
  value,
  valuePath = 'singleNodeDeploymentIntent',
) {
  const document = cloneJsonObject(value, valuePath);
  assertAllKeys(document, DOCUMENT_KEYS, valuePath);
  if (document.schemaVersion !== SINGLE_NODE_DEPLOYMENT_INTENT_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (document.kind !== SINGLE_NODE_DEPLOYMENT_INTENT_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${SINGLE_NODE_DEPLOYMENT_INTENT_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    document.intentRevisionId,
    SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX,
    `${valuePath}.intentRevisionId`,
  );

  const payload = canonicalizeSingleNodeDeploymentIntentPayload(
    {
      deployment: document.deployment,
      appId: document.appId,
      target: document.target,
      mode: document.mode,
      machine: document.machine,
      access: document.access,
      provider: document.provider,
    },
    valuePath,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.intentRevisionId !== expectedId) {
    throw new Error(
      `${valuePath}.intentRevisionId does not match the canonical intent payload.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, intentRevisionId: expectedId }),
  );
}

export default {
  SINGLE_NODE_ACCESS_KIND,
  SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_INTENT_KIND,
  SINGLE_NODE_DEPLOYMENT_INTENT_SCHEMA_VERSION,
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  SINGLE_NODE_MAX_SSH_SOURCES,
  canonicalizeSingleNodeDeploymentIntentPayload,
  createAwsSingleNodeDeploymentProvider,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
  getSingleNodeDeploymentIntentRevisionId,
  validateSingleNodeDeploymentIntent,
};
