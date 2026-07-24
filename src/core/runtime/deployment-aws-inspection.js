/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-composition contracts are clearer than repeated parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from './deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeDestroyedResourceLocator } from './deployment-aws-destroyed-resource-locator.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { validateDeploymentHead } from './deployment-head.js';
import { createDeploymentInspection } from './deployment-inspection.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  assertDeploymentIncarnationId,
  validateDeploymentResourceBinding,
} from './deployment-resource-binding.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { getAwsSingleNodeResourceApplyOrder } from './deployment-resource-graph.js';
import {
  DeploymentServiceHealthConflictError,
  DeploymentServiceHealthMissingError,
  DeploymentServiceHealthStaleError,
  DeploymentServiceHealthUnknownError,
  validateDeploymentServiceHealthObservation,
} from './deployment-service-health-s3.js';
import { cloneJsonObject } from './json-value.js';

const FACTORY_KEYS = new Set([
  'resourceObservationRouter',
  'serviceHealth',
  'now',
]);
const FACTORY_REQUIRED_KEYS = new Set([
  'resourceObservationRouter',
  'serviceHealth',
]);
const RESOURCE_OBSERVATION_ROUTER_KEYS = new Set(['observeResource']);
const SERVICE_HEALTH_KEYS = new Set(['inspect']);
const INSPECTION_CONTEXT_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
  'plan',
  'settledPlan',
  'pendingBinding',
]);
const OPERATIONS = new Set(['apply', 'reconcile', 'destroy']);
const DESTROYED_LOCATOR_OBSERVER_RESOURCE_KEYS = new Set([
  'substrate',
  'application-state-attachment',
  'control-state-attachment',
]);
const DESTROY_ABSENCE_CONTAINERS = Object.freeze({
  'network-internet-gateway-attachment': Object.freeze([
    'network-vpc',
    'network-internet-gateway',
  ]),
  'network-subnet': Object.freeze(['network-vpc']),
  'network-route-table': Object.freeze(['network-vpc']),
  'network-default-ipv4-route': Object.freeze(['network-route-table']),
  'network-subnet-route-table-association': Object.freeze([
    'network-subnet',
    'network-route-table',
  ]),
  'network-security-group': Object.freeze(['network-vpc']),
  'runtime-role-policy': Object.freeze(['runtime-role']),
  'runtime-identity-role-association': Object.freeze([
    'runtime-role',
    'runtime-identity',
  ]),
});

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

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} value @param {Set<string>} keys @param {string} path @returns {Readonly<Record<string, any>>} */
function validateReadPort(value, keys, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  assertExactKeys(value, keys, path);
  for (const key of keys) {
    if (typeof value[key] !== 'function') {
      throw new TypeError(`${path}.${key} must be a function.`);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      [...keys].map((key) => {
        const implementation = value[key];
        return [
          key,
          (/** @type {unknown} */ context) =>
            Reflect.apply(implementation, value, [context]),
        ];
      }),
    ),
  );
}

/** @param {unknown} value @returns {number} */
function validateNow(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      'awsSingleNodeDeploymentInspectionProvider now() must return a nonnegative safe integer.',
    );
  }
  return value;
}

/**
 * Validate the immutable tuple that is meaningful before any durable head
 * exists. A null head is authoritative absence and cannot authorize resource
 * or resident-service reads.
 * @param {Readonly<Record<string, any>>} input - Exact provider context.
 * @returns {Readonly<Record<string, any>>} - Canonical absent authority.
 */
function validateAbsentAuthority(input) {
  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    'awsSingleNodeDeploymentInspectionProvider context.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'awsSingleNodeDeploymentInspectionProvider context.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsSingleNodeDeploymentInspectionProvider context.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    input.providerSpec,
    { profile, providerScope },
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsSingleNodeDeploymentInspectionProvider context.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    input.incarnationId,
    'awsSingleNodeDeploymentInspectionProvider context.incarnationId',
  );
  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId ||
    input.deploymentInstanceId !==
      getDeploymentInstanceId({ deploymentRevision, providerScope })
  ) {
    throw new Error(
      'AWS single-node deployment inspection context does not match its exact deployment revision, profile, provider scope, and instance identity.',
    );
  }
  if (
    input.plan !== null ||
    input.settledPlan !== null ||
    input.pendingBinding !== null
  ) {
    throw new Error(
      'AWS single-node deployment inspection null-head authority requires null plan, settledPlan, and pendingBinding.',
    );
  }
  return Object.freeze({
    deploymentRevision,
    profile,
    providerScope,
    providerSpec,
  });
}

