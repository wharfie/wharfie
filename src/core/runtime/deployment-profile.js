/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const DEPLOYMENT_PROFILE_SCHEMA_VERSION = 2;
export const DEPLOYMENT_PROFILE_KIND = 'deploymentProfile';
export const DEPLOYMENT_PROFILE_ID_DOMAIN = 'wharfie:deployment-profile:v2';
export const DEPLOYMENT_PROFILE_ID_PREFIX = 'wpr2';
export const DEPLOYMENT_MODE = Object.freeze({
  kind: 'single-node-systemd-user',
  version: 1,
});
export const DEPLOYMENT_PROVIDER_KIND = 'aws';
export const DEPLOYMENT_PROVIDER_CONTRACT_VERSION = 1;
export const DEPLOYMENT_CAPABILITY_IDS = Object.freeze({
  node: 'resident-node',
  applicationState: 'application-state',
  controlState: 'control-state',
  artifactStorage: 'artifact-storage',
  runtimeIdentity: 'runtime-identity',
  networking: 'networking',
  ingress: 'ingress',
});
export const DEPLOYMENT_CAPABILITY_KINDS = Object.freeze(
  Object.values(DEPLOYMENT_CAPABILITY_IDS),
);

const INPUT_KEYS = new Set(['profile', 'appId', 'target', 'mode', 'provider']);
const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'profileRevisionId',
  ...INPUT_KEYS,
]);
const PROFILE_KEYS = new Set(['id']);
const MODE_KEYS = new Set(['kind', 'version']);
const PROVIDER_KEYS = new Set([
  'kind',
  'contractVersion',
  'scope',
  'configuration',
]);
const SCOPE_KEYS = new Set(['region']);
const CONFIGURATION_KEYS = new Set(Object.keys(DEPLOYMENT_CAPABILITY_IDS));
const NODE_KEYS = new Set(['management', 'capacity']);
const LOCAL_STATE_KEYS = new Set(['management', 'storage', 'onDestroy']);
const ARTIFACT_STORAGE_KEYS = new Set(['management', 'storage', 'onDestroy']);
const RUNTIME_IDENTITY_KEYS = new Set(['management', 'kind']);
const NETWORKING_KEYS = new Set(['management', 'kind']);
const INGRESS_KEYS = new Set(['management']);
const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * Exact initial AWS capability mapping. It is data rather than driver code so
 * plans can show the substrate being requested without exposing arbitrary IaC.
 */
export const AWS_SINGLE_NODE_CONFIGURATION = deepFreeze({
  node: { management: 'managed', capacity: 'small' },
  applicationState: {
    management: 'managed',
    storage: 'attached-encrypted-volume',
    onDestroy: 'retain',
  },
  controlState: {
    management: 'managed',
    storage: 'attached-encrypted-volume',
    onDestroy: 'retain',
  },
  artifactStorage: {
    management: 'managed',
    storage: 'private-provider-object',
    onDestroy: 'purge',
  },
  runtimeIdentity: { management: 'managed', kind: 'host-ssm-only' },
  networking: {
    management: 'managed',
    kind: 'public-egress-no-ingress',
  },
  ingress: { management: 'none' },
});

/**
 * @typedef DeploymentProfile
 * @property {2} schemaVersion - Profile schema version.
 * @property {'deploymentProfile'} kind - Document kind.
 * @property {string} profileRevisionId - Immutable profile identity.
 * @property {{id: string}} profile - Human-addressable profile identity.
 * @property {string} appId - Application allowed to use this profile.
 * @property {import('./build-target.js').BuildTarget} target - Exact artifact target.
 * @property {{kind: 'single-node-systemd-user', version: 1}} mode - Fixed first deployment mode.
 * @property {{kind: 'aws', contractVersion: 1, scope: {region: string}, configuration: typeof AWS_SINGLE_NODE_CONFIGURATION}} provider - Fixed finite AWS fulfillment choice.
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
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {Set<string>} expectedKeys - Exact required keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertAllKeys(value, expectedKeys, valuePath) {
  assertExactKeys(value, expectedKeys, valuePath);
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate mode.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{kind: 'single-node-systemd-user', version: 1}} - Fixed mode.
 */
function validateMode(value, valuePath) {
  const mode = cloneJsonObject(value, valuePath);
  assertAllKeys(mode, MODE_KEYS, valuePath);
  if (
    mode.kind !== DEPLOYMENT_MODE.kind ||
    mode.version !== DEPLOYMENT_MODE.version
  ) {
    throw new TypeError(
      `${valuePath} must be single-node-systemd-user version 1.`,
    );
  }
  return { ...DEPLOYMENT_MODE };
}

/**
 * @param {Record<string, any>} value - Candidate fixed capability mapping.
 * @param {Record<string, string>} expected - Exact fixed values.
 * @param {Set<string>} keys - Exact fields.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, string>} - Validated mapping.
 */
