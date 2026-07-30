/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow composition root keeps its injected read-only API protocol beside the implementation. */

import process from 'node:process';

import { validateSingleNodeDeploymentDesired } from '../../single-node-deployment-desired.js';
import { createHetznerPreviewApiClient } from './api-client.js';
import {
  resolveHetznerSingleNodePlan,
  validateHetznerSingleNodePlan,
} from './single-node-plan.js';

const INPUT_KEYS = new Set(['desired']);
const DEPENDENCY_KEYS = new Set([
  'createReadClient',
  'resolvePlan',
  'readToken',
]);
const PLAN_READ_METHODS = Object.freeze([
  'listLocations',
  'listServerTypes',
  'listImages',
  'listFirewalls',
  'listPrimaryIps',
  'listServers',
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
 * Re-project only planner list methods so injected clients cannot smuggle
 * mutation capabilities or a privileged receiver into the resolver.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerSingleNodePreview API client is invalid.');
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of PLAN_READ_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `hetznerSingleNodePreview.api.${method} must be an own read method.`,
      );
    }
    const capability = descriptor.value;
    result[method] = (/** @type {unknown} */ request) =>
      Reflect.apply(capability, undefined, [request]);
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function validateDependencies(value) {
  const dependencies = snapshotExactObject(
    value,
    DEPENDENCY_KEYS,
    'hetznerSingleNodePreview dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `hetznerSingleNodePreview dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * Create a testable Hetzner preview boundary that never receives write
 * capabilities and keeps the ambient token out of the returned plan.
 * @param {unknown} dependencies
 * @returns {(value: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createHetznerSingleNodePreviewFactory(dependencies) {
  const ports = validateDependencies(dependencies);

  return async function preview(value) {
    const input = snapshotExactObject(
      value,
      INPUT_KEYS,
      'hetznerSingleNodePreview',
    );
    const desired = validateSingleNodeDeploymentDesired(
      input.desired,
      'hetznerSingleNodePreview.desired',
    );
    if (desired.intent.provider.kind !== 'hetzner') {
      throw new TypeError(
        'hetznerSingleNodePreview desired state must target Hetzner.',
      );
    }
    const token = await Reflect.apply(ports.readToken, undefined, []);
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.trim() !== token
    ) {
      throw new Error(
        'Hetzner preview requires ambient HCLOUD_TOKEN authority.',
      );
    }
    const api = snapshotReadApi(
      await Reflect.apply(ports.createReadClient, undefined, [{ token }]),
    );
    const plan = validateHetznerSingleNodePlan(
      await Reflect.apply(ports.resolvePlan, undefined, [{ desired, api }]),
      'hetznerSingleNodePreview.plan',
    );
    if (
      plan.deploymentInstanceId !== desired.deploymentInstanceId ||
      plan.desired.desiredRevisionId !== desired.desiredRevisionId
    ) {
      throw new Error(
        'hetznerSingleNodePreview plan does not match its exact desired state.',
      );
    }
    return plan;
  };
}

const productionPreview = createHetznerSingleNodePreviewFactory({
  createReadClient: createHetznerPreviewApiClient,
  resolvePlan: resolveHetznerSingleNodePlan,
  readToken: () => process.env.HCLOUD_TOKEN,
});

/**
 * Resolve one production Hetzner preview through ambient token-scoped reads.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function createHetznerSingleNodePreview(value) {
  return await Reflect.apply(productionPreview, undefined, [value]);
}

export default {
  createHetznerSingleNodePreview,
  createHetznerSingleNodePreviewFactory,
};
