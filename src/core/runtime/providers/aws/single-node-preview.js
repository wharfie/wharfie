/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This narrow composition root keeps its injected read-only authority protocol beside the implementation. */

import { validateProviderScope } from '../../deployment-provider-scope.js';
import { validateSingleNodeDeploymentDesired } from '../../single-node-deployment-desired.js';
import { createAwsSingleNodeReadAuthority } from './authority.js';
import {
  resolveAwsSingleNodePlan,
  validateAwsSingleNodePlan,
} from './single-node-plan.js';

const INPUT_KEYS = new Set(['desired']);
const DEPENDENCY_KEYS = new Set(['createReadAuthority', 'resolvePlan']);
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
  'describeInstanceTypeOfferings',
  'describeInstances',
  'describeInternetGateways',
  'describeNetworkAcls',
  'describeRouteTables',
  'describeSecurityGroups',
  'describeSubnets',
  'describeVolumes',
  'describeVpcs',
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
 * Snapshot an exact enumerable own-data object without invoking accessors.
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
 * Project only planner reads without retaining a receiver that may contain
 * sibling mutation capabilities.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('awsSingleNodePreview.readAuthority.api is invalid.');
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
        `awsSingleNodePreview.readAuthority.api.${method} must be an own read method.`,
      );
    }
    const capability = descriptor.value;
    result[method] = (/** @type {unknown} */ request) =>
      Reflect.apply(capability, undefined, [request]);
  }
  return Object.freeze(result);
}

/**
 * Capture cleanup before inspecting the rest of an opened authority.
 * @param {unknown} value
 * @returns {Readonly<{capability: Function, close(): Promise<void>}>}
 */
function captureLifecycle(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'awsSingleNodePreview.readAuthority.close must be an own function.',
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
      'awsSingleNodePreview.readAuthority.close must be an own function.',
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
 * @param {unknown} value
 * @param {Readonly<{capability: Function, close(): Promise<void>}>} lifecycle
 * @returns {Readonly<Record<string, any>>}
 */
function validateAuthority(value, lifecycle) {
  const authority = snapshotExactObject(
    value,
    AUTHORITY_KEYS,
    'awsSingleNodePreview.readAuthority',
  );
  if (
    authority.schemaVersion !== 1 ||
    authority.kind !== 'awsSingleNodeReadAuthority' ||
    typeof authority.resolveScope !== 'function' ||
    authority.close !== lifecycle.capability
  ) {
    throw new TypeError(
      'awsSingleNodePreview read authority has an unsupported contract.',
    );
  }
  const providerScope = validateProviderScope(
    authority.providerScope,
    'awsSingleNodePreview.readAuthority.providerScope',
  );
  const resolveScopeCapability = authority.resolveScope;
  return Object.freeze({
    providerScope,
    api: snapshotReadApi(authority.api),
    async resolveScope() {
      return validateProviderScope(
        await Reflect.apply(resolveScopeCapability, undefined, []),
        'awsSingleNodePreview.readAuthority.resolvedScope',
      );
    },
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
    'awsSingleNodePreview dependencies',
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(
        `awsSingleNodePreview dependency ${key} must be a function.`,
      );
    }
  }
  return Object.freeze(dependencies);
}

/**
 * Create a testable, structurally read-only AWS preview boundary.
 * @param {unknown} dependencies
 * @returns {(value: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createAwsSingleNodePreviewFactory(dependencies) {
  const ports = validateDependencies(dependencies);

  return async function preview(value) {
    const input = snapshotExactObject(
      value,
      INPUT_KEYS,
      'awsSingleNodePreview',
    );
    const desired = validateSingleNodeDeploymentDesired(
      input.desired,
      'awsSingleNodePreview.desired',
    );
    if (desired.intent.provider.kind !== 'aws') {
      throw new TypeError(
        'awsSingleNodePreview desired state must target AWS.',
      );
    }

    /** @type {Readonly<{capability: Function, close(): Promise<void>}>|undefined} */
    let lifecycle;
    /** @type {unknown} */
    let operationError;
    /** @type {Readonly<Record<string, any>>|undefined} */
    let result;
    try {
      const opened = await Reflect.apply(ports.createReadAuthority, undefined, [
        { region: desired.intent.provider.region },
      ]);
      lifecycle = captureLifecycle(opened);
      const authority = validateAuthority(opened, lifecycle);
      const providerScope = await authority.resolveScope();
      if (
        providerScope.providerScopeId !==
        authority.providerScope.providerScopeId
      ) {
        throw new Error(
          'awsSingleNodePreview ambient credential scope changed during planning.',
        );
      }
      const plan = validateAwsSingleNodePlan(
        await Reflect.apply(ports.resolvePlan, undefined, [
          { desired, providerScope, api: authority.api },
        ]),
        'awsSingleNodePreview.plan',
      );
      if (
        plan.deploymentInstanceId !== desired.deploymentInstanceId ||
        plan.desired.desiredRevisionId !== desired.desiredRevisionId ||
        plan.providerSpec.providerScope.providerScopeId !==
          providerScope.providerScopeId
      ) {
        throw new Error(
          'awsSingleNodePreview plan does not match its exact desired state and credential scope.',
        );
      }
      result = plan;
    } catch (error) {
      operationError = error;
    }

    /** @type {unknown} */
    let cleanupError;
    if (lifecycle !== undefined) {
      try {
        await lifecycle.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    if (operationError !== undefined && cleanupError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        'AWS single-node preview failed and its read authority could not be closed.',
      );
    }
    if (operationError !== undefined) throw operationError;
    if (cleanupError !== undefined) throw cleanupError;
    return /** @type {Readonly<Record<string, any>>} */ (result);
  };
}

const productionPreview = createAwsSingleNodePreviewFactory({
  createReadAuthority: createAwsSingleNodeReadAuthority,
  resolvePlan: resolveAwsSingleNodePlan,
});

/**
 * Resolve one production AWS preview through ambient credential-chain reads.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function createAwsSingleNodePreview(value) {
  return await Reflect.apply(productionPreview, undefined, [value]);
}

export default {
  createAwsSingleNodePreview,
  createAwsSingleNodePreviewFactory,
};
