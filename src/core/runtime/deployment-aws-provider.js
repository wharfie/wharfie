/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- The provider is an intentionally narrow composition boundary over independently validated ports. */

import { createAwsSingleNodeDeploymentPlan } from './deployment-aws-plan.js';

const FACTORY_KEYS = new Set([
  'scopeResolver',
  'providerSpecResolver',
  'inspectionProvider',
  'resourceRouter',
  'createPlan',
]);
const FACTORY_REQUIRED_KEYS = new Set([
  'scopeResolver',
  'providerSpecResolver',
  'inspectionProvider',
  'resourceRouter',
]);
const SCOPE_RESOLVER_KEYS = new Set(['resolveScope']);
const PROVIDER_SPEC_RESOLVER_KEYS = new Set([
  'resolveProviderSpec',
  'validateProviderSpec',
]);
const INSPECTION_PROVIDER_KEYS = new Set(['inspect']);
const RESOURCE_ROUTER_KEYS = new Set(['executeAction', 'verifySettlement']);

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertSupportedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/**
 * Fence one independently composed port to its exact capability surface.
 * Exactness prevents a mutation-capable resource router from being
 * accidentally installed as the read-only inspection provider.
 * @param {unknown} value - Candidate port.
 * @param {Set<string>} keys - Complete allowed and required method set.
 * @param {string} path - Human-readable boundary path.
 * @returns {Record<string, Function>} - Validated port.
 */
function validatePort(value, keys, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  assertSupportedKeys(value, keys, path);
  assertRequiredKeys(value, keys, path);
  for (const method of keys) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${path}.${method} must be a function.`);
    }
  }
  return value;
}

/**
 * Capture one port method without changing its receiver, argument, synchronous
 * throw, return value, or returned Promise identity.
 * @param {Record<string, Function>} port - Validated owner.
 * @param {string} method - Owned method.
 * @returns {(context: unknown) => unknown} - Exact one-argument delegation.
 */
function capture(port, method) {
  const implementation = port[method];
  return (context) => Reflect.apply(implementation, port, [context]);
}

/**
 * Keep the controller-facing inspection context and the pure planning tuple
 * separate. In particular, active/settled plans and pending bindings are
 * aggregate inspection authority and must never become planner inputs.
 * @param {unknown} context - Controller createPlan context.
 * @returns {unknown} - Canonical DeploymentPlanV3 or a validation error.
 */
function createDefaultPlan(context) {
  if (!isPlainObject(context)) {
    return createAwsSingleNodeDeploymentPlan(context);
  }
  return createAwsSingleNodeDeploymentPlan(
    Object.freeze({
      operation: context.operation,
      deploymentRevision: context.deploymentRevision,
      profile: context.profile,
      providerScope: context.providerScope,
      providerSpec: context.providerSpec,
      deploymentInstanceId: context.deploymentInstanceId,
      incarnationId: context.incarnationId,
      head: context.head,
      inspection: context.inspection,
    }),
  );
}

/**
 * Compose the controller's complete AWS single-node provider port from
 * independently owned scope, provider-spec, observation, planning, and
 * mutation capabilities.
 *
 * A supplied createPlan function is treated as a controller-facing port and
 * receives its argument unchanged. Without one, the built-in pure AWS planner
 * receives only its exact deterministic input tuple.
 * @param {unknown} options - Exact provider sub-ports and optional planner.
 * @returns {Readonly<{resolveScope: (context: unknown) => unknown, resolveProviderSpec: (context: unknown) => unknown, validateProviderSpec: (context: unknown) => unknown, inspect: (context: unknown) => unknown, createPlan: (context: unknown) => unknown, executeAction: (context: unknown) => unknown, verifySettlement: (context: unknown) => unknown}>} - Frozen controller provider.
 */
export function createAwsSingleNodeDeploymentProvider(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDeploymentProvider options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeDeploymentProvider options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeDeploymentProvider options',
  );

  const scopeResolver = validatePort(
    options.scopeResolver,
    SCOPE_RESOLVER_KEYS,
    'awsSingleNodeDeploymentProvider scopeResolver',
  );
  const providerSpecResolver = validatePort(
    options.providerSpecResolver,
    PROVIDER_SPEC_RESOLVER_KEYS,
    'awsSingleNodeDeploymentProvider providerSpecResolver',
  );
  const inspectionProvider = validatePort(
    options.inspectionProvider,
    INSPECTION_PROVIDER_KEYS,
    'awsSingleNodeDeploymentProvider inspectionProvider',
  );
  const resourceRouter = validatePort(
    options.resourceRouter,
    RESOURCE_ROUTER_KEYS,
    'awsSingleNodeDeploymentProvider resourceRouter',
  );
  if (
    Object.hasOwn(options, 'createPlan') &&
    typeof options.createPlan !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeDeploymentProvider options.createPlan must be a function.',
    );
  }

  return Object.freeze({
    resolveScope: capture(scopeResolver, 'resolveScope'),
    resolveProviderSpec: capture(providerSpecResolver, 'resolveProviderSpec'),
    validateProviderSpec: capture(providerSpecResolver, 'validateProviderSpec'),
    inspect: capture(inspectionProvider, 'inspect'),
    createPlan: Object.hasOwn(options, 'createPlan')
      ? capture(options, 'createPlan')
      : createDefaultPlan,
    executeAction: capture(resourceRouter, 'executeAction'),
    verifySettlement: capture(resourceRouter, 'verifySettlement'),
  });
}

export default {
  createAwsSingleNodeDeploymentProvider,
};
