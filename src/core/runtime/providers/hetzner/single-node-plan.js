/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { validateSingleNodeDeploymentDesired } from '../../single-node-deployment-desired.js';
import { getHetznerDeploymentLabelSelector } from './ownership.js';

export const HETZNER_SINGLE_NODE_PLAN_SCHEMA_VERSION = 1;
export const HETZNER_SINGLE_NODE_PLAN_KIND = 'hetznerSingleNodeDeploymentPlan';
export const HETZNER_SINGLE_NODE_PLAN_ID_PREFIX = 'wsnp1';
export const HETZNER_SINGLE_NODE_ACTION_ID_PREFIX = 'wsna1';
export const HETZNER_PROVIDER_SPEC_ID_PREFIX = 'wshp1';
export const HETZNER_SMALL_SERVER_TYPE_CANDIDATES = Object.freeze([
  'cx23',
  'cpx12',
  'cpx22',
]);

const PLAN_ID_DOMAIN = 'wharfie:hetzner-single-node-plan:v1';
const ACTION_ID_DOMAIN = 'wharfie:single-node-deployment-action:v1';
const PROVIDER_SPEC_ID_DOMAIN = 'wharfie:hetzner-provider-spec:v1';
const UBUNTU_IMAGE_NAME = 'ubuntu-24.04';
const EXPECTED_ARCHITECTURE = 'x86';
const EXPECTED_OWNED_RESOURCE_COUNT = 3;
const PLAN_MAX_BYTES = 128 * 1024;
const INPUT_KEYS = new Set(['desired', 'api']);
const API_METHODS = Object.freeze([
  'listLocations',
  'listServerTypes',
  'listImages',
  'listFirewalls',
  'listPrimaryIps',
  'listServers',
]);
const PLAN_KEYS = new Set([
  'schemaVersion',
  'kind',
  'planId',
  'deploymentInstanceId',
  'desired',
  'providerSpec',
  'inspection',
  'status',
  'blockedReason',
  'actions',
]);
const PROVIDER_SPEC_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerSpecId',
  'location',
  'serverType',
  'image',
  'ownedResourceCount',
]);
const PROVIDER_SPEC_PAYLOAD_KEYS = new Set(
  [...PROVIDER_SPEC_KEYS].filter((key) => key !== 'providerSpecId'),
);
const REFERENCE_KEYS = new Set(['id', 'name']);
const INSPECTION_KEYS = new Set(['status', 'observedOwnedResourceCount']);
const ACTION_KEYS = new Set(['actionId', 'kind', 'dependsOn']);
const ACTION_KINDS = Object.freeze([
  'provision-managed-node',
  'activate-application',
]);

/**
 * @typedef HetznerSingleNodePlan
 * @property {1} schemaVersion - Plan schema.
 * @property {'hetznerSingleNodeDeploymentPlan'} kind - Plan kind.
 * @property {string} planId - Content identity.
 * @property {string} deploymentInstanceId - Stable deployment identity.
 * @property {import('../../single-node-deployment-desired.js').SingleNodeDeploymentDesired} desired - Exact secret-free desired state.
 * @property {Readonly<Record<string, any>>} providerSpec - Exact read-only provider selection.
 * @property {Readonly<{status: 'absent'|'unbound-conflict', observedOwnedResourceCount: number}>} inspection - Provider inventory projection.
 * @property {'actionable'|'blocked'} status - Whether apply may proceed.
 * @property {null|'unbound-provider-resources'} blockedReason - Safe refusal.
 * @property {Readonly<Record<string, any>[]>} actions - Aggregate semantic actions.
 */

/**
 * @param {any} value - Value to freeze.
 * @returns {any} - Deeply frozen value.
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
 * @param {Set<string>} expected - Exact keys.
 * @param {string} valuePath - Human-readable path.
 * @returns {void}
 */
