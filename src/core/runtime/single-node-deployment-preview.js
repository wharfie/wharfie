/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns-description -- This public diagnostic contract keeps its exact plain-data validators beside the projection. */

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { ARTIFACT_ID_PREFIX, assertArtifactId } from './artifact-record.js';
import { validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import { validateAwsSingleNodePlan } from './providers/aws/single-node-plan.js';
import { validateHetznerSingleNodePlan } from './providers/hetzner/single-node-plan.js';
import {
  SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
  validateSingleNodeDeploymentDesired,
} from './single-node-deployment-desired.js';
import {
  assertSingleNodeDeploymentInstanceId,
  getSingleNodeDeploymentInstanceId,
} from './single-node-deployment-identity.js';
import {
  createAwsSingleNodeDeploymentProvider,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
} from './single-node-deployment-intent.js';
import { validateSingleNodeDeploymentJournal } from './single-node-deployment-journal.js';

export const SINGLE_NODE_DEPLOYMENT_PREVIEW_SCHEMA_VERSION = 1;
export const SINGLE_NODE_DEPLOYMENT_PREVIEW_KIND =
  'wharfie.single-node-deployment.preview';

const MAX_PREVIEW_BYTES = 256 * 1024;
const INPUT_KEYS = new Set(['desired', 'providerPlan', 'journal']);
const PREVIEW_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provider',
  'status',
  'blockedReason',
  'deployment',
  'journal',
  'providerSpec',
  'resources',
  'actions',
]);
const DEPLOYMENT_KEYS = new Set([
  'appId',
  'deploymentId',
  'deploymentInstanceId',
  'revisionId',
  'desiredRevisionId',
  'artifact',
  'mode',
  'machine',
  'access',
]);
const ARTIFACT_KEYS = new Set(['artifactId', 'byteDigest', 'size', 'target']);
const JOURNAL_KEYS = new Set(['state', 'phase', 'desiredMatches']);
const RESOURCES_KEYS = new Set(['managed', 'referenced']);
const MANAGED_RESOURCE_KEYS = new Set(['role', 'id', 'state']);
const REFERENCED_RESOURCE_KEYS = new Set(['role', 'id']);
const ACTION_KEYS = new Set(['kind']);
const AWS_PROVIDER_SPEC_KEYS = new Set([
  'kind',
  'scope',
  'machineType',
  'image',
  'network',
]);
const AWS_SCOPE_KEYS = new Set(['partition', 'accountId', 'region']);
const AWS_IMAGE_KEYS = new Set([
  'id',
  'name',
  'ownerAccountId',
  'creationDate',
  'architecture',
  'rootDeviceType',
  'virtualizationType',
  'enaSupport',
  'rootDeviceName',
  'rootBlockDevice',
]);
const AWS_ROOT_BLOCK_DEVICE_KEYS = new Set([
  'snapshotId',
  'volumeType',
  'sizeGiB',
  'sourceEncrypted',
  'encrypted',
  'deleteOnTermination',
]);
const AWS_NETWORK_KEYS = new Set([
  'vpcId',
  'subnet',
  'networkAcl',
  'routeTable',
  'internetGatewayId',
]);
const AWS_SUBNET_KEYS = new Set([
  'id',
  'availabilityZone',
  'availabilityZoneId',
  'mapPublicIpOnLaunch',
  'assignIpv6AddressOnCreation',
]);
const AWS_NETWORK_ACL_KEYS = new Set([
  'id',
  'associationId',
  'ipv4Ingress',
  'ipv4Egress',
]);
const AWS_NETWORK_ACL_RULE_KEYS = new Set([
  'allowRuleNumber',
  'terminalDenyRuleNumber',
]);
const AWS_ROUTE_TABLE_KEYS = new Set(['id', 'destinationCidrBlock']);
const HETZNER_PROVIDER_SPEC_KEYS = new Set([
  'kind',
  'location',
  'machineType',
  'image',
  'network',
]);
const HETZNER_REFERENCE_KEYS = new Set(['id', 'name']);
const HETZNER_NETWORK_KEYS = new Set(['kind']);
const PROVIDERS = new Set(['aws', 'hetzner']);
const STATUSES = new Set(['actionable', 'recovery-required', 'blocked']);
const BLOCKED_REASONS = new Set([
  'unbound-provider-resources',
  'local-authority-conflict',
  'local-destruction-in-progress',
  'local-authority-destroyed',
]);
const JOURNAL_PHASES = new Set([
  'planned',
  'provisioning',
  'provisioned',
  'activating',
  'active',
  'destroying',
  'destroyed',
]);
const MANAGED_STATES = new Set([
  'planned',
  'pending',
  'present',
  'absent',
  'unbound',
]);
const ACTION_KINDS = new Set([
  'provision-managed-node',
  'activate-application',
  'verify-managed-node',
  'verify-or-repair-application',
]);
const AWS_MANAGED_ROLES = Object.freeze([
  Object.freeze({ publicRole: 'instance', journalRole: 'instance' }),
  Object.freeze({ publicRole: 'root-volume', journalRole: 'rootVolume' }),
  Object.freeze({
    publicRole: 'security-group',
    journalRole: 'securityGroup',
  }),
]);
const HETZNER_MANAGED_ROLES = Object.freeze([
  Object.freeze({ publicRole: 'firewall', journalRole: 'firewall' }),
  Object.freeze({ publicRole: 'primary-ip', journalRole: 'primaryIp' }),
  Object.freeze({ publicRole: 'server', journalRole: 'server' }),
]);
const AWS_REFERENCED_ROLES = Object.freeze([
  'image',
  'internet-gateway',
  'network-acl',
  'route-table',
  'subnet',
  'vpc',
]);
const HETZNER_REFERENCED_ROLES = Object.freeze([
  'image',
  'location',
  'machine-type',
]);