/** @param {Readonly<Record<string, any>>} pendingBinding @param {Readonly<Record<string, any>>} input @param {Readonly<Record<string, any>>[]} authorities @returns {void} */
function assertPendingBindingAuthority(pendingBinding, input, authorities) {
  const head = /** @type {Readonly<Record<string, any>>} */ (input.head);
  const bindingByKey = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const authority = authorities.find(
    (candidate) => candidate.target.resourceKey === pendingBinding.resourceKey,
  );
  const current = authority?.currentAction ?? null;
  const action = current?.action ?? null;
  const isManagedCreate =
    action?.management === 'managed' &&
    action.action === 'create' &&
    action.before === null &&
    action.after !== null;
  const isExternalVerify =
    action?.management === 'external' &&
    action.action === 'verify' &&
    action.before !== null &&
    action.after !== null;
  if (
    authority === undefined ||
    current === null ||
    action === null ||
    (!isManagedCreate && !isExternalVerify) ||
    action.after === null ||
    bindingByKey.has(pendingBinding.resourceKey) ||
    pendingBinding.deploymentInstanceId !== input.deploymentInstanceId ||
    pendingBinding.providerScopeId !== input.providerScope.providerScopeId ||
    pendingBinding.incarnationId !== input.incarnationId ||
    pendingBinding.resourceKey !== action.resourceKey ||
    !sameJson(pendingBinding.capability, action.capability) ||
    !sameJson(pendingBinding.role, action.role) ||
    pendingBinding.management !== action.management ||
    pendingBinding.ownershipMode !==
      (action.management === 'external' ? 'external' : action.ownershipMode) ||
    pendingBinding.onDestroy !== action.onDestroy ||
    pendingBinding.providerType !== action.after.providerType ||
    (action.after.providerResourceId !== null &&
      pendingBinding.providerResourceId !== action.after.providerResourceId) ||
    (isManagedCreate &&
      (pendingBinding.ownershipNonce !== current.ownershipNonce ||
        pendingBinding.createdByActionId !== action.actionId)) ||
    (isExternalVerify &&
      (current.ownershipNonce !== null ||
        Object.hasOwn(pendingBinding, 'ownershipNonce') ||
        Object.hasOwn(pendingBinding, 'createdByActionId')))
  ) {
    throw new Error(
      'AWS single-node deployment inspection pendingBinding does not match the exact current intended managed create or external verify action.',
    );
  }
  const expectedDependencies = action.dependsOn
    .map((/** @type {string} */ resourceKey) => {
      const dependency = bindingByKey.get(resourceKey);
      if (dependency === undefined) {
        throw new Error(
          'AWS single-node deployment inspection pendingBinding has an unresolved durable dependency.',
        );
      }
      return { resourceKey, bindingId: dependency.bindingId };
    })
    .sort(
      (
        /** @type {{resourceKey: string}} */ left,
        /** @type {{resourceKey: string}} */ right,
      ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
  if (!sameJson(pendingBinding.dependencyBindings, expectedDependencies)) {
    throw new Error(
      'AWS single-node deployment inspection pendingBinding dependencies do not match the exact durable head.',
    );
  }
}

/**
 * Fence every resource authority, including active and predecessor plan
 * lineage, before any observer is allowed to perform provider I/O.
 * @param {Readonly<Record<string, any>>} input - Exact live provider context.
 * @returns {{head: Readonly<Record<string, any>>, targets: readonly Readonly<Record<string, any>>[], authorities: readonly Readonly<Record<string, any>>[], observationAuthorities: readonly Readonly<Record<string, any>>[], destroyedLocatorByKey: ReadonlyMap<string, Readonly<Record<string, any>>>, pendingBinding: Readonly<Record<string, any>>|null}} - Complete read authority.
 */
function validateLiveAuthority(input) {
  const head = validateDeploymentHead(
    input.head,
    'awsSingleNodeDeploymentInspectionProvider context.head',
  );
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: input.deploymentRevision,
    profile: input.profile,
    providerScope: input.providerScope,
    providerSpec: input.providerSpec,
    deploymentInstanceId: input.deploymentInstanceId,
    incarnationId: input.incarnationId,
    head,
  });
  const authorities = targets.map((target) =>
    createAwsSingleNodeResourceObservationAuthority({
      operation: input.operation,
      deploymentRevision: input.deploymentRevision,
      profile: input.profile,
      providerScope: input.providerScope,
      providerSpec: input.providerSpec,
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
      head,
      plan: input.plan,
      settledPlan: input.settledPlan,
      target,
    }),
  );
  const expectedOrder = getAwsSingleNodeResourceApplyOrder();
  if (
    targets.length !== expectedOrder.length ||
    authorities.length !== expectedOrder.length ||
    authorities.some(
      (authority, index) =>
        authority.target.resourceKey !== expectedOrder[index],
    )
  ) {
    throw new Error(
      'AWS single-node deployment inspection authority does not cover the exact resource graph.',
    );
  }
  const destroyedLocatorByKey = new Map();
  const observationAuthorities = authorities.map((authority) => {
    const destroyedResourceLocator =
      createAwsSingleNodeDestroyedResourceLocator(authority);
    if (destroyedResourceLocator === null) return authority;
    destroyedLocatorByKey.set(
      authority.target.resourceKey,
      destroyedResourceLocator,
    );
    return DESTROYED_LOCATOR_OBSERVER_RESOURCE_KEYS.has(
      authority.target.resourceKey,
    )
      ? Object.freeze({ ...authority, destroyedResourceLocator })
      : authority;
  });
  const pendingBinding =
    input.pendingBinding === null
      ? null
      : validateDeploymentResourceBinding(
          input.pendingBinding,
          'awsSingleNodeDeploymentInspectionProvider context.pendingBinding',
        );
  if (pendingBinding !== null) {
    assertPendingBindingAuthority(pendingBinding, input, authorities);
  }
  return {
    head,
    targets,
    authorities,
    observationAuthorities,
    destroyedLocatorByKey,
    pendingBinding,
  };
}