function assertExactKeys(value, expected, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * Snapshot only the read methods this planner owns. Mutation methods remain
 * unreachable, making the no-write boundary structural rather than advisory.
 * @param {unknown} value - Candidate API client.
 * @returns {Readonly<Record<string, Function>>} - Bound read methods.
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerSingleNodePlan.api must be an API client.');
  }
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of API_METHODS) {
    const candidate = /** @type {Record<string, any>} */ (value)[method];
    if (typeof candidate !== 'function') {
      throw new TypeError(
        `hetznerSingleNodePlan.api.${method} must be a function.`,
      );
    }
    result[method] = candidate.bind(value);
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value - Candidate provider reference.
 * @param {string} valuePath - Human-readable path.
 * @returns {Readonly<{id: number, name: string}>} - Canonical reference.
 */
function providerReference(value, valuePath) {
  const reference = cloneBoundedJsonObject(value, 4096, valuePath);
  assertExactKeys(reference, REFERENCE_KEYS, valuePath);
  if (!Number.isSafeInteger(reference.id) || reference.id < 1) {
    throw new TypeError(`${valuePath}.id must be a positive safe integer.`);
  }
  if (
    typeof reference.name !== 'string' ||
    reference.name.length === 0 ||
    reference.name.length > 128
  ) {
    throw new TypeError(`${valuePath}.name must be a bounded nonempty string.`);
  }
  return Object.freeze({ id: reference.id, name: reference.name });
}

/**
 * @param {unknown} value - Candidate provider spec.
 * @param {string} valuePath - Human-readable path.
 * @returns {Readonly<Record<string, any>>} - Canonical provider spec.
 */
function validateProviderSpec(value, valuePath) {
  const spec = cloneBoundedJsonObject(value, 16 * 1024, valuePath);
  assertExactKeys(spec, PROVIDER_SPEC_KEYS, valuePath);
  if (spec.schemaVersion !== 1 || spec.kind !== 'hetznerProviderSpec') {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  assertDomainSeparatedSha256Id(
    spec.providerSpecId,
    HETZNER_PROVIDER_SPEC_ID_PREFIX,
    `${valuePath}.providerSpecId`,
  );
  const payload = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'hetznerProviderSpec',
    location: providerReference(spec.location, `${valuePath}.location`),
    serverType: providerReference(spec.serverType, `${valuePath}.serverType`),
    image: providerReference(spec.image, `${valuePath}.image`),
    ownedResourceCount: spec.ownedResourceCount,
  });
  assertExactKeys(payload, PROVIDER_SPEC_PAYLOAD_KEYS, valuePath);
  if (payload.ownedResourceCount !== EXPECTED_OWNED_RESOURCE_COUNT) {
    throw new TypeError(`${valuePath}.ownedResourceCount must be 3.`);
  }
  const expectedId = createCanonicalJsonSha256Id({
    domain: PROVIDER_SPEC_ID_DOMAIN,
    prefix: HETZNER_PROVIDER_SPEC_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (spec.providerSpecId !== expectedId) {
    throw new Error(
      `${valuePath}.providerSpecId does not match the exact provider selection.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, providerSpecId: expectedId }),
  );
}

/**
 * @param {Readonly<Record<string, any>>} payload - Provider spec without ID.
 * @returns {Readonly<Record<string, any>>} - Content-addressed provider spec.
 */
function createProviderSpec(payload) {
  const providerSpecId = createCanonicalJsonSha256Id({
    domain: PROVIDER_SPEC_ID_DOMAIN,
    prefix: HETZNER_PROVIDER_SPEC_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerSingleNodePlan.providerSpec',
  });
  return validateProviderSpec(
    { ...payload, providerSpecId },
    'hetznerSingleNodePlan.providerSpec',
  );
}

/**
 * @param {string} kind - Semantic aggregate action.
 * @param {string[]} dependsOn - Prior action IDs.
 * @param {Readonly<Record<string, any>>} context - Exact plan authority.
 * @returns {Readonly<Record<string, any>>} - Content-addressed action.
 */
function createAction(kind, dependsOn, context) {
  const payload = sortCanonicalJsonValue({
    kind,
    deploymentInstanceId: context.deploymentInstanceId,
    desiredRevisionId: context.desiredRevisionId,
    providerSpecId: context.providerSpecId,
    dependsOn,
  });
  return Object.freeze({
    actionId: createCanonicalJsonSha256Id({
      domain: ACTION_ID_DOMAIN,
      prefix: HETZNER_SINGLE_NODE_ACTION_ID_PREFIX,
      value: payload,
      valuePath: 'hetznerSingleNodePlan.action',
    }),
    kind,
    dependsOn: Object.freeze([...dependsOn]),
  });
}

/**
 * Resolve exactly one current location.
 * @param {Readonly<any[]>} locations - Provider observations.
 * @param {string} name - Requested location.
 * @returns {any} - Exact location.
 */
function selectLocation(locations, name) {
  const matches = locations.filter((location) => location.name === name);
  if (matches.length !== 1) {
    throw new Error(
      'Hetzner location selection did not resolve to exactly one location.',
    );
  }
  return matches[0];
}

/**
 * Select the first code-owned small x86 type currently available at the exact
 * location. Candidate order is part of the preview contract.
 * @param {Readonly<any[]>} serverTypes - Provider observations.
 * @param {any} location - Exact selected location.
 * @returns {any} - Selected server type.
 */
function selectServerType(serverTypes, location) {
  for (const name of HETZNER_SMALL_SERVER_TYPE_CANDIDATES) {
    const candidates = serverTypes.filter(
      (serverType) =>
        serverType.name === name &&
        serverType.architecture === EXPECTED_ARCHITECTURE,
    );
    if (candidates.length > 1) {
      throw new Error(
        'Hetzner small server type selection was provider-ambiguous.',
      );
    }
    if (candidates.length === 0) continue;
    const availability = candidates[0].locations.filter(
      (/** @type {any} */ candidate) =>
        candidate.id === location.id && candidate.name === location.name,
    );
    if (availability.length > 1) {
      throw new Error(
        'Hetzner server type location evidence was provider-ambiguous.',
      );
    }
    if (
      availability.length === 1 &&
      availability[0].available === true &&
      availability[0].deprecation === null
    ) {
      return candidates[0];
    }
  }
  throw new Error(
    'No supported small x86 Hetzner server type is currently available in the requested location.',
  );
}

/**
 * @param {Readonly<any[]>} images - Provider observations.
 * @returns {any} - Exact current Ubuntu image.
 */
function selectImage(images) {
  const matches = images.filter(
    (image) =>
      image.name === UBUNTU_IMAGE_NAME &&
      image.type === 'system' &&
      image.status === 'available' &&
      image.architecture === EXPECTED_ARCHITECTURE &&
      image.osFlavor === 'ubuntu' &&
      image.osVersion === '24.04' &&
      image.deprecatedAt === null,
  );
  if (matches.length !== 1) {
    throw new Error(
      'Hetzner Ubuntu 24.04 x86 image selection did not resolve to exactly one current image.',
    );
  }
  return matches[0];
}

/**
 * Recompute the immutable plan identity and all aggregate action identities.
 * @param {unknown} value - Candidate serialized plan.
 * @param {string} [valuePath] - Human-readable path.
 * @returns {Readonly<HetznerSingleNodePlan>} - Canonical plan.
 */
export function validateHetznerSingleNodePlan(
  value,
  valuePath = 'hetznerSingleNodePlan',
) {
  const document = cloneBoundedJsonObject(value, PLAN_MAX_BYTES, valuePath);
  assertExactKeys(document, PLAN_KEYS, valuePath);
  if (
    document.schemaVersion !== HETZNER_SINGLE_NODE_PLAN_SCHEMA_VERSION ||
    document.kind !== HETZNER_SINGLE_NODE_PLAN_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  assertDomainSeparatedSha256Id(
    document.planId,
    HETZNER_SINGLE_NODE_PLAN_ID_PREFIX,
    `${valuePath}.planId`,
  );
  const desired = validateSingleNodeDeploymentDesired(
    document.desired,
    `${valuePath}.desired`,
  );
  if (document.deploymentInstanceId !== desired.deploymentInstanceId) {
    throw new Error(
      `${valuePath}.deploymentInstanceId does not match desired state.`,
    );
  }
  if (desired.intent.provider.kind !== 'hetzner') {
    throw new TypeError(`${valuePath}.desired must target Hetzner.`);
  }
  const providerSpec = validateProviderSpec(
    document.providerSpec,
    `${valuePath}.providerSpec`,
  );
  const inspection = cloneBoundedJsonObject(
    document.inspection,
    4096,
    `${valuePath}.inspection`,
  );
  assertExactKeys(inspection, INSPECTION_KEYS, `${valuePath}.inspection`);
  if (
    !['absent', 'unbound-conflict'].includes(inspection.status) ||
    !Number.isSafeInteger(inspection.observedOwnedResourceCount) ||
    inspection.observedOwnedResourceCount < 0
  ) {
    throw new TypeError(`${valuePath}.inspection is invalid.`);
  }
  const expectedStatus =
    inspection.status === 'absent' ? 'actionable' : 'blocked';
  const expectedBlockedReason =
    expectedStatus === 'blocked' ? 'unbound-provider-resources' : null;
  if (
    document.status !== expectedStatus ||
    document.blockedReason !== expectedBlockedReason
  ) {
    throw new Error(`${valuePath} status does not match provider inspection.`);
  }
  if (!Array.isArray(document.actions)) {
    throw new TypeError(`${valuePath}.actions must be an array.`);
  }
  const expectedActions =
    expectedStatus === 'blocked'
      ? []
      : (() => {
          const context = {
            deploymentInstanceId: desired.deploymentInstanceId,
            desiredRevisionId: desired.desiredRevisionId,
            providerSpecId: providerSpec.providerSpecId,
          };
          const provision = createAction(ACTION_KINDS[0], [], context);
          return [
            provision,
            createAction(ACTION_KINDS[1], [provision.actionId], context),
          ];
        })();
  if (document.actions.length !== expectedActions.length) {
    throw new Error(`${valuePath}.actions do not match its inspection.`);
  }
  for (let index = 0; index < expectedActions.length; index += 1) {
    const action = cloneBoundedJsonObject(
      document.actions[index],
      4096,
      `${valuePath}.actions[${index}]`,
    );
    assertExactKeys(action, ACTION_KEYS, `${valuePath}.actions[${index}]`);
    if (
      JSON.stringify(sortCanonicalJsonValue(action)) !==
      JSON.stringify(sortCanonicalJsonValue(expectedActions[index]))
    ) {
      throw new Error(
        `${valuePath}.actions[${index}] does not match the exact plan.`,
      );
    }
  }
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_SINGLE_NODE_PLAN_SCHEMA_VERSION,
      kind: HETZNER_SINGLE_NODE_PLAN_KIND,
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec,
      inspection: {
        status: inspection.status,
        observedOwnedResourceCount: inspection.observedOwnedResourceCount,
      },
      status: expectedStatus,
      blockedReason: expectedBlockedReason,
      actions: expectedActions,
    }),
  );
  const expectedPlanId = createCanonicalJsonSha256Id({
    domain: PLAN_ID_DOMAIN,
    prefix: HETZNER_SINGLE_NODE_PLAN_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.planId !== expectedPlanId) {
    throw new Error(`${valuePath}.planId does not match the exact plan.`);
  }
  assertManifestIsSecretFree(payload, valuePath);
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, planId: expectedPlanId }),
  );
}

/**
 * Produce one strictly read-only plan. The planner can discover provider
 * residue but cannot adopt it without the private local action journal; that
 * recovery path is handled by apply.
 * @param {unknown} value - Exact desired state and read-only API authority.
 * @returns {Promise<Readonly<HetznerSingleNodePlan>>} - Secret-free plan.
 */
export async function resolveHetznerSingleNodePlan(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerSingleNodePlan input must be an object.');
  }
  const input = /** @type {Record<string, any>} */ (value);
  assertExactKeys(input, INPUT_KEYS, 'hetznerSingleNodePlan');
  const desired = validateSingleNodeDeploymentDesired(
    input.desired,
    'hetznerSingleNodePlan.desired',
  );
  if (desired.intent.provider.kind !== 'hetzner') {
    throw new TypeError(
      'hetznerSingleNodePlan desired state must target Hetzner.',
    );
  }
  const api = snapshotReadApi(input.api);
  const labelSelector = getHetznerDeploymentLabelSelector(
    desired.deploymentInstanceId,
  );
  const [locations, serverTypes, images, firewalls, primaryIps, servers] =
    await Promise.all([
      api.listLocations({ name: desired.intent.provider.location }),
      api.listServerTypes(),
      api.listImages({
        name: UBUNTU_IMAGE_NAME,
        type: 'system',
        architecture: EXPECTED_ARCHITECTURE,
        includeDeprecated: false,
      }),
      api.listFirewalls({ labelSelector }),
      api.listPrimaryIps({ labelSelector }),
      api.listServers({ labelSelector }),
    ]);
  for (const result of [
    locations,
    serverTypes,
    images,
    firewalls,
    primaryIps,
    servers,
  ]) {
    if (!Array.isArray(result)) {
      throw new TypeError(
        'Hetzner read-only planning received an invalid provider list.',
      );
    }
  }
  const location = selectLocation(
    /** @type {Readonly<any[]>} */ (locations),
    desired.intent.provider.location,
  );
  const serverType = selectServerType(
    /** @type {Readonly<any[]>} */ (serverTypes),
    location,
  );
  const image = selectImage(/** @type {Readonly<any[]>} */ (images));
  const observedOwnedResourceCount =
    firewalls.length + primaryIps.length + servers.length;
  const inspectionStatus =
    observedOwnedResourceCount === 0 ? 'absent' : 'unbound-conflict';
  const providerSpec = createProviderSpec({
    schemaVersion: 1,
    kind: 'hetznerProviderSpec',
    location: { id: location.id, name: location.name },
    serverType: { id: serverType.id, name: serverType.name },
    image: { id: image.id, name: image.name },
    ownedResourceCount: EXPECTED_OWNED_RESOURCE_COUNT,
  });
  const context = {
    deploymentInstanceId: desired.deploymentInstanceId,
    desiredRevisionId: desired.desiredRevisionId,
    providerSpecId: providerSpec.providerSpecId,
  };
  const actions =
    inspectionStatus === 'absent'
      ? (() => {
          const provision = createAction(ACTION_KINDS[0], [], context);
          return [
            provision,
            createAction(ACTION_KINDS[1], [provision.actionId], context),
          ];
        })()
      : [];
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_SINGLE_NODE_PLAN_SCHEMA_VERSION,
      kind: HETZNER_SINGLE_NODE_PLAN_KIND,
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec,
      inspection: {
        status: inspectionStatus,
        observedOwnedResourceCount,
      },
      status: inspectionStatus === 'absent' ? 'actionable' : 'blocked',
      blockedReason:
        inspectionStatus === 'absent' ? null : 'unbound-provider-resources',
      actions,
    }),
  );
  assertManifestIsSecretFree(payload, 'hetznerSingleNodePlan');
  const planId = createCanonicalJsonSha256Id({
    domain: PLAN_ID_DOMAIN,
    prefix: HETZNER_SINGLE_NODE_PLAN_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerSingleNodePlan',
  });
  return validateHetznerSingleNodePlan(
    { ...payload, planId },
    'hetznerSingleNodePlan',
  );
}

export default {
  HETZNER_PROVIDER_SPEC_ID_PREFIX,
  HETZNER_SINGLE_NODE_ACTION_ID_PREFIX,
  HETZNER_SINGLE_NODE_PLAN_ID_PREFIX,
  HETZNER_SINGLE_NODE_PLAN_KIND,
  HETZNER_SINGLE_NODE_PLAN_SCHEMA_VERSION,
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
  validateHetznerSingleNodePlan,
};
