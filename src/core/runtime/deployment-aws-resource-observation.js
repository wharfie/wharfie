/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observation and routing contracts are clearer than repeated parser-specific expansions. */

import { validateSha256Digest } from './application-revision.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDeploymentActionId,
  validateOwnershipNonce,
  validateProviderResourceId,
} from './deployment-resource-binding.js';
import {
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDefinition,
} from './deployment-resource-graph.js';
import { cloneJsonObject } from './json-value.js';

export const AWS_SINGLE_NODE_RESOURCE_OBSERVATION_PRESENCES = Object.freeze([
  'present',
  'absent',
  'unknown',
]);
export const AWS_SINGLE_NODE_RESOURCE_OBSERVATION_OWNERSHIP = Object.freeze([
  'verified',
  'external',
  'missing',
  'conflict',
  'unknown',
]);
export const AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH = Object.freeze([
  'starting',
  'degraded',
  'stopped',
  'failed',
  'absent',
  'unknown',
  'not-applicable',
]);
export const AWS_SINGLE_NODE_RESOURCE_OBSERVATION_EXECUTIONS = Object.freeze([
  'none',
  'replay-safe-create',
]);
/** Graph roles whose provider create API accepts Wharfie's stable client token. */
export const AWS_SINGLE_NODE_RESOURCE_REPLAY_SAFE_CREATE_KEYS = Object.freeze([
  'application-state',
  'control-state',
  'network-route-table',
  'substrate',
]);
export const AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED =
  'AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED';

const OBSERVATION_KEYS = new Set([
  'resourceKey',
  'presence',
  'ownership',
  'providerIdentity',
  'observedDigest',
  'health',
  'execution',
]);
const PROVIDER_IDENTITY_KEYS = new Set(['providerType', 'providerResourceId']);
const ROUTER_KEYS = new Set(['observers']);
const OBSERVER_KEYS = new Set([
  'managedArtifact',
  'volume',
  'vpc',
  'internetGateway',
  'internetGatewayAttachment',
  'subnet',
  'routeTable',
  'defaultIpv4Route',
  'subnetRouteTableAssociation',
  'securityGroup',
  'runtimeRole',
  'runtimeRolePolicy',
  'instanceProfile',
  'instanceProfileRoleAssociation',
  'node',
  'volumeAttachment',
]);
const OBSERVER_PORT_KEYS = new Set(['observe']);
const PRESENCES = new Set(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_PRESENCES);
const OWNERSHIP = new Set(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_OWNERSHIP);
const HEALTH = new Set(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH);
const EXECUTIONS = new Set(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_EXECUTIONS);
const REPLAY_SAFE_CREATE_RESOURCE_KEYS = new Set(
  AWS_SINGLE_NODE_RESOURCE_REPLAY_SAFE_CREATE_KEYS,
);
const SUBSTRATE_PRESENT_HEALTH = new Set([
  'starting',
  'degraded',
  'stopped',
  'failed',
]);
const ROUTE_COVERAGE_ERROR =
  'AWS single-node resource observation router coverage is invalid.';
const PRESENT_OBSERVATION_ERROR =
  'awsSingleNodeResourceObservation present evidence has an unsupported identity, ownership, digest, or health combination.';
const REPLAY_SAFE_CREATE_AUTHORITY_ERROR =
  'AWS single-node resource observation replay-safe create execution does not match its exact current action authority.';
const REPLAY_SAFE_CREATE_RESOURCE_ERROR =
  'awsSingleNodeResourceObservation replay-safe create execution is not supported for this resourceKey.';