function validateFixedCapability(value, expected, keys, valuePath) {
  const capability = cloneJsonObject(value, valuePath);
  assertAllKeys(capability, keys, valuePath);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (capability[key] !== expectedValue) {
      throw new TypeError(`${valuePath}.${key} must be '${expectedValue}'.`);
    }
  }
  return { ...expected };
}

/**
 * @param {unknown} value - Candidate finite capability configuration.
 * @param {string} valuePath - Human-readable value path.
 * @returns {typeof AWS_SINGLE_NODE_CONFIGURATION} - Exact supported mapping.
 */
function validateConfiguration(value, valuePath) {
  const configuration = cloneJsonObject(value, valuePath);
  assertAllKeys(configuration, CONFIGURATION_KEYS, valuePath);
  return /** @type {typeof AWS_SINGLE_NODE_CONFIGURATION} */ ({
    node: validateFixedCapability(
      configuration.node,
      AWS_SINGLE_NODE_CONFIGURATION.node,
      NODE_KEYS,
      `${valuePath}.node`,
    ),
    applicationState: validateFixedCapability(
      configuration.applicationState,
      AWS_SINGLE_NODE_CONFIGURATION.applicationState,
      LOCAL_STATE_KEYS,
      `${valuePath}.applicationState`,
    ),
    controlState: validateFixedCapability(
      configuration.controlState,
      AWS_SINGLE_NODE_CONFIGURATION.controlState,
      LOCAL_STATE_KEYS,
      `${valuePath}.controlState`,
    ),
    artifactStorage: validateFixedCapability(
      configuration.artifactStorage,
      AWS_SINGLE_NODE_CONFIGURATION.artifactStorage,
      ARTIFACT_STORAGE_KEYS,
      `${valuePath}.artifactStorage`,
    ),
    runtimeIdentity: validateFixedCapability(
      configuration.runtimeIdentity,
      AWS_SINGLE_NODE_CONFIGURATION.runtimeIdentity,
      RUNTIME_IDENTITY_KEYS,
      `${valuePath}.runtimeIdentity`,
    ),
    networking: validateFixedCapability(
      configuration.networking,
      AWS_SINGLE_NODE_CONFIGURATION.networking,
      NETWORKING_KEYS,
      `${valuePath}.networking`,
    ),
    ingress: validateFixedCapability(
      configuration.ingress,
      AWS_SINGLE_NODE_CONFIGURATION.ingress,
      INGRESS_KEYS,
      `${valuePath}.ingress`,
    ),
  });
}

/**
 * @param {unknown} value - Candidate AWS provider selection.
 * @param {string} valuePath - Human-readable value path.
 * @returns {DeploymentProfile['provider']} - Exact provider selection.
 */
function validateProvider(value, valuePath) {
  const provider = cloneJsonObject(value, valuePath);
  assertAllKeys(provider, PROVIDER_KEYS, valuePath);
  if (provider.kind !== DEPLOYMENT_PROVIDER_KIND) {
    throw new TypeError(`${valuePath}.kind must be 'aws'.`);
  }
  if (provider.contractVersion !== DEPLOYMENT_PROVIDER_CONTRACT_VERSION) {
    throw new TypeError(`${valuePath}.contractVersion must be the integer 1.`);
  }
  const scope = cloneJsonObject(provider.scope, `${valuePath}.scope`);
  assertAllKeys(scope, SCOPE_KEYS, `${valuePath}.scope`);
  if (
    typeof scope.region !== 'string' ||
    scope.region.length > 63 ||
    !AWS_REGION_PATTERN.test(scope.region)
  ) {
    throw new TypeError(
      `${valuePath}.scope.region must be an explicit canonical AWS region.`,
    );
  }
  const normalized = {
    kind: DEPLOYMENT_PROVIDER_KIND,
    contractVersion: DEPLOYMENT_PROVIDER_CONTRACT_VERSION,
    scope: { region: scope.region },
    configuration: validateConfiguration(
      provider.configuration,
      `${valuePath}.configuration`,
    ),
  };
  assertManifestIsSecretFree(normalized, valuePath);
  return /** @type {DeploymentProfile['provider']} */ (normalized);
}

/**
 * Validate input fields and construct the identity payload.
 * @param {unknown} value - Candidate profile input.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Omit<DeploymentProfile, 'profileRevisionId'>} - Canonical payload.
 */
