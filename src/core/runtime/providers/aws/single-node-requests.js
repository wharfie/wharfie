/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This pure AWS mutation boundary keeps its exact immutable request contracts adjacent. */

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import { sha256Base64Url } from '../../content-id.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
} from '../../json-value.js';
import { SINGLE_NODE_CLOUD_INIT_MAX_BYTES } from '../../single-node-cloud-init.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  createAwsSingleNodeResourceIdentity,
  createAwsSingleNodeRunInstancesClientToken,
} from './resource-identity.js';
import { AWS_SINGLE_NODE_INSTANCE_TYPE } from './single-node-plan.js';
import { validateAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

export const AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION =
  'Wharfie single-node primary network interface.';
export const AWS_SINGLE_NODE_ROOT_VOLUME_IOPS = 3000;
export const AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT = 125;

const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/u;
const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8,32}$/u;
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const IDENTITY_MAX_BYTES = 32 * 1024;
const INGRESS_CIDR_SUBSET_MAX_BYTES = 4 * 1024;
const CREATE_SECURITY_GROUP_KEYS = new Set([
  'provisioningIntent',
  'securityGroupIdentity',
]);
const AUTHORIZE_INGRESS_KEYS = new Set([
  'provisioningIntent',
  'securityGroupIdentity',
  'securityGroupId',
  'allowedIpv4',
]);
const RUN_INSTANCES_KEYS = new Set([
  'provisioningIntent',
  'securityGroupIdentity',
  'instanceIdentity',
  'rootVolumeIdentity',
  'securityGroupId',
  'cloudInitBytes',
]);
const TERMINATE_INSTANCES_KEYS = new Set([
  'provisioningIntent',
  'instanceIdentity',
  'instanceId',
]);
const DELETE_VOLUME_KEYS = new Set([
  'provisioningIntent',
  'rootVolumeIdentity',
  'volumeId',
]);
const DELETE_SECURITY_GROUP_KEYS = new Set([
  'provisioningIntent',
  'securityGroupIdentity',
  'securityGroupId',
]);

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Require one exact plain object before reading any caller-owned property.
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, expected, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
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
 * Re-derive one identity and reject any supplied identity that is not its
 * exact JSON value. Only the re-derived frozen value can reach a request.
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} provisioningIntent
 * @param {'securityGroup'|'instance'|'rootVolume'} role
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
function validateResourceIdentity(value, provisioningIntent, role, valuePath) {
  const supplied = cloneBoundedJsonObject(value, IDENTITY_MAX_BYTES, valuePath);
  const expected = createAwsSingleNodeResourceIdentity(
    provisioningIntent,
    role,
  );
  if (
    JSON.stringify(sortCanonicalJsonValue(supplied)) !==
    JSON.stringify(sortCanonicalJsonValue(expected))
  ) {
    throw new Error(`${valuePath} does not match the provisioning intent.`);
  }
  return expected;
}

/**
 * Validate one canonical EC2 resource identifier.
 * @param {unknown} value
 * @param {RegExp} pattern
 * @param {string} valuePath
 * @returns {string}
 */
function providerId(value, pattern, valuePath) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return value;
}

/**
 * Copy identity tags into the AWS SDK spelling.
 * @param {Readonly<Record<string, any>>} identity
 * @returns {Array<{Key: string, Value: string}>}
 */
function copyTags(identity) {
  return identity.tags.map(
    (/** @type {{Key: string, Value: string}} */ tag) => ({
      Key: tag.Key,
      Value: tag.Value,
    }),
  );
}

/**
 * Copy, bound, and digest-check the exact bootstrap bytes before encoding.
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} provisioningIntent
 * @param {string} valuePath
 * @returns {string}
 */
function cloudInitBase64(value, provisioningIntent, valuePath) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError(`${valuePath} must be a Buffer or Uint8Array.`);
  }
  const bytes = Buffer.from(value);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > SINGLE_NODE_CLOUD_INIT_MAX_BYTES
  ) {
    throw new RangeError(
      `${valuePath} must contain between 1 and ${SINGLE_NODE_CLOUD_INIT_MAX_BYTES} bytes.`,
    );
  }
  if (sha256Base64Url(bytes) !== provisioningIntent.cloudInitDigest.value) {
    throw new Error(
      `${valuePath} does not match the provisioning intent digest.`,
    );
  }
  return bytes.toString('base64');
}

/**
 * Require a nonempty sorted/unique subset of the intent's canonical sources.
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} provisioningIntent
 * @param {string} valuePath
 * @returns {string[]}
 */