/** One observation request cannot be routed to an exact graph resource. */
export class AwsSingleNodeResourceObservationRouteUnsupportedError extends Error {
  constructor() {
    super('AWS single-node resource observation route is unsupported.');
    this.name = 'AwsSingleNodeResourceObservationRouteUnsupportedError';
    this.code = AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED;
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} definition @param {string} path @returns {Readonly<Record<string, string>>|null} */
function validateProviderIdentity(value, definition, path) {
  if (value === null) return null;
  const identity = cloneJsonObject(value, path);
  assertExactKeys(identity, PROVIDER_IDENTITY_KEYS, path);
  if (identity.providerType !== definition.providerType) {
    throw new Error(
      `${path}.providerType does not match the exact AWS single-node resource graph role.`,
    );
  }
  return Object.freeze({
    providerType: identity.providerType,
    providerResourceId: validateProviderResourceId(
      identity.providerResourceId,
      `${path}.providerResourceId`,
    ),
  });
}

/**
 * Validate one raw provider-resource observation before aggregate inspection
 * adds graph lineage, desired state, or resident service health.
 * @param {unknown} value - Candidate raw observation.
 * @param {unknown} [expectedResourceKey] - Optional exact routed resource key.
 * @returns {Readonly<Record<string, any>>} - Canonical raw observation.
 */
export function validateAwsSingleNodeResourceObservation(
  value,
  expectedResourceKey = undefined,
) {
  const observation = cloneJsonObject(
    value,
    'awsSingleNodeResourceObservation',
  );
  assertExactKeys(
    observation,
    OBSERVATION_KEYS,
    'awsSingleNodeResourceObservation',
  );
  const definition = getAwsSingleNodeResourceDefinition(
    observation.resourceKey,
  );
  if (definition === null) {
    throw new TypeError(
      'awsSingleNodeResourceObservation.resourceKey is not supported by the AWS single-node resource graph.',
    );
  }
  if (expectedResourceKey !== undefined) {
    const expectedDefinition =
      getAwsSingleNodeResourceDefinition(expectedResourceKey);
    if (expectedDefinition === null) {
      throw new TypeError(
        'awsSingleNodeResourceObservation expectedResourceKey is not supported by the AWS single-node resource graph.',
      );
    }
    if (observation.resourceKey !== expectedDefinition.resourceKey) {
      throw new Error(
        'awsSingleNodeResourceObservation.resourceKey does not match its exact routed resource key.',
      );
    }
  }
  if (!PRESENCES.has(observation.presence)) {
    throw new TypeError(
      'awsSingleNodeResourceObservation.presence is not supported.',
    );
  }
  if (!OWNERSHIP.has(observation.ownership)) {
    throw new TypeError(
      'awsSingleNodeResourceObservation.ownership is not supported.',
    );
  }
  if (!HEALTH.has(observation.health)) {
    throw new TypeError(
      'awsSingleNodeResourceObservation.health is not supported.',
    );
  }
  if (!EXECUTIONS.has(observation.execution)) {
    throw new TypeError(
      'awsSingleNodeResourceObservation.execution is not supported.',
    );
  }
  const providerIdentity = validateProviderIdentity(
    observation.providerIdentity,
    definition,
    'awsSingleNodeResourceObservation.providerIdentity',
  );
  const observedDigest =
    observation.observedDigest === null
      ? null
      : validateSha256Digest(
          observation.observedDigest,
          'awsSingleNodeResourceObservation.observedDigest',
        );

  if (
    observation.presence === 'absent' &&
    (observation.ownership !== 'missing' ||
      providerIdentity !== null ||
      observedDigest !== null ||
      observation.health !== 'absent' ||
      observation.execution !== 'none')
  ) {
    throw new Error(
      'awsSingleNodeResourceObservation absent evidence must be missing, unidentified, undigested, and absent-health.',
    );
  }
  if (
    observation.presence === 'unknown' &&
    (observation.ownership !== 'unknown' ||
      providerIdentity !== null ||
      observedDigest !== null ||
      observation.health !== 'unknown')
  ) {
    throw new Error(
      'awsSingleNodeResourceObservation unknown evidence must have unknown ownership and health without identity or digest.',
    );
  }
  if (observation.presence === 'present') {
    const ownershipIsVerifiedOrExternal =
      observation.ownership === 'verified' ||
      observation.ownership === 'external';
    const healthIsValid =
      definition.resourceKey === 'substrate'
        ? SUBSTRATE_PRESENT_HEALTH.has(observation.health) ||
          (observation.ownership === 'conflict' &&
            observation.health === 'unknown')
        : observation.health === 'not-applicable';
    if (
      providerIdentity === null ||
      !['verified', 'external', 'conflict'].includes(observation.ownership) ||
      !healthIsValid ||
      observation.execution !== 'none' ||
      (ownershipIsVerifiedOrExternal && observedDigest === null)
    ) {
      throw new Error(PRESENT_OBSERVATION_ERROR);
    }
  }
  if (
    observation.execution === 'replay-safe-create' &&
    !REPLAY_SAFE_CREATE_RESOURCE_KEYS.has(definition.resourceKey)
  ) {
    throw new Error(REPLAY_SAFE_CREATE_RESOURCE_ERROR);
  }

  return deepFreeze(
    sortCanonicalJsonValue({
      resourceKey: definition.resourceKey,
      presence: observation.presence,
      ownership: observation.ownership,
      providerIdentity,
      observedDigest,
      health: observation.health,
      execution: observation.execution,
    }),
  );
}

/** @param {unknown} value @param {string} observerKey @returns {Readonly<{observe: (context: unknown) => unknown}>} */
function validateObserver(value, observerKey) {
  const path = `awsSingleNodeResourceObservationRouter observers.${observerKey}`;
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  assertExactKeys(value, OBSERVER_PORT_KEYS, path);
  if (typeof value.observe !== 'function') {
    throw new TypeError(`${path}.observe must be a function.`);
  }
  return Object.freeze({ observe: value.observe });
}

/** @param {Map<string, Readonly<Record<string, any>>>} routes @returns {void} */
function assertRouteCoverage(routes) {
  const applyOrder = getAwsSingleNodeResourceApplyOrder();
  const routeKeys = [...routes.keys()];
  if (
    routeKeys.length !== applyOrder.length ||
    routeKeys.some((resourceKey, index) => resourceKey !== applyOrder[index])
  ) {
    throw new Error(ROUTE_COVERAGE_ERROR);
  }
}

/** @param {unknown} context @param {Map<string, Readonly<Record<string, any>>>} routes @returns {{resourceKey: string, observer: Readonly<Record<string, any>>}} */
function resolveRoute(context, routes) {
  try {
    if (!isPlainObject(context) || !Object.hasOwn(context, 'target')) {
      throw new AwsSingleNodeResourceObservationRouteUnsupportedError();
    }
    const target = context.target;
    if (!isPlainObject(target) || !Object.hasOwn(target, 'resourceKey')) {
      throw new AwsSingleNodeResourceObservationRouteUnsupportedError();
    }
    const resourceKey = target.resourceKey;
    if (typeof resourceKey !== 'string') {
      throw new AwsSingleNodeResourceObservationRouteUnsupportedError();
    }
    const observer = routes.get(resourceKey);
    if (observer === undefined) {
      throw new AwsSingleNodeResourceObservationRouteUnsupportedError();
    }
    return { resourceKey, observer };
  } catch {
    throw new AwsSingleNodeResourceObservationRouteUnsupportedError();
  }
}

/**
 * A replay recommendation is valid only for the exact current managed create.
 * Observer-specific authority validation remains responsible for proving the
 * complete deployment context before it can return this result.
 * @param {unknown} context - Exact observation authority passed to the observer.
 * @param {string} resourceKey - Exact routed graph role.
 * @returns {void}
 */
function assertReplaySafeCreateAuthority(context, resourceKey) {
  try {
    if (
      !isPlainObject(context) ||
      !Object.hasOwn(context, 'currentAction') ||
      !isPlainObject(context.currentAction) ||
      !Object.hasOwn(context.currentAction, 'action') ||
      !Object.hasOwn(context.currentAction, 'ownershipNonce') ||
      !isPlainObject(context.currentAction.action) ||
      !Object.hasOwn(context.currentAction.action, 'action') ||
      !Object.hasOwn(context.currentAction.action, 'actionId') ||
      !Object.hasOwn(context.currentAction.action, 'management') ||
      !Object.hasOwn(context.currentAction.action, 'ownershipMode') ||
      !Object.hasOwn(context.currentAction.action, 'resourceKey') ||
      context.currentAction.action.action !== 'create' ||
      context.currentAction.action.management !== 'managed' ||
      context.currentAction.action.ownershipMode !== 'direct' ||
      context.currentAction.action.resourceKey !== resourceKey
    ) {
      throw new Error(REPLAY_SAFE_CREATE_AUTHORITY_ERROR);
    }
    assertDeploymentActionId(
      context.currentAction.action.actionId,
      'awsSingleNodeResourceObservation current actionId',
    );
    validateOwnershipNonce(
      context.currentAction.ownershipNonce,
      'awsSingleNodeResourceObservation current ownershipNonce',
    );
  } catch {
    throw new Error(REPLAY_SAFE_CREATE_AUTHORITY_ERROR);
  }
}

/**
 * Compose the complete read-only AWS single-node resource observation surface.
 * The router accepts no mutation ports and forwards the caller's exact context
 * once to the one observer selected by its desired target resource key.
 * @param {unknown} options - Exact fixed observer family mapping.
 * @returns {Readonly<{observeResource: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Read-only observation router.
 */
export function createAwsSingleNodeResourceObservationRouter(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeResourceObservationRouter options must be an object.',
    );
  }
  assertExactKeys(
    options,
    ROUTER_KEYS,
    'awsSingleNodeResourceObservationRouter options',
  );
  if (!isPlainObject(options.observers)) {
    throw new TypeError(
      'awsSingleNodeResourceObservationRouter observers must be an object.',
    );
  }
  assertExactKeys(
    options.observers,
    OBSERVER_KEYS,
    'awsSingleNodeResourceObservationRouter observers',
  );
  const observers = Object.fromEntries(
    [...OBSERVER_KEYS].map((observerKey) => [
      observerKey,
      validateObserver(options.observers[observerKey], observerKey),
    ]),
  );
  const routes = new Map([
    ['artifact', observers.managedArtifact],
    ['application-state', observers.volume],
    ['control-state', observers.volume],
    ['network-vpc', observers.vpc],
    ['network-internet-gateway', observers.internetGateway],
    [
      'network-internet-gateway-attachment',
      observers.internetGatewayAttachment,
    ],
    ['network-subnet', observers.subnet],
    ['network-route-table', observers.routeTable],
    ['network-default-ipv4-route', observers.defaultIpv4Route],
    [
      'network-subnet-route-table-association',
      observers.subnetRouteTableAssociation,
    ],
    ['network-security-group', observers.securityGroup],
    ['runtime-role', observers.runtimeRole],
    ['runtime-role-policy', observers.runtimeRolePolicy],
    ['runtime-identity', observers.instanceProfile],
    [
      'runtime-identity-role-association',
      observers.instanceProfileRoleAssociation,
    ],
    ['substrate', observers.node],
    ['application-state-attachment', observers.volumeAttachment],
    ['control-state-attachment', observers.volumeAttachment],
  ]);
  assertRouteCoverage(routes);

  /** @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
  async function observeResource(context) {
    const { resourceKey, observer } = resolveRoute(context, routes);
    const observation = await observer.observe(context);
    const validated = validateAwsSingleNodeResourceObservation(
      observation,
      resourceKey,
    );
    if (validated.execution === 'replay-safe-create') {
      assertReplaySafeCreateAuthority(context, resourceKey);
    }
    return validated;
  }

  return Object.freeze({ observeResource });
}

export default {
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_EXECUTIONS,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_OWNERSHIP,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_PRESENCES,
  AWS_SINGLE_NODE_RESOURCE_REPLAY_SAFE_CREATE_KEYS,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED,
  AwsSingleNodeResourceObservationRouteUnsupportedError,
  createAwsSingleNodeResourceObservationRouter,
  validateAwsSingleNodeResourceObservation,
};