function createDeploymentProfilePayload(value, valuePath) {
  const input = cloneJsonObject(value, valuePath);
  assertAllKeys(input, INPUT_KEYS, valuePath);
  const profile = cloneJsonObject(input.profile, `${valuePath}.profile`);
  assertAllKeys(profile, PROFILE_KEYS, `${valuePath}.profile`);
  assertLogicalId(profile.id, `${valuePath}.profile.id`);
  assertLogicalId(input.appId, `${valuePath}.appId`);

  const target = validateBuildTarget(input.target, `${valuePath}.target`);
  if (
    target.platform !== 'linux' ||
    target.libc !== 'glibc' ||
    (target.architecture !== 'x64' && target.architecture !== 'arm64')
  ) {
    throw new TypeError(
      `${valuePath}.target must be Linux glibc on x64 or arm64 for single-node-systemd-user deployment.`,
    );
  }

  return /** @type {Omit<DeploymentProfile, 'profileRevisionId'>} */ ({
    schemaVersion: DEPLOYMENT_PROFILE_SCHEMA_VERSION,
    kind: DEPLOYMENT_PROFILE_KIND,
    profile: { id: profile.id },
    appId: input.appId,
    target,
    mode: validateMode(input.mode, `${valuePath}.mode`),
    provider: validateProvider(input.provider, `${valuePath}.provider`),
  });
}

/**
 * Create the fixed initial AWS provider input without exposing its verbose
 * capability mapping at every call site.
 * @param {string} region - Explicit AWS region.
 * @returns {DeploymentProfile['provider']} - Fresh provider input.
 */
export function createAwsSingleNodeProvider(region) {
  return /** @type {DeploymentProfile['provider']} */ (
    JSON.parse(
      JSON.stringify({
        kind: DEPLOYMENT_PROVIDER_KIND,
        contractVersion: DEPLOYMENT_PROVIDER_CONTRACT_VERSION,
        scope: { region },
        configuration: AWS_SINGLE_NODE_CONFIGURATION,
      }),
    )
  );
}

/**
 * Produce the canonical deeply frozen identity payload.
 * @param {unknown} value - Candidate profile input.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Omit<DeploymentProfile, 'profileRevisionId'>>} - Canonical payload.
 */
export function canonicalizeDeploymentProfilePayload(
  value,
  valuePath = 'deploymentProfile',
) {
  return deepFreeze(
    sortCanonicalJsonValue(createDeploymentProfilePayload(value, valuePath)),
  );
}

/**
 * Compute the immutable identity of one profile payload.
 * @param {unknown} value - Candidate profile input.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - `wpr2_<base64url sha256>` identity.
 */
export function getDeploymentProfileRevisionId(
  value,
  valuePath = 'deploymentProfile',
) {
  const payload = canonicalizeDeploymentProfilePayload(value, valuePath);
  return createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PROFILE_ID_DOMAIN,
    prefix: DEPLOYMENT_PROFILE_ID_PREFIX,
    value: payload,
    valuePath,
  });
}

/**
 * Create one immutable DeploymentProfileV2.
 * @param {unknown} value - Candidate profile input.
 * @returns {Readonly<DeploymentProfile>} - Canonical profile.
 */
export function createDeploymentProfile(value) {
  const payload = canonicalizeDeploymentProfilePayload(value);
  const profileRevisionId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PROFILE_ID_DOMAIN,
    prefix: DEPLOYMENT_PROFILE_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentProfile',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, profileRevisionId }));
}

/**
 * Validate a serialized DeploymentProfileV2 and recompute its identity.
 * @param {unknown} value - Candidate serialized profile.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentProfile>} - Canonical profile.
 */
export function validateDeploymentProfile(
  value,
  valuePath = 'deploymentProfile',
) {
  const document = cloneJsonObject(value, valuePath);
  assertExactKeys(document, DOCUMENT_KEYS, valuePath);
  if (document.schemaVersion !== DEPLOYMENT_PROFILE_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 2.`);
  }
  if (document.kind !== DEPLOYMENT_PROFILE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${DEPLOYMENT_PROFILE_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    document.profileRevisionId,
    DEPLOYMENT_PROFILE_ID_PREFIX,
    `${valuePath}.profileRevisionId`,
  );
  const payload = canonicalizeDeploymentProfilePayload(
    {
      profile: document.profile,
      appId: document.appId,
      target: document.target,
      mode: document.mode,
      provider: document.provider,
    },
    valuePath,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PROFILE_ID_DOMAIN,
    prefix: DEPLOYMENT_PROFILE_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.profileRevisionId !== expectedId) {
    throw new Error(
      `${valuePath}.profileRevisionId does not match the canonical profile payload.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, profileRevisionId: expectedId }),
  );
}

export default {
  AWS_SINGLE_NODE_CONFIGURATION,
  DEPLOYMENT_CAPABILITY_IDS,
  DEPLOYMENT_CAPABILITY_KINDS,
  DEPLOYMENT_MODE,
  DEPLOYMENT_PROFILE_ID_DOMAIN,
  DEPLOYMENT_PROFILE_ID_PREFIX,
  DEPLOYMENT_PROFILE_KIND,
  DEPLOYMENT_PROFILE_SCHEMA_VERSION,
  DEPLOYMENT_PROVIDER_CONTRACT_VERSION,
  DEPLOYMENT_PROVIDER_KIND,
  canonicalizeDeploymentProfilePayload,
  createAwsSingleNodeProvider,
  createDeploymentProfile,
  getDeploymentProfileRevisionId,
  validateDeploymentProfile,
};
