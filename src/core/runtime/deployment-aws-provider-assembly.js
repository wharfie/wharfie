/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- The assembly boundary composes many intentionally narrow structural ports. */

import { createAwsSingleNodeDefaultIpv4RouteResourceObserver } from './deployment-aws-default-ipv4-route-resource-observer.js';
import { createAwsSingleNodeDeploymentInspectionProvider } from './deployment-aws-inspection.js';
import { createAwsSingleNodeInstanceProfileResourceObserver } from './deployment-aws-instance-profile-resource-observer.js';
import { createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver } from './deployment-aws-instance-profile-role-association-resource-observer.js';
import { createAwsSingleNodeInternetGatewayResourceObserver } from './deployment-aws-internet-gateway-resource-observer.js';
import { createAwsSingleNodeInternetGatewayAttachmentResourceObserver } from './deployment-aws-internet-gateway-attachment-resource-observer.js';
import { createAwsSingleNodeManagedArtifactResourceObserver } from './deployment-aws-managed-artifact-resource-observer.js';
import { createAwsSingleNodeNodeResourceObserver } from './deployment-aws-node-resource-observer.js';
import { createAwsSingleNodeDeploymentProvider } from './deployment-aws-provider.js';
import { createAwsSingleNodeProviderSpecResolver } from './deployment-aws-provider-spec-resolver.js';
import { createAwsSingleNodeResourceObservationRouter } from './deployment-aws-resource-observation.js';
import { createAwsSingleNodeResourceRouter } from './deployment-aws-resource-router.js';
import { createAwsSingleNodeRouteTableResourceObserver } from './deployment-aws-route-table-resource-observer.js';
import { createAwsSingleNodeRuntimeRolePolicyResourceObserver } from './deployment-aws-runtime-role-policy-resource-observer.js';
import { createAwsSingleNodeRuntimeRoleResourceObserver } from './deployment-aws-runtime-role-resource-observer.js';
import { createAwsSingleNodeSecurityGroupResourceObserver } from './deployment-aws-security-group-resource-observer.js';
import { createAwsSingleNodeSubnetResourceObserver } from './deployment-aws-subnet-resource-observer.js';
import { createAwsSingleNodeSubnetRouteTableAssociationResourceObserver } from './deployment-aws-subnet-route-table-association-resource-observer.js';
import { createAwsSingleNodeVolumeAttachmentResourceObserver } from './deployment-aws-volume-attachment-resource-observer.js';
import { createAwsSingleNodeVolumeResourceObserver } from './deployment-aws-volume-resource-observer.js';
import { createAwsSingleNodeVpcResourceObserver } from './deployment-aws-vpc-resource-observer.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { createDeploymentServiceHealthS3 } from './deployment-service-health-s3.js';