/** @param {readonly Readonly<Record<string, any>>[]} observations @param {ReadonlyMap<string, Readonly<Record<string, any>>>} destroyedLocatorByKey @returns {readonly Readonly<Record<string, any>>[]} */
function inferCompletedDestroyAbsence(observations, destroyedLocatorByKey) {
  if (destroyedLocatorByKey.size === 0) return observations;
  const observationByKey = new Map(
    observations.map((observation) => [observation.resourceKey, observation]),
  );
  for (const [resourceKey, containers] of Object.entries(
    DESTROY_ABSENCE_CONTAINERS,
  )) {
    const observation = observationByKey.get(resourceKey);
    if (
      observation?.presence !== 'unknown' ||
      !destroyedLocatorByKey.has(resourceKey) ||
      !containers.some(
        (containerKey) =>
          observationByKey.get(containerKey)?.presence === 'absent',
      )
    ) {
      continue;
    }
    observationByKey.set(
      resourceKey,
      validateAwsSingleNodeResourceObservation(
        {
          resourceKey,
          presence: 'absent',
          ownership: 'missing',
          providerIdentity: null,
          observedDigest: null,
          health: 'absent',
          execution: 'none',
        },
        resourceKey,
      ),
    );
  }
  return observations.map(
    (observation) =>
      observationByKey.get(observation.resourceKey) ?? observation,
  );
}