function ingressCidrSubset(value, provisioningIntent, valuePath) {
  const subset = cloneBoundedJsonValue(
    value,
    INGRESS_CIDR_SUBSET_MAX_BYTES,
    valuePath,
  );
  if (!Array.isArray(subset) || subset.length === 0) {
    throw new TypeError(`${valuePath} must be one nonempty array.`);
  }
  const allowed = provisioningIntent.plan.desired.intent.access.allowedIpv4;
  let priorIndex = -1;
  for (const cidr of subset) {
    const index = allowed.indexOf(cidr);
    if (typeof cidr !== 'string' || index <= priorIndex) {
      throw new TypeError(
        `${valuePath} must be a sorted unique subset of the provisioning intent.`,
      );
    }
    priorIndex = index;
  }
  return subset;
}

/**
 * Build the exact CreateSecurityGroup input for one provisioning intent.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeCreateSecurityGroupRequest(value) {
  const input = exactDataObject(
    value,
    CREATE_SECURITY_GROUP_KEYS,
    'awsCreateSecurityGroupRequest',
  );
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    input.provisioningIntent,
    'awsCreateSecurityGroupRequest.provisioningIntent',
  );
  const identity = validateResourceIdentity(
    input.securityGroupIdentity,
    provisioningIntent,
    'securityGroup',
    'awsCreateSecurityGroupRequest.securityGroupIdentity',
  );
  return deepFreeze({
    GroupName: identity.name,
    Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    VpcId: provisioningIntent.plan.providerSpec.vpc.vpcId,
    TagSpecifications: [
      {
        ResourceType: 'security-group',
        Tags: copyTags(identity),
      },
    ],
  });
}

/**
 * Build the exact TCP/22 IPv4 ingress input for one created security group.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeAuthorizeSecurityGroupIngressRequest(value) {
  const input = exactDataObject(
    value,
    AUTHORIZE_INGRESS_KEYS,
    'awsAuthorizeSecurityGroupIngressRequest',
  );
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    input.provisioningIntent,
    'awsAuthorizeSecurityGroupIngressRequest.provisioningIntent',
  );
  validateResourceIdentity(
    input.securityGroupIdentity,
    provisioningIntent,
    'securityGroup',
    'awsAuthorizeSecurityGroupIngressRequest.securityGroupIdentity',
  );
  const securityGroupId = providerId(
    input.securityGroupId,
    SECURITY_GROUP_ID_PATTERN,
    'awsAuthorizeSecurityGroupIngressRequest.securityGroupId',
  );
  const allowedIpv4 = ingressCidrSubset(
    input.allowedIpv4,
    provisioningIntent,
    'awsAuthorizeSecurityGroupIngressRequest.allowedIpv4',
  );
  return deepFreeze({
    GroupId: securityGroupId,
    IpPermissions: [
      {
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: allowedIpv4.map((cidr) => ({ CidrIp: cidr })),
      },
    ],
  });
}

/**
 * Build the exact minimal on-demand RunInstances input.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeRunInstancesRequest(value) {
  const input = exactDataObject(
    value,
    RUN_INSTANCES_KEYS,
    'awsRunInstancesRequest',
  );
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    input.provisioningIntent,
    'awsRunInstancesRequest.provisioningIntent',
  );
  validateResourceIdentity(
    input.securityGroupIdentity,
    provisioningIntent,
    'securityGroup',
    'awsRunInstancesRequest.securityGroupIdentity',
  );
  const instanceIdentity = validateResourceIdentity(
    input.instanceIdentity,
    provisioningIntent,
    'instance',
    'awsRunInstancesRequest.instanceIdentity',
  );
  const rootVolumeIdentity = validateResourceIdentity(
    input.rootVolumeIdentity,
    provisioningIntent,
    'rootVolume',
    'awsRunInstancesRequest.rootVolumeIdentity',
  );
  const securityGroupId = providerId(
    input.securityGroupId,
    SECURITY_GROUP_ID_PATTERN,
    'awsRunInstancesRequest.securityGroupId',
  );
  const userData = cloudInitBase64(
    input.cloudInitBytes,
    provisioningIntent,
    'awsRunInstancesRequest.cloudInitBytes',
  );
  const spec = provisioningIntent.plan.providerSpec;
  const root = spec.image.rootBlockDevice;
  return deepFreeze({
    ImageId: spec.image.imageId,
    InstanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
    MinCount: 1,
    MaxCount: 1,
    ClientToken: createAwsSingleNodeRunInstancesClientToken(provisioningIntent),
    CreditSpecification: { CpuCredits: 'standard' },
    CapacityReservationSpecification: {
      CapacityReservationPreference: 'none',
    },
    Monitoring: { Enabled: false },
    EbsOptimized: true,
    DisableApiStop: false,
    DisableApiTermination: false,
    InstanceInitiatedShutdownBehavior: 'stop',
    HibernationOptions: { Configured: false },
    EnclaveOptions: { Enabled: false },
    MetadataOptions: {
      HttpEndpoint: 'enabled',
      HttpTokens: 'required',
      HttpPutResponseHopLimit: 1,
      HttpProtocolIpv6: 'disabled',
      InstanceMetadataTags: 'disabled',
    },
    NetworkInterfaces: [
      {
        DeviceIndex: 0,
        NetworkCardIndex: 0,
        InterfaceType: 'interface',
        Description: AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
        AssociatePublicIpAddress: true,
        DeleteOnTermination: true,
        SubnetId: spec.subnet.subnetId,
        Groups: [securityGroupId],
      },
    ],
    BlockDeviceMappings: [
      {
        DeviceName: spec.image.rootDeviceName,
        Ebs: {
          SnapshotId: root.snapshotId,
          VolumeType: 'gp3',
          VolumeSize: root.sizeGiB,
          Iops: AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
          Throughput: AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
          Encrypted: true,
          DeleteOnTermination: true,
        },
      },
    ],
    UserData: userData,
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: copyTags(instanceIdentity),
      },
      {
        ResourceType: 'volume',
        Tags: copyTags(rootVolumeIdentity),
      },
    ],
  });
}

/**
 * Build the exact TerminateInstances input for one bound instance.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeTerminateInstancesRequest(value) {
  const input = exactDataObject(
    value,
    TERMINATE_INSTANCES_KEYS,
    'awsTerminateInstancesRequest',
  );
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    input.provisioningIntent,
    'awsTerminateInstancesRequest.provisioningIntent',
  );
  validateResourceIdentity(
    input.instanceIdentity,
    provisioningIntent,
    'instance',
    'awsTerminateInstancesRequest.instanceIdentity',
  );
  return deepFreeze({
    InstanceIds: [
      providerId(
        input.instanceId,
        INSTANCE_ID_PATTERN,
        'awsTerminateInstancesRequest.instanceId',
      ),
    ],
    Force: false,
    SkipOsShutdown: false,
  });
}

/**
 * Build the exact DeleteVolume input for one bound root volume.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeDeleteVolumeRequest(value) {
  const input = exactDataObject(
    value,
    DELETE_VOLUME_KEYS,
    'awsDeleteVolumeRequest',
  );
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    input.provisioningIntent,
    'awsDeleteVolumeRequest.provisioningIntent',
  );
  validateResourceIdentity(
    input.rootVolumeIdentity,
    provisioningIntent,
    'rootVolume',
    'awsDeleteVolumeRequest.rootVolumeIdentity',
  );
  return deepFreeze({
    VolumeId: providerId(
      input.volumeId,
      VOLUME_ID_PATTERN,
      'awsDeleteVolumeRequest.volumeId',
    ),
  });
}

/**
 * Build the exact DeleteSecurityGroup input for one bound group.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeDeleteSecurityGroupRequest(value) {
  const input = exactDataObject(
    value,
    DELETE_SECURITY_GROUP_KEYS,
    'awsDeleteSecurityGroupRequest',
  );
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    input.provisioningIntent,
    'awsDeleteSecurityGroupRequest.provisioningIntent',
  );
  validateResourceIdentity(
    input.securityGroupIdentity,
    provisioningIntent,
    'securityGroup',
    'awsDeleteSecurityGroupRequest.securityGroupIdentity',
  );
  return deepFreeze({
    GroupId: providerId(
      input.securityGroupId,
      SECURITY_GROUP_ID_PATTERN,
      'awsDeleteSecurityGroupRequest.securityGroupId',
    ),
  });
}

export default {
  AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
  AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
  AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
  createAwsSingleNodeAuthorizeSecurityGroupIngressRequest,
  createAwsSingleNodeCreateSecurityGroupRequest,
  createAwsSingleNodeDeleteSecurityGroupRequest,
  createAwsSingleNodeDeleteVolumeRequest,
  createAwsSingleNodeRunInstancesRequest,
  createAwsSingleNodeTerminateInstancesRequest,
};