const FACTORY_KEYS = new Set([
  'clientFamily',
  'now',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['clientFamily']);
const CLIENT_FAMILY_KEYS = new Set([
  'providerScope',
  'scopeResolver',
  'clients',
  'close',
]);
const SCOPE_RESOLVER_KEYS = new Set(['resolveScope']);
const CLIENT_KEYS = new Set([
  'deploymentStore',
  'dynamoControl',
  's3Control',
  'providerSpecRead',
  'managedArtifact',
  'volume',
  'network',
  'runtimeIdentity',
  'node',
  'volumeAttachment',
]);
const MIN_ATTEMPTS = 2;
const MAX_ATTEMPTS = 10;

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

/**
 * Project a caller-owned capability to an exact read surface while preserving
 * the original object as every method's receiver.
 * @param {unknown} value - Full caller-owned client or port.
 * @param {readonly string[]} methods - Exact projected methods.
 * @param {string} path - Human-readable boundary path.
 * @returns {Readonly<Record<string, Function>>} - Frozen receiver-preserving projection.
 */
function projectMethods(value, methods, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return Object.freeze(
    Object.fromEntries(
      methods.map((method) => {
        const implementation = value[method];
        if (typeof implementation !== 'function') {
          throw new TypeError(`${path}.${method} must be a function.`);
        }
        const projected = /** @type {(...args: any[]) => any} */ (
          (...args) => Reflect.apply(implementation, value, args)
        );
        return [method, projected];
      }),
    ),
  );
}

/**
 * Compose one complete controller-facing provider over a caller-owned AWS
 * client family. Construction performs no provider I/O, bootstrap, or close;
 * the caller retains the family lifecycle.
 * @param {unknown} options - Exact client family, clock, and shared retry policy.
 * @returns {Readonly<{resolveScope: (context: unknown) => unknown, resolveProviderSpec: (context: unknown) => unknown, validateProviderSpec: (context: unknown) => unknown, inspect: (context: unknown) => unknown, createPlan: (context: unknown) => unknown, executeAction: (context: unknown) => unknown, verifySettlement: (context: unknown) => unknown}>} - Frozen seven-method deployment provider.
 */
export function createAwsSingleNodeDeploymentProviderFromClientFamily(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily options must be an object.',
    );
  }
  for (const key of Object.keys(options)) {
    if (!FACTORY_KEYS.has(key)) {
      throw new TypeError(
        `awsSingleNodeDeploymentProviderFromClientFamily options.${key} is not supported.`,
      );
    }
  }
  for (const key of FACTORY_REQUIRED_KEYS) {
    if (!Object.hasOwn(options, key)) {
      throw new TypeError(
        `awsSingleNodeDeploymentProviderFromClientFamily options.${key} is required.`,
      );
    }
  }

  if (!isPlainObject(options.clientFamily)) {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily clientFamily must be an object.',
    );
  }
  const clientFamily = options.clientFamily;
  assertExactKeys(
    clientFamily,
    CLIENT_FAMILY_KEYS,
    'awsSingleNodeDeploymentProviderFromClientFamily clientFamily',
  );
  if (typeof clientFamily.close !== 'function') {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.close must be a function.',
    );
  }
  const providerScope = validateProviderScope(
    clientFamily.providerScope,
    'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.providerScope',
  );
  if (!isPlainObject(clientFamily.scopeResolver)) {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.scopeResolver must be an object.',
    );
  }
  assertExactKeys(
    clientFamily.scopeResolver,
    SCOPE_RESOLVER_KEYS,
    'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.scopeResolver',
  );
  const scopeResolver = projectMethods(
    clientFamily.scopeResolver,
    [...SCOPE_RESOLVER_KEYS],
    'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.scopeResolver',
  );
  if (!isPlainObject(clientFamily.clients)) {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.clients must be an object.',
    );
  }
  const clients = clientFamily.clients;
  assertExactKeys(
    clients,
    CLIENT_KEYS,
    'awsSingleNodeDeploymentProviderFromClientFamily clientFamily.clients',
  );
  for (const clientKey of CLIENT_KEYS) {
    if (!isPlainObject(clients[clientKey])) {
      throw new TypeError(
        `awsSingleNodeDeploymentProviderFromClientFamily clientFamily.clients.${clientKey} must be an object.`,
      );
    }
  }

  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily options.now must be a function.',
    );
  }
  const maxAttempts = options.maxAttempts;
  if (
    maxAttempts !== undefined &&
    (!Number.isSafeInteger(maxAttempts) ||
      maxAttempts < MIN_ATTEMPTS ||
      maxAttempts > MAX_ATTEMPTS)
  ) {
    throw new TypeError(
      `awsSingleNodeDeploymentProviderFromClientFamily options.maxAttempts must be an integer from ${MIN_ATTEMPTS} through ${MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry;
  if (waitForRetry !== undefined && typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeDeploymentProviderFromClientFamily options.waitForRetry must be a function.',
    );
  }
  const retryOptions = {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(waitForRetry === undefined ? {} : { waitForRetry }),
  };

  const observers = {
    managedArtifact: createAwsSingleNodeManagedArtifactResourceObserver({
      client: projectMethods(
        clients.managedArtifact,
        ['headObject', 'listObjectVersions'],
        'awsSingleNodeDeploymentProviderFromClientFamily managedArtifact observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    volume: createAwsSingleNodeVolumeResourceObserver({
      client: projectMethods(
        clients.volume,
        ['describeVolumes'],
        'awsSingleNodeDeploymentProviderFromClientFamily volume observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    vpc: createAwsSingleNodeVpcResourceObserver({
      client: projectMethods(
        clients.network,
        ['describeVpcAttribute', 'describeVpcs'],
        'awsSingleNodeDeploymentProviderFromClientFamily VPC observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    internetGateway: createAwsSingleNodeInternetGatewayResourceObserver({
      client: projectMethods(
        clients.network,
        ['describeInternetGateways'],
        'awsSingleNodeDeploymentProviderFromClientFamily internet-gateway observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    internetGatewayAttachment:
      createAwsSingleNodeInternetGatewayAttachmentResourceObserver({
        client: projectMethods(
          clients.network,
          ['describeInternetGateways'],
          'awsSingleNodeDeploymentProviderFromClientFamily internet-gateway attachment observation client',
        ),
        providerScope,
        ...retryOptions,
      }),
    subnet: createAwsSingleNodeSubnetResourceObserver({
      client: projectMethods(
        clients.network,
        ['describeSubnets'],
        'awsSingleNodeDeploymentProviderFromClientFamily subnet observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    routeTable: createAwsSingleNodeRouteTableResourceObserver({
      client: projectMethods(
        clients.network,
        ['describeRouteTables'],
        'awsSingleNodeDeploymentProviderFromClientFamily route-table observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    defaultIpv4Route: createAwsSingleNodeDefaultIpv4RouteResourceObserver({
      client: projectMethods(
        clients.network,
        ['describeInternetGateways', 'describeRouteTables'],
        'awsSingleNodeDeploymentProviderFromClientFamily default-route observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    subnetRouteTableAssociation:
      createAwsSingleNodeSubnetRouteTableAssociationResourceObserver({
        client: projectMethods(
          clients.network,
          ['describeRouteTables', 'describeSubnets'],
          'awsSingleNodeDeploymentProviderFromClientFamily subnet route-table association observation client',
        ),
        providerScope,
        ...retryOptions,
      }),
    securityGroup: createAwsSingleNodeSecurityGroupResourceObserver({
      client: projectMethods(
        clients.network,
        ['describeSecurityGroups'],
        'awsSingleNodeDeploymentProviderFromClientFamily security-group observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    runtimeRole: createAwsSingleNodeRuntimeRoleResourceObserver({
      client: projectMethods(
        clients.runtimeIdentity,
        [
          'getRole',
          'listRoleTags',
          'listRolePolicies',
          'listAttachedRolePolicies',
          'listInstanceProfilesForRole',
        ],
        'awsSingleNodeDeploymentProviderFromClientFamily runtime-role observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    runtimeRolePolicy: createAwsSingleNodeRuntimeRolePolicyResourceObserver({
      client: projectMethods(
        clients.runtimeIdentity,
        [
          'getRole',
          'listRoleTags',
          'listRolePolicies',
          'listAttachedRolePolicies',
          'getRolePolicy',
        ],
        'awsSingleNodeDeploymentProviderFromClientFamily runtime-role-policy observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    instanceProfile: createAwsSingleNodeInstanceProfileResourceObserver({
      client: projectMethods(
        clients.runtimeIdentity,
        ['getInstanceProfile', 'listInstanceProfileTags', 'describeInstances'],
        'awsSingleNodeDeploymentProviderFromClientFamily instance-profile observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    instanceProfileRoleAssociation:
      createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver({
        client: projectMethods(
          clients.runtimeIdentity,
          [
            'getRole',
            'listRoleTags',
            'listRolePolicies',
            'listAttachedRolePolicies',
            'getRolePolicy',
            'getInstanceProfile',
            'listInstanceProfileTags',
            'listInstanceProfilesForRole',
          ],
          'awsSingleNodeDeploymentProviderFromClientFamily instance-profile role-association observation client',
        ),
        providerScope,
        ...retryOptions,
      }),
    node: createAwsSingleNodeNodeResourceObserver({
      client: projectMethods(
        clients.node,
        [
          'describeInstances',
          'describeInstanceAttribute',
          'describeInstanceCreditSpecifications',
          'describeVolumes',
        ],
        'awsSingleNodeDeploymentProviderFromClientFamily node observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
    volumeAttachment: createAwsSingleNodeVolumeAttachmentResourceObserver({
      client: projectMethods(
        clients.volumeAttachment,
        ['describeInstances', 'describeVolumes'],
        'awsSingleNodeDeploymentProviderFromClientFamily volume-attachment observation client',
      ),
      providerScope,
      ...retryOptions,
    }),
  };
  const resourceObservationRouter =
    createAwsSingleNodeResourceObservationRouter({ observers });

  const health = createDeploymentServiceHealthS3({
    client: projectMethods(
      clients.s3Control,
      ['getObject', 'headObject', 'putObject'],
      'awsSingleNodeDeploymentProviderFromClientFamily service-health client',
    ),
    providerScope,
    now,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });
  const serviceHealth = projectMethods(
    health,
    ['inspect'],
    'awsSingleNodeDeploymentProviderFromClientFamily service-health port',
  );
  const inspectionProvider = createAwsSingleNodeDeploymentInspectionProvider({
    resourceObservationRouter,
    serviceHealth,
    now,
  });

  const providerSpecResolver = createAwsSingleNodeProviderSpecResolver({
    client: projectMethods(
      clients.providerSpecRead,
      [
        'getParameter',
        'describeImages',
        'describeAvailabilityZones',
        'describeInstanceTypeOfferings',
        'getEbsDefaultKmsKeyId',
      ],
      'awsSingleNodeDeploymentProviderFromClientFamily provider-spec client',
    ),
    providerScope,
    now,
    ...retryOptions,
  });

  const resourceRouter = createAwsSingleNodeResourceRouter({
    providerScope,
    clients: {
      managedArtifact: clients.managedArtifact,
      volume: clients.volume,
      network: clients.network,
      runtimeIdentity: clients.runtimeIdentity,
      node: clients.node,
      volumeAttachment: clients.volumeAttachment,
    },
    ...retryOptions,
  });

  return createAwsSingleNodeDeploymentProvider({
    scopeResolver,
    providerSpecResolver,
    inspectionProvider,
    resourceRouter,
  });
}

export default {
  createAwsSingleNodeDeploymentProviderFromClientFamily,
};