/** @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>} observation @param {Readonly<Record<string, any>>|undefined} binding @returns {Record<string, any>} */
function projectResource(target, observation, binding) {
  const expectedOwnership =
    target.management === 'managed' ? 'verified' : 'external';
  let ownership = observation.ownership;
  let exactBinding = null;
  if (
    observation.presence === 'present' &&
    observation.ownership === expectedOwnership
  ) {
    const identity = observation.providerIdentity;
    if (
      binding !== undefined &&
      identity !== null &&
      binding.providerType === identity.providerType &&
      binding.providerResourceId === identity.providerResourceId
    ) {
      exactBinding = binding;
    } else if (target.management === 'managed' || binding !== undefined) {
      ownership = 'conflict';
    }
  }
  return {
    resourceKey: target.resourceKey,
    capability: target.capability,
    role: target.role,
    management: target.management,
    ownershipMode: target.ownershipMode,
    dependsOn: target.dependsOn,
    onDestroy: target.onDestroy,
    bindingId: exactBinding?.bindingId ?? null,
    dependencyBindings: exactBinding?.dependencyBindings ?? null,
    presence: observation.presence,
    presenceEvidence:
      observation.presence === 'present'
        ? 'exact-read'
        : observation.presence === 'absent'
          ? 'authoritative-not-found'
          : 'access-failure',
    ownership,
    providerIdentity: observation.providerIdentity,
    desiredDigest: target.target.stateDigest,
    observedDigest: observation.observedDigest,
    health: observation.health,
    service: null,
    execution: observation.execution,
  };
}

/** @param {Readonly<Record<string, any>>} head @returns {boolean} */
function isFinalReadinessEligible(head) {
  return (
    head.activeOperation === null ||
    (head.activeOperation.nextActionIndex ===
      head.activeOperation.intents.length &&
      head.activeOperation.intents.every(
        (/** @type {Readonly<Record<string, any>>} */ intent) =>
          intent.status === 'settled',
      ))
  );
}

/** @param {Record<string, any>[]} resources @param {Readonly<Record<string, any>>} head @returns {string} */
function deriveStatus(resources, head) {
  if (resources.some((resource) => resource.ownership === 'conflict')) {
    return 'conflict';
  }
  if (
    resources.some((resource) => resource.execution === 'replay-safe-create')
  ) {
    return 'in-flight';
  }
  if (!isFinalReadinessEligible(head)) return 'in-flight';
  if (
    resources.some(
      (resource) =>
        resource.presence === 'unknown' || resource.ownership === 'unknown',
    )
  ) {
    return 'unknown';
  }
  const hasCompletedDestroyAuthority =
    head.phase === 'DESTROYED' ||
    (head.phase === 'DESTROYING' &&
      head.activeOperation?.kind === 'destroy' &&
      head.activeOperation.nextActionIndex ===
        head.activeOperation.intents.length &&
      head.activeOperation.intents.every(
        (/** @type {Readonly<Record<string, any>>} */ intent) =>
          intent.status === 'settled',
      ));
  if (
    hasCompletedDestroyAuthority &&
    resources.every((resource) =>
      resource.onDestroy === 'retain'
        ? resource.presence === 'present' &&
          resource.ownership ===
            (resource.management === 'managed' ? 'verified' : 'external') &&
          resource.bindingId !== null &&
          resource.dependencyBindings !== null &&
          resource.desiredDigest !== null &&
          resource.observedDigest !== null &&
          sameJson(resource.desiredDigest, resource.observedDigest)
        : resource.presence === 'absent' &&
          resource.ownership === 'missing' &&
          resource.bindingId === null &&
          resource.dependencyBindings === null &&
          resource.providerIdentity === null &&
          resource.observedDigest === null,
    )
  ) {
    return 'destroyed';
  }
  if (
    resources.some(
      (resource) =>
        resource.health === 'unknown' ||
        resource.health === 'starting' ||
        (head.activeOperation !== null &&
          resource.presence === 'present' &&
          (resource.ownership === 'verified' ||
            resource.ownership === 'external') &&
          resource.bindingId === null),
    )
  ) {
    return 'in-flight';
  }
  if (
    resources.some((resource) =>
      ['degraded', 'stopped', 'failed'].includes(resource.health),
    )
  ) {
    return 'degraded';
  }
  if (
    resources.some(
      (resource) =>
        resource.presence === 'absent' ||
        resource.ownership === 'missing' ||
        (resource.management === 'external' &&
          resource.presence === 'present' &&
          resource.ownership === 'external' &&
          resource.bindingId === null) ||
        resource.desiredDigest === null ||
        resource.observedDigest === null ||
        !sameJson(resource.desiredDigest, resource.observedDigest),
    )
  ) {
    return 'drifted';
  }
  const substrate = resources.find(
    (resource) => resource.resourceKey === 'substrate',
  );
  return substrate?.health === 'healthy' && substrate.service !== null
    ? 'converged'
    : 'in-flight';
}