/**
 * @param {any} value
 * @returns {any}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactObject(value, expected, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
  }
  return object;
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {string}
 */
function boundedString(value, valuePath) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new TypeError(`${valuePath} must be a bounded nonempty string.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {{id: string, name: string}}
 */
function validateHetznerReference(value, valuePath) {
  const reference = exactObject(value, HETZNER_REFERENCE_KEYS, valuePath);
  if (!/^[1-9][0-9]*$/u.test(reference.id)) {
    throw new TypeError(`${valuePath}.id must be a positive decimal string.`);
  }
  boundedString(reference.name, `${valuePath}.name`);
  return { id: reference.id, name: reference.name };
}

/**
 * @param {Readonly<Record<string, any>>} providerSpec
 * @returns {Readonly<Record<string, any>>}
 */
function projectAwsProviderSpec(providerSpec) {
  return {
    kind: 'aws',
    scope: {
      partition: providerSpec.providerScope.partition,
      accountId: providerSpec.providerScope.accountId,
      region: providerSpec.providerScope.region,
    },
    machineType: providerSpec.instanceType,
    image: {
      id: providerSpec.image.imageId,
      name: providerSpec.image.sourceImage.name,
      ownerAccountId: providerSpec.image.sourceImage.ownerAccountId,
      creationDate: providerSpec.image.sourceImage.creationDate,
      architecture: providerSpec.image.architecture,
      rootDeviceType: providerSpec.image.rootDeviceType,
      virtualizationType: providerSpec.image.virtualizationType,
      enaSupport: providerSpec.image.enaSupport,
      rootDeviceName: providerSpec.image.rootDeviceName,
      rootBlockDevice: providerSpec.image.rootBlockDevice,
    },
    network: {
      vpcId: providerSpec.vpc.vpcId,
      subnet: {
        id: providerSpec.subnet.subnetId,
        availabilityZone: providerSpec.subnet.availabilityZone,
        availabilityZoneId: providerSpec.subnet.availabilityZoneId,
        mapPublicIpOnLaunch: providerSpec.subnet.mapPublicIpOnLaunch,
        assignIpv6AddressOnCreation:
          providerSpec.subnet.assignIpv6AddressOnCreation,
      },
      networkAcl: {
        id: providerSpec.networkAcl.networkAclId,
        associationId: providerSpec.networkAcl.associationId,
        ipv4Ingress: providerSpec.networkAcl.ipv4Ingress,
        ipv4Egress: providerSpec.networkAcl.ipv4Egress,
      },
      routeTable: {
        id: providerSpec.routeTable.routeTableId,
        destinationCidrBlock: providerSpec.routeTable.destinationCidrBlock,
      },
      internetGatewayId: providerSpec.internetGateway.internetGatewayId,
    },
  };
}

/**
 * @param {Readonly<Record<string, any>>} providerSpec
 * @returns {Readonly<Record<string, any>>}
 */
function projectHetznerProviderSpec(providerSpec) {
  return {
    kind: 'hetzner',
    location: {
      id: String(providerSpec.location.id),
      name: providerSpec.location.name,
    },
    machineType: {
      id: String(providerSpec.serverType.id),
      name: providerSpec.serverType.name,
    },
    image: {
      id: String(providerSpec.image.id),
      name: providerSpec.image.name,
    },
    network: { kind: 'public' },
  };
}

/**
 * @param {'aws'|'hetzner'} provider
 * @param {Readonly<Record<string, any>>} providerSpec
 * @returns {Readonly<Record<string, string>[]>}
 */
function referencedResources(provider, providerSpec) {
  const resources =
    provider === 'aws'
      ? [
          { role: 'image', id: providerSpec.image.imageId },
          {
            role: 'internet-gateway',
            id: providerSpec.internetGateway.internetGatewayId,
          },
          { role: 'network-acl', id: providerSpec.networkAcl.networkAclId },
          {
            role: 'route-table',
            id: providerSpec.routeTable.routeTableId,
          },
          { role: 'subnet', id: providerSpec.subnet.subnetId },
          { role: 'vpc', id: providerSpec.vpc.vpcId },
        ]
      : [
          { role: 'image', id: String(providerSpec.image.id) },
          { role: 'location', id: String(providerSpec.location.id) },
          {
            role: 'machine-type',
            id: String(providerSpec.serverType.id),
          },
        ];
  return resources.sort((left, right) => left.role.localeCompare(right.role));
}

/**
 * @param {'aws'|'hetzner'} provider
 * @param {Readonly<Record<string, any>>} plan
 * @param {Readonly<Record<string, any>>|null} journal
 * @returns {Readonly<Record<string, any>[]>}
 */
function managedResources(provider, plan, journal) {
  const roles = provider === 'aws' ? AWS_MANAGED_ROLES : HETZNER_MANAGED_ROLES;
  return roles
    .map(({ publicRole, journalRole }) => {
      const record =
        journal?.resources.find(
          (/** @type {Readonly<Record<string, any>>} */ resource) =>
            resource.role === journalRole,
        ) ?? null;
      return {
        role: publicRole,
        id: record === null ? null : String(record.providerResourceId),
        state:
          record === null
            ? journal === null
              ? plan.inspection.status === 'absent'
                ? 'planned'
                : 'unbound'
              : 'pending'
            : record.state,
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role));
}

/**
 * @param {Readonly<Record<string, any>>} plan
 * @param {Readonly<Record<string, any>>|null} journal
 * @param {boolean|null} desiredMatches
 * @returns {{status: 'actionable'|'recovery-required'|'blocked', blockedReason: string|null, actions: Readonly<Record<string, string>[]>}}
 */
function previewDisposition(plan, journal, desiredMatches) {
  if (journal === null) {
    return {
      status: plan.status,
      blockedReason: plan.blockedReason,
      actions: plan.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) => ({
          kind: action.kind,
        }),
      ),
    };
  }
  if (desiredMatches !== true) {
    return {
      status: 'blocked',
      blockedReason: 'local-authority-conflict',
      actions: [],
    };
  }
  if (journal.phase === 'destroying') {
    return {
      status: 'blocked',
      blockedReason: 'local-destruction-in-progress',
      actions: [],
    };
  }
  if (journal.phase === 'destroyed') {
    return {
      status: 'blocked',
      blockedReason: 'local-authority-destroyed',
      actions: [],
    };
  }
  const actionKinds =
    journal.phase === 'planned' || journal.phase === 'provisioning'
      ? ['provision-managed-node', 'activate-application']
      : journal.phase === 'provisioned' || journal.phase === 'activating'
        ? ['activate-application']
        : ['verify-managed-node', 'verify-or-repair-application'];
  return {
    status: 'recovery-required',
    blockedReason: null,
    actions: actionKinds.map((kind) => ({ kind })),
  };
}

/**
 * Validate one stable public preview receipt.
 * @param {unknown} value
 * @param {string} [valuePath]
 * @returns {Readonly<Record<string, any>>}
 */
export function validateSingleNodeDeploymentPreview(
  value,
  valuePath = 'singleNodeDeploymentPreview',
) {
  const preview = cloneBoundedJsonObject(value, MAX_PREVIEW_BYTES, valuePath);
  exactObject(preview, PREVIEW_KEYS, valuePath);
  if (
    preview.schemaVersion !== SINGLE_NODE_DEPLOYMENT_PREVIEW_SCHEMA_VERSION ||
    preview.kind !== SINGLE_NODE_DEPLOYMENT_PREVIEW_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  if (!PROVIDERS.has(preview.provider)) {
    throw new TypeError(`${valuePath}.provider is unsupported.`);
  }
  if (!STATUSES.has(preview.status)) {
    throw new TypeError(`${valuePath}.status is unsupported.`);
  }
  if (
    preview.blockedReason !== null &&
    !BLOCKED_REASONS.has(preview.blockedReason)
  ) {
    throw new TypeError(`${valuePath}.blockedReason is unsupported.`);
  }
  if ((preview.status === 'blocked') !== (preview.blockedReason !== null)) {
    throw new TypeError(
      `${valuePath}.blockedReason must match blocked status.`,
    );
  }

  const deployment = exactObject(
    preview.deployment,
    DEPLOYMENT_KEYS,
    `${valuePath}.deployment`,
  );
  assertLogicalId(deployment.appId, `${valuePath}.deployment.appId`);
  assertLogicalId(
    deployment.deploymentId,
    `${valuePath}.deployment.deploymentId`,
  );
  assertSingleNodeDeploymentInstanceId(
    deployment.deploymentInstanceId,
    `${valuePath}.deployment.deploymentInstanceId`,
  );
  assertApplicationRevisionId(
    deployment.revisionId,
    `${valuePath}.deployment.revisionId`,
  );
  assertDomainSeparatedSha256Id(
    deployment.desiredRevisionId,
    SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
    `${valuePath}.deployment.desiredRevisionId`,
  );
  const artifact = exactObject(
    deployment.artifact,
    ARTIFACT_KEYS,
    `${valuePath}.deployment.artifact`,
  );
  assertArtifactId(
    artifact.artifactId,
    `${valuePath}.deployment.artifact.artifactId`,
  );
  validateSha256Digest(
    artifact.byteDigest,
    `${valuePath}.deployment.artifact.byteDigest`,
  );
  if (
    artifact.artifactId !== `${ARTIFACT_ID_PREFIX}_${artifact.byteDigest.value}`
  ) {
    throw new Error(
      `${valuePath}.deployment.artifact does not match its byte digest.`,
    );
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
    throw new TypeError(
      `${valuePath}.deployment.artifact.size must be a nonnegative safe integer.`,
    );
  }
  const target = validateBuildTarget(
    artifact.target,
    `${valuePath}.deployment.artifact.target`,
  );
  const providerSelection =
    preview.provider === 'aws'
      ? createAwsSingleNodeDeploymentProvider(
          preview.providerSpec?.scope?.region,
        )
      : createHetznerSingleNodeDeploymentProvider(
          preview.providerSpec?.location?.name,
        );
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: deployment.deploymentId },
    appId: deployment.appId,
    target,
    mode: deployment.mode,
    machine: deployment.machine,
    access: deployment.access,
    provider: providerSelection,
  });
  if (
    getSingleNodeDeploymentInstanceId(intent) !==
    deployment.deploymentInstanceId
  ) {
    throw new Error(
      `${valuePath}.deployment does not match its deployment instance.`,
    );
  }
  const journal = exactObject(
    preview.journal,
    JOURNAL_KEYS,
    `${valuePath}.journal`,
  );
  if (journal.state === 'absent') {
    if (journal.phase !== null || journal.desiredMatches !== null) {
      throw new TypeError(
        `${valuePath}.journal absent state must have null details.`,
      );
    }
  } else if (
    journal.state !== 'present' ||
    !JOURNAL_PHASES.has(journal.phase) ||
    typeof journal.desiredMatches !== 'boolean'
  ) {
    throw new TypeError(`${valuePath}.journal is invalid.`);
  }

  if (preview.provider === 'aws') {
    const providerSpec = exactObject(
      preview.providerSpec,
      AWS_PROVIDER_SPEC_KEYS,
      `${valuePath}.providerSpec`,
    );
    if (providerSpec.kind !== 'aws') {
      throw new TypeError(`${valuePath}.providerSpec.kind must be 'aws'.`);
    }
    const scope = exactObject(
      providerSpec.scope,
      AWS_SCOPE_KEYS,
      `${valuePath}.providerSpec.scope`,
    );
    for (const [key, item] of Object.entries(scope)) {
      boundedString(item, `${valuePath}.providerSpec.scope.${key}`);
    }
    boundedString(
      providerSpec.machineType,
      `${valuePath}.providerSpec.machineType`,
    );
    const image = exactObject(
      providerSpec.image,
      AWS_IMAGE_KEYS,
      `${valuePath}.providerSpec.image`,
    );
    for (const key of [
      'id',
      'name',
      'ownerAccountId',
      'creationDate',
      'architecture',
      'rootDeviceType',
      'virtualizationType',
      'rootDeviceName',
    ]) {
      boundedString(image[key], `${valuePath}.providerSpec.image.${key}`);
    }
    if (typeof image.enaSupport !== 'boolean') {
      throw new TypeError(
        `${valuePath}.providerSpec.image.enaSupport must be boolean.`,
      );
    }
    const root = exactObject(
      image.rootBlockDevice,
      AWS_ROOT_BLOCK_DEVICE_KEYS,
      `${valuePath}.providerSpec.image.rootBlockDevice`,
    );
    boundedString(
      root.snapshotId,
      `${valuePath}.providerSpec.image.rootBlockDevice.snapshotId`,
    );
    boundedString(
      root.volumeType,
      `${valuePath}.providerSpec.image.rootBlockDevice.volumeType`,
    );
    if (!Number.isSafeInteger(root.sizeGiB) || root.sizeGiB < 1) {
      throw new TypeError(
        `${valuePath}.providerSpec.image.rootBlockDevice.sizeGiB is invalid.`,
      );
    }
    for (const key of ['sourceEncrypted', 'encrypted', 'deleteOnTermination']) {
      if (typeof root[key] !== 'boolean') {
        throw new TypeError(
          `${valuePath}.providerSpec.image.rootBlockDevice.${key} must be boolean.`,
        );
      }
    }
    const network = exactObject(
      providerSpec.network,
      AWS_NETWORK_KEYS,
      `${valuePath}.providerSpec.network`,
    );
    boundedString(network.vpcId, `${valuePath}.providerSpec.network.vpcId`);
    const subnet = exactObject(
      network.subnet,
      AWS_SUBNET_KEYS,
      `${valuePath}.providerSpec.network.subnet`,
    );
    for (const key of ['id', 'availabilityZone', 'availabilityZoneId']) {
      boundedString(
        subnet[key],
        `${valuePath}.providerSpec.network.subnet.${key}`,
      );
    }
    for (const key of ['mapPublicIpOnLaunch', 'assignIpv6AddressOnCreation']) {
      if (typeof subnet[key] !== 'boolean') {
        throw new TypeError(
          `${valuePath}.providerSpec.network.subnet.${key} must be boolean.`,
        );
      }
    }
    const networkAcl = exactObject(
      network.networkAcl,
      AWS_NETWORK_ACL_KEYS,
      `${valuePath}.providerSpec.network.networkAcl`,
    );
    boundedString(
      networkAcl.id,
      `${valuePath}.providerSpec.network.networkAcl.id`,
    );
    boundedString(
      networkAcl.associationId,
      `${valuePath}.providerSpec.network.networkAcl.associationId`,
    );
    for (const direction of ['ipv4Ingress', 'ipv4Egress']) {
      const rules = exactObject(
        networkAcl[direction],
        AWS_NETWORK_ACL_RULE_KEYS,
        `${valuePath}.providerSpec.network.networkAcl.${direction}`,
      );
      for (const key of AWS_NETWORK_ACL_RULE_KEYS) {
        if (!Number.isSafeInteger(rules[key]) || rules[key] < 1) {
          throw new TypeError(
            `${valuePath}.providerSpec.network.networkAcl.${direction}.${key} is invalid.`,
          );
        }
      }
    }
    const routeTable = exactObject(
      network.routeTable,
      AWS_ROUTE_TABLE_KEYS,
      `${valuePath}.providerSpec.network.routeTable`,
    );
    boundedString(
      routeTable.id,
      `${valuePath}.providerSpec.network.routeTable.id`,
    );
    boundedString(
      routeTable.destinationCidrBlock,
      `${valuePath}.providerSpec.network.routeTable.destinationCidrBlock`,
    );
    boundedString(
      network.internetGatewayId,
      `${valuePath}.providerSpec.network.internetGatewayId`,
    );
  } else {
    const providerSpec = exactObject(
      preview.providerSpec,
      HETZNER_PROVIDER_SPEC_KEYS,
      `${valuePath}.providerSpec`,
    );
    if (providerSpec.kind !== 'hetzner') {
      throw new TypeError(`${valuePath}.providerSpec.kind must be 'hetzner'.`);
    }
    validateHetznerReference(
      providerSpec.location,
      `${valuePath}.providerSpec.location`,
    );
    validateHetznerReference(
      providerSpec.machineType,
      `${valuePath}.providerSpec.machineType`,
    );
    validateHetznerReference(
      providerSpec.image,
      `${valuePath}.providerSpec.image`,
    );
    const network = exactObject(
      providerSpec.network,
      HETZNER_NETWORK_KEYS,
      `${valuePath}.providerSpec.network`,
    );
    if (network.kind !== 'public') {
      throw new TypeError(
        `${valuePath}.providerSpec.network.kind must be 'public'.`,
      );
    }
  }

  const resources = exactObject(
    preview.resources,
    RESOURCES_KEYS,
    `${valuePath}.resources`,
  );
  if (
    !Array.isArray(resources.managed) ||
    resources.managed.length !== 3 ||
    !Array.isArray(resources.referenced)
  ) {
    throw new TypeError(`${valuePath}.resources is invalid.`);
  }
  const expectedManagedRoles =
    preview.provider === 'aws'
      ? AWS_MANAGED_ROLES.map(({ publicRole }) => publicRole).sort()
      : HETZNER_MANAGED_ROLES.map(({ publicRole }) => publicRole).sort();
  const expectedReferencedRoles =
    preview.provider === 'aws'
      ? AWS_REFERENCED_ROLES
      : HETZNER_REFERENCED_ROLES;
  if (resources.referenced.length !== expectedReferencedRoles.length) {
    throw new TypeError(`${valuePath}.resources.referenced roles are invalid.`);
  }
  let previousRole = '';
  for (const [index, value] of resources.managed.entries()) {
    const resource = exactObject(
      value,
      MANAGED_RESOURCE_KEYS,
      `${valuePath}.resources.managed[${index}]`,
    );
    boundedString(
      resource.role,
      `${valuePath}.resources.managed[${index}].role`,
    );
    if (resource.role <= previousRole) {
      throw new TypeError(
        `${valuePath}.resources.managed must be uniquely role-sorted.`,
      );
    }
    if (resource.role !== expectedManagedRoles[index]) {
      throw new TypeError(`${valuePath}.resources.managed roles are invalid.`);
    }
    previousRole = resource.role;
    if (
      resource.id !== null &&
      (typeof resource.id !== 'string' || resource.id.length === 0)
    ) {
      throw new TypeError(
        `${valuePath}.resources.managed[${index}].id is invalid.`,
      );
    }
    if (!MANAGED_STATES.has(resource.state)) {
      throw new TypeError(
        `${valuePath}.resources.managed[${index}].state is invalid.`,
      );
    }
    if (
      (['planned', 'pending', 'unbound'].includes(resource.state) &&
        resource.id !== null) ||
      (['present', 'absent'].includes(resource.state) && resource.id === null)
    ) {
      throw new TypeError(
        `${valuePath}.resources.managed[${index}] identity does not match its state.`,
      );
    }
  }
  previousRole = '';
  for (const [index, value] of resources.referenced.entries()) {
    const resource = exactObject(
      value,
      REFERENCED_RESOURCE_KEYS,
      `${valuePath}.resources.referenced[${index}]`,
    );
    boundedString(
      resource.role,
      `${valuePath}.resources.referenced[${index}].role`,
    );
    boundedString(
      resource.id,
      `${valuePath}.resources.referenced[${index}].id`,
    );
    if (resource.role <= previousRole) {
      throw new TypeError(
        `${valuePath}.resources.referenced must be uniquely role-sorted.`,
      );
    }
    if (resource.role !== expectedReferencedRoles[index]) {
      throw new TypeError(
        `${valuePath}.resources.referenced roles are invalid.`,
      );
    }
    previousRole = resource.role;
  }

  if (!Array.isArray(preview.actions) || preview.actions.length > 4) {
    throw new TypeError(`${valuePath}.actions is invalid.`);
  }
  for (const [index, value] of preview.actions.entries()) {
    const action = exactObject(
      value,
      ACTION_KEYS,
      `${valuePath}.actions[${index}]`,
    );
    if (!ACTION_KINDS.has(action.kind)) {
      throw new TypeError(
        `${valuePath}.actions[${index}].kind is unsupported.`,
      );
    }
  }

  assertManifestIsSecretFree(preview, valuePath);
  return deepFreeze(sortCanonicalJsonValue(preview));
}

/**
 * Create one stable, redacted, non-authoritative preview receipt from the
 * exact desired state, canonical provider plan, and optional local journal.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createSingleNodeDeploymentPreview(value) {
  const input = exactObject(value, INPUT_KEYS, 'singleNodeDeploymentPreview');
  const desired = validateSingleNodeDeploymentDesired(
    input.desired,
    'singleNodeDeploymentPreview.desired',
  );
  const provider = desired.intent.provider.kind;
  const plan =
    provider === 'aws'
      ? validateAwsSingleNodePlan(
          input.providerPlan,
          'singleNodeDeploymentPreview.providerPlan',
        )
      : validateHetznerSingleNodePlan(
          input.providerPlan,
          'singleNodeDeploymentPreview.providerPlan',
        );
  if (
    plan.deploymentInstanceId !== desired.deploymentInstanceId ||
    plan.desired.desiredRevisionId !== desired.desiredRevisionId
  ) {
    throw new Error(
      'singleNodeDeploymentPreview provider plan does not match the exact desired state.',
    );
  }
  const journal =
    input.journal === null
      ? null
      : validateSingleNodeDeploymentJournal(
          input.journal,
          'singleNodeDeploymentPreview.journal',
        );
  if (
    journal !== null &&
    (journal.deploymentInstanceId !== desired.deploymentInstanceId ||
      journal.desired.intent.appId !== desired.intent.appId)
  ) {
    throw new Error(
      'singleNodeDeploymentPreview journal does not match the deployment authority.',
    );
  }
  const desiredMatches =
    journal === null
      ? null
      : journal.desired.desiredRevisionId === desired.desiredRevisionId;
  const disposition = previewDisposition(plan, journal, desiredMatches);
  const receipt = {
    schemaVersion: SINGLE_NODE_DEPLOYMENT_PREVIEW_SCHEMA_VERSION,
    kind: SINGLE_NODE_DEPLOYMENT_PREVIEW_KIND,
    provider,
    status: disposition.status,
    blockedReason: disposition.blockedReason,
    deployment: {
      appId: desired.intent.appId,
      deploymentId: desired.intent.deployment.id,
      deploymentInstanceId: desired.deploymentInstanceId,
      revisionId: desired.artifact.revisionId,
      desiredRevisionId: desired.desiredRevisionId,
      artifact: {
        artifactId: desired.artifact.artifactId,
        byteDigest: desired.artifact.byteDigest,
        size: desired.artifact.size,
        target: desired.intent.target,
      },
      mode: desired.intent.mode,
      machine: desired.intent.machine,
      access: desired.intent.access,
    },
    journal:
      journal === null
        ? { state: 'absent', phase: null, desiredMatches: null }
        : {
            state: 'present',
            phase: journal.phase,
            desiredMatches,
          },
    providerSpec:
      provider === 'aws'
        ? projectAwsProviderSpec(plan.providerSpec)
        : projectHetznerProviderSpec(plan.providerSpec),
    resources: {
      managed: managedResources(provider, plan, journal),
      referenced: referencedResources(provider, plan.providerSpec),
    },
    actions: disposition.actions,
  };
  return validateSingleNodeDeploymentPreview(receipt);
}

export default {
  SINGLE_NODE_DEPLOYMENT_PREVIEW_KIND,
  SINGLE_NODE_DEPLOYMENT_PREVIEW_SCHEMA_VERSION,
  createSingleNodeDeploymentPreview,
  validateSingleNodeDeploymentPreview,
};