/**
 * Compose the lossless read-only InspectionV6 provider from the exhaustive
 * resource router and a separately narrowed resident-health read port.
 * @param {unknown} options - Exact read-only observation ports and clock.
 * @returns {Readonly<{inspect: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Aggregate inspection provider.
 */
export function createAwsSingleNodeDeploymentInspectionProvider(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDeploymentInspectionProvider options must be an object.',
    );
  }
  for (const key of Object.keys(options)) {
    if (!FACTORY_KEYS.has(key)) {
      throw new TypeError(
        `awsSingleNodeDeploymentInspectionProvider options.${key} is not supported.`,
      );
    }
  }
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeDeploymentInspectionProvider options',
  );
  const resourceObservationRouter = validateReadPort(
    options.resourceObservationRouter,
    RESOURCE_OBSERVATION_ROUTER_KEYS,
    'awsSingleNodeDeploymentInspectionProvider options.resourceObservationRouter',
  );
  const serviceHealth = validateReadPort(
    options.serviceHealth,
    SERVICE_HEALTH_KEYS,
    'awsSingleNodeDeploymentInspectionProvider options.serviceHealth',
  );
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new TypeError(
      'awsSingleNodeDeploymentInspectionProvider options.now must be a function.',
    );
  }

  /** @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
  async function inspect(context) {
    const input = cloneJsonObject(
      context,
      'awsSingleNodeDeploymentInspectionProvider context',
    );
    assertExactKeys(
      input,
      INSPECTION_CONTEXT_KEYS,
      'awsSingleNodeDeploymentInspectionProvider context',
    );
    if (!OPERATIONS.has(input.operation)) {
      throw new TypeError(
        'awsSingleNodeDeploymentInspectionProvider context.operation is not supported.',
      );
    }
    if (input.head === null) {
      const authority = validateAbsentAuthority(input);
      const sampledNow = validateNow(now());
      return createDeploymentInspection(
        {
          deploymentRevision: authority.deploymentRevision,
          providerScope: authority.providerScope,
          providerSpecId: authority.providerSpec.providerSpecId,
          deploymentInstanceId: input.deploymentInstanceId,
          controlState: {
            status: 'absent',
            evidence: 'authoritative-not-found',
          },
          incarnationId: null,
          headGeneration: 0,
          status: 'absent',
          resources: [],
        },
        {
          profile: authority.profile,
          providerSpec: authority.providerSpec,
          head: null,
          plan: null,
          pendingBinding: null,
          now: sampledNow,
        },
      );
    }

    const {
      head,
      authorities,
      observationAuthorities,
      destroyedLocatorByKey,
      pendingBinding,
    } = validateLiveAuthority(input);
    const sampledNow = validateNow(now());
    const observationResults = await Promise.allSettled(
      observationAuthorities.map(async (authority) =>
        validateAwsSingleNodeResourceObservation(
          await resourceObservationRouter.observeResource(authority),
          authority.target.resourceKey,
        ),
      ),
    );
    for (const result of observationResults) {
      if (result.status === 'rejected') throw result.reason;
    }
    const observations = inferCompletedDestroyAbsence(
      observationResults.map((result) => {
        if (result.status !== 'fulfilled') {
          throw new Error(
            'AWS single-node deployment inspection observation barrier is incomplete.',
          );
        }
        return result.value;
      }),
      destroyedLocatorByKey,
    );
    const durableBindingByKey = new Map(
      head.resourceBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ binding) => [
          binding.resourceKey,
          binding,
        ],
      ),
    );
    const projectedBindingByKey = new Map(durableBindingByKey);
    if (pendingBinding !== null) {
      projectedBindingByKey.set(pendingBinding.resourceKey, pendingBinding);
    }
    let resources = authorities.map((authority, index) => {
      const observation =
        pendingBinding !== null &&
        observations[index].execution === 'replay-safe-create'
          ? { ...observations[index], execution: 'none' }
          : observations[index];
      return projectResource(
        authority.target,
        observation,
        projectedBindingByKey.get(authority.target.resourceKey),
      );
    });

    const substrate = resources.find(
      (resource) => resource.resourceKey === 'substrate',
    );
    const runtimeRole = resources.find(
      (resource) => resource.resourceKey === 'runtime-role',
    );
    const substrateBinding = durableBindingByKey.get('substrate');
    const runtimeRoleBinding = durableBindingByKey.get('runtime-role');
    let serviceHealthResult = 'not-observed';
    let healthObservation = null;
    if (
      substrate !== undefined &&
      runtimeRole !== undefined &&
      substrateBinding !== undefined &&
      runtimeRoleBinding !== undefined &&
      substrate.presence === 'present' &&
      substrate.ownership ===
        (substrate.management === 'managed' ? 'verified' : 'external') &&
      substrate.health === 'degraded' &&
      substrate.providerIdentity?.providerResourceId ===
        substrateBinding.providerResourceId &&
      substrate.bindingId === substrateBinding.bindingId &&
      runtimeRole.presence === 'present' &&
      runtimeRole.ownership ===
        (runtimeRole.management === 'managed' ? 'verified' : 'external') &&
      runtimeRole.providerIdentity?.providerResourceId ===
        runtimeRoleBinding.providerResourceId &&
      runtimeRole.bindingId === runtimeRoleBinding.bindingId &&
      isFinalReadinessEligible(head)
    ) {
      try {
        healthObservation = validateDeploymentServiceHealthObservation(
          await serviceHealth.inspect(
            Object.freeze({
              deploymentRevision: input.deploymentRevision,
              profile: input.profile,
              providerScope: input.providerScope,
              providerSpec: input.providerSpec,
              head,
            }),
          ),
          'awsSingleNodeDeploymentInspectionProvider serviceHealth',
        );
        serviceHealthResult = 'observed';
      } catch (error) {
        if (
          error instanceof DeploymentServiceHealthMissingError ||
          error instanceof DeploymentServiceHealthStaleError
        ) {
          serviceHealthResult = 'not-observed';
        } else if (
          error instanceof DeploymentServiceHealthUnknownError ||
          error instanceof DeploymentServiceHealthConflictError
        ) {
          serviceHealthResult = 'unknown';
        } else {
          throw error;
        }
      }
    }
    if (substrate !== undefined && serviceHealthResult !== 'not-observed') {
      resources = resources.map((resource) => {
        if (resource.resourceKey !== 'substrate') return resource;
        if (serviceHealthResult === 'unknown') {
          return {
            ...resource,
            health: 'unknown',
            service: null,
          };
        }
        const observedHealth = healthObservation;
        if (observedHealth === null) {
          throw new Error(
            'AWS single-node deployment inspection observed service health is absent.',
          );
        }
        return {
          ...resource,
          health: observedHealth.receipt.health,
          service: {
            health: observedHealth.receipt.health,
            artifactId: observedHealth.receipt.artifactId,
            revisionId: observedHealth.receipt.revisionId,
            healthReceipt: observedHealth,
          },
        };
      });
    }

    if (resources.some((resource) => resource.ownership === 'conflict')) {
      resources = resources.map((resource) => ({
        ...resource,
        execution: 'none',
      }));
    }
    const status = deriveStatus(resources, head);
    return createDeploymentInspection(
      {
        deploymentRevision: input.deploymentRevision,
        providerScope: input.providerScope,
        providerSpecId: input.providerSpec.providerSpecId,
        deploymentInstanceId: input.deploymentInstanceId,
        controlState: {
          status: 'present',
          evidence: 'provider-head-read',
        },
        incarnationId: input.incarnationId,
        headGeneration: head.generation,
        status,
        resources,
      },
      {
        profile: input.profile,
        providerSpec: input.providerSpec,
        head,
        plan: input.plan,
        pendingBinding,
        now: sampledNow,
      },
    );
  }

  return Object.freeze({ inspect });
}

export default {
  createAwsSingleNodeDeploymentInspectionProvider,
};
