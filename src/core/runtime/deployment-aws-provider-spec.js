/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact assertion helpers and broad JSON documents are clearer than repeated typedefs here. */

import { validateSha256Digest } from './application-revision.js';
import { getBuildTargetId } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  DEPLOYMENT_PROFILE_ID_PREFIX,
  validateDeploymentProfile,
} from './deployment-profile.js';
import {
  PROVIDER_SCOPE_ID_PREFIX,
  validateProviderScope,
} from './deployment-provider-scope.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from './deployment-resource-graph.js';
import { DEPLOYMENT_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS } from './deployment-service-health-contract.js';
import { cloneJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION = 3;
export const AWS_SINGLE_NODE_PROVIDER_SPEC_KIND = 'awsSingleNodeProviderSpec';
export const AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN =
  'wharfie:aws-single-node-provider-spec:v3';
export const AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX = 'wap3';
export const AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION = 3;

export const AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS = Object.freeze({
  x86_64:
    '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
  arm64: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64',
});

const FACTORY_KEYS = new Set([
  'profile',
  'providerScope',
  'machineImage',
  'placement',
  'storage',
  'bootstrapDigest',
  'runtimeIdentityPolicyDigest',
]);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerContractVersion',
  'providerScopeId',
  'profileRevisionId',
  'targetId',
  'resourceGraphId',
  'machineImage',
  'placement',
  'storage',
  'node',
  'capabilities',
]);
const DOCUMENT_KEYS = new Set(['providerSpecId', ...PAYLOAD_KEYS]);
const MACHINE_IMAGE_KEYS = new Set([
  'sourceParameter',
  'imageId',
  'ownerAccountId',
  'architecture',
  'imageType',
  'rootDeviceType',
  'virtualizationType',
  'enaSupport',
]);
const SOURCE_PARAMETER_KEYS = new Set(['name', 'version']);
const PLACEMENT_KEYS = new Set(['availabilityZoneId']);
const STORAGE_KEYS = new Set(['ebsKmsKeyArn']);
const NODE_KEYS = new Set(['instanceType', 'metadataOptions', 'bootstrap']);
const METADATA_OPTIONS_KEYS = new Set([
  'httpEndpoint',
  'httpTokens',
  'httpPutResponseHopLimit',
  'instanceMetadataTags',
]);
const BOOTSTRAP_KEYS = new Set(['contractVersion', 'digest']);
const CAPABILITIES_KEYS = new Set([
  'applicationState',
  'controlState',
  'artifactStorage',
  'runtimeIdentity',
  'networking',
  'serviceHealth',
]);
const VOLUME_KEYS = new Set([
  'contractVersion',
  'storage',
  'volumeType',
  'sizeGiB',
  'iops',
  'throughputMiBps',
  'multiAttach',
  'deviceName',
  'deleteOnTermination',
  'encrypted',
  'onDestroy',
]);
const ARTIFACT_STORAGE_KEYS = new Set([
  'contractVersion',
  'storage',
  'encryption',
  'onDestroy',
]);
const RUNTIME_IDENTITY_KEYS = new Set([
  'contractVersion',
  'managementChannel',
  'artifactAccess',
  'serviceHealthAccess',
  'applicationInstanceMetadata',
  'policyDigest',
]);
const NETWORKING_KEYS = new Set([
  'contractVersion',
  'kind',
  'vpcCidr',
  'subnetCidr',
  'publicIpv4',
  'egressCidr',
  'ingressCidrs',
]);
const SERVICE_HEALTH_KEYS = new Set([
  'contractVersion',
  'storage',
  'intervalSeconds',
  'maxAgeSeconds',
  'clockSkewSeconds',
  'publication',
  'noncurrentVersionExpirationDays',
]);

const AMI_ID_PATTERN = /^ami-[0-9a-f]{8,32}$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const AVAILABILITY_ZONE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-az[1-9][0-9]*$/;
const KMS_KEY_ARN_PATTERN =
  /^arn:([a-z0-9-]+):kms:([a-z0-9-]+):([0-9]{12}):key\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mrk-[0-9a-f]{32})$/;
const TARGET_ID_PATTERN =
  /^node-v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-linux-(?:x64|arm64)-glibc$/;

const FIXED_METADATA_OPTIONS = Object.freeze({
  httpEndpoint: 'enabled',
  httpTokens: 'required',
  httpPutResponseHopLimit: 1,
  instanceMetadataTags: 'disabled',
});

const FIXED_APPLICATION_VOLUME = Object.freeze({
  contractVersion: 1,
  storage: 'ebs-volume',
  volumeType: 'gp3',
  sizeGiB: 8,
  iops: 3000,
  throughputMiBps: 125,
  multiAttach: false,
  deviceName: '/dev/sdf',
  deleteOnTermination: false,
  encrypted: true,
  onDestroy: 'retain',
});

const FIXED_CONTROL_VOLUME = Object.freeze({
  ...FIXED_APPLICATION_VOLUME,
  deviceName: '/dev/sdg',
});

const FIXED_ARTIFACT_STORAGE = Object.freeze({
  contractVersion: 1,
  storage: 's3-object',
  encryption: 'AES256',
  onDestroy: 'purge',
});

const FIXED_NETWORKING = deepFreeze({
  contractVersion: 1,
  kind: 'public-ipv4-egress-no-ingress',
  vpcCidr: '10.42.0.0/16',
  subnetCidr: '10.42.0.0/24',
  publicIpv4: true,
  egressCidr: '0.0.0.0/0',
  ingressCidrs: [],
});

const FIXED_SERVICE_HEALTH = Object.freeze({
  contractVersion: 1,
  storage: 's3-object',
  intervalSeconds: 15,
  maxAgeSeconds: 60,
  clockSkewSeconds: 5,
  publication: 'conditional-current-object',
  noncurrentVersionExpirationDays:
    DEPLOYMENT_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS,
});

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertAllKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} value @param {Record<string, any>} expected @param {Set<string>} keys @param {string} path @returns {Record<string, any>} */
function validateFixedObject(value, expected, keys, path) {
  const object = cloneJsonObject(value, path);
  assertAllKeys(object, keys, path);
  if (
    JSON.stringify(sortCanonicalJsonValue(object)) !==
    JSON.stringify(sortCanonicalJsonValue(expected))
  ) {
    throw new TypeError(`${path} does not match the fixed provider contract.`);
  }
  return { ...expected };
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateMachineImage(value, path) {
  const image = cloneJsonObject(value, path);
  assertAllKeys(image, MACHINE_IMAGE_KEYS, path);
  const sourceParameter = cloneJsonObject(
    image.sourceParameter,
    `${path}.sourceParameter`,
  );
  assertAllKeys(
    sourceParameter,
    SOURCE_PARAMETER_KEYS,
    `${path}.sourceParameter`,
  );
  if (
    sourceParameter.name !== AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64 &&
    sourceParameter.name !== AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.arm64
  ) {
    throw new TypeError(
      `${path}.sourceParameter.name is not supported by the fixed provider contract.`,
    );
  }
  if (
    !Number.isSafeInteger(sourceParameter.version) ||
    sourceParameter.version < 1
  ) {
    throw new TypeError(
      `${path}.sourceParameter.version must be a positive safe integer.`,
    );
  }
  if (
    typeof image.imageId !== 'string' ||
    !AMI_ID_PATTERN.test(image.imageId)
  ) {
    throw new TypeError(`${path}.imageId must be a canonical AWS AMI ID.`);
  }
  if (
    typeof image.ownerAccountId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(image.ownerAccountId)
  ) {
    throw new TypeError(
      `${path}.ownerAccountId must be a 12-digit AWS account ID.`,
    );
  }
  if (image.architecture !== 'x86_64' && image.architecture !== 'arm64') {
    throw new TypeError(`${path}.architecture must be 'x86_64' or 'arm64'.`);
  }
  const expectedParameter =
    image.architecture === 'x86_64'
      ? AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64
      : AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.arm64;
  if (sourceParameter.name !== expectedParameter) {
    throw new Error(
      `${path}.sourceParameter.name does not match the machine-image architecture.`,
    );
  }
  if (
    image.imageType !== 'machine' ||
    image.rootDeviceType !== 'ebs' ||
    image.virtualizationType !== 'hvm' ||
    image.enaSupport !== true
  ) {
    throw new TypeError(
      `${path} does not match the fixed machine-image contract.`,
    );
  }
  return deepFreeze({
    sourceParameter: {
      name: sourceParameter.name,
      version: sourceParameter.version,
    },
    imageId: image.imageId,
    ownerAccountId: image.ownerAccountId,
    architecture: image.architecture,
    imageType: 'machine',
    rootDeviceType: 'ebs',
    virtualizationType: 'hvm',
    enaSupport: true,
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validatePlacement(value, path) {
  const placement = cloneJsonObject(value, path);
  assertAllKeys(placement, PLACEMENT_KEYS, path);
  if (
    typeof placement.availabilityZoneId !== 'string' ||
    !AVAILABILITY_ZONE_ID_PATTERN.test(placement.availabilityZoneId)
  ) {
    throw new TypeError(
      `${path}.availabilityZoneId must be a canonical AWS Availability Zone ID.`,
    );
  }
  return deepFreeze({
    availabilityZoneId: placement.availabilityZoneId,
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateStorage(value, path) {
  const storage = cloneJsonObject(value, path);
  assertAllKeys(storage, STORAGE_KEYS, path);
  if (
    typeof storage.ebsKmsKeyArn !== 'string' ||
    !KMS_KEY_ARN_PATTERN.test(storage.ebsKmsKeyArn)
  ) {
    throw new TypeError(
      `${path}.ebsKmsKeyArn must be a canonical AWS KMS key ARN.`,
    );
  }
  return deepFreeze({ ebsKmsKeyArn: storage.ebsKmsKeyArn });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateNode(value, path) {
  const node = cloneJsonObject(value, path);
  assertAllKeys(node, NODE_KEYS, path);
  if (node.instanceType !== 't3.small' && node.instanceType !== 't4g.small') {
    throw new TypeError(
      `${path}.instanceType is not supported by the fixed provider contract.`,
    );
  }
  const metadataOptions = validateFixedObject(
    node.metadataOptions,
    FIXED_METADATA_OPTIONS,
    METADATA_OPTIONS_KEYS,
    `${path}.metadataOptions`,
  );
  const bootstrap = cloneJsonObject(node.bootstrap, `${path}.bootstrap`);
  assertAllKeys(bootstrap, BOOTSTRAP_KEYS, `${path}.bootstrap`);
  if (bootstrap.contractVersion !== 1) {
    throw new TypeError(
      `${path}.bootstrap.contractVersion must be the integer 1.`,
    );
  }
  return deepFreeze({
    instanceType: node.instanceType,
    metadataOptions,
    bootstrap: {
      contractVersion: 1,
      digest: validateSha256Digest(
        bootstrap.digest,
        `${path}.bootstrap.digest`,
      ),
    },
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateCapabilities(value, path) {
  const capabilities = cloneJsonObject(value, path);
  assertAllKeys(capabilities, CAPABILITIES_KEYS, path);
  const applicationState = validateFixedObject(
    capabilities.applicationState,
    FIXED_APPLICATION_VOLUME,
    VOLUME_KEYS,
    `${path}.applicationState`,
  );
  const controlState = validateFixedObject(
    capabilities.controlState,
    FIXED_CONTROL_VOLUME,
    VOLUME_KEYS,
    `${path}.controlState`,
  );
  const artifactStorage = validateFixedObject(
    capabilities.artifactStorage,
    FIXED_ARTIFACT_STORAGE,
    ARTIFACT_STORAGE_KEYS,
    `${path}.artifactStorage`,
  );
  const runtimeIdentity = cloneJsonObject(
    capabilities.runtimeIdentity,
    `${path}.runtimeIdentity`,
  );
  assertAllKeys(
    runtimeIdentity,
    RUNTIME_IDENTITY_KEYS,
    `${path}.runtimeIdentity`,
  );
  if (
    runtimeIdentity.contractVersion !== 1 ||
    runtimeIdentity.managementChannel !== 'ssm' ||
    runtimeIdentity.artifactAccess !== 'read' ||
    runtimeIdentity.serviceHealthAccess !== 'read-write-current-object' ||
    runtimeIdentity.applicationInstanceMetadata !== 'blocked'
  ) {
    throw new TypeError(
      `${path}.runtimeIdentity does not match the fixed provider contract.`,
    );
  }
  const networking = validateFixedObject(
    capabilities.networking,
    FIXED_NETWORKING,
    NETWORKING_KEYS,
    `${path}.networking`,
  );
  const serviceHealth = validateFixedObject(
    capabilities.serviceHealth,
    FIXED_SERVICE_HEALTH,
    SERVICE_HEALTH_KEYS,
    `${path}.serviceHealth`,
  );
  return deepFreeze({
    applicationState,
    controlState,
    artifactStorage,
    runtimeIdentity: {
      contractVersion: 1,
      managementChannel: 'ssm',
      artifactAccess: 'read',
      serviceHealthAccess: 'read-write-current-object',
      applicationInstanceMetadata: 'blocked',
      policyDigest: validateSha256Digest(
        runtimeIdentity.policyDigest,
        `${path}.runtimeIdentity.policyDigest`,
      ),
    },
    networking,
    serviceHealth,
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validatePayload(value, path) {
  const payload = cloneJsonObject(value, path);
  assertAllKeys(payload, PAYLOAD_KEYS, path);
  if (payload.schemaVersion !== AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION) {
    throw new TypeError(`${path}.schemaVersion must be the integer 3.`);
  }
  if (payload.kind !== AWS_SINGLE_NODE_PROVIDER_SPEC_KIND) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_PROVIDER_SPEC_KIND}'.`,
    );
  }
  if (
    payload.providerContractVersion !==
    AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION
  ) {
    throw new TypeError(
      `${path}.providerContractVersion must be the integer 3.`,
    );
  }
  assertDomainSeparatedSha256Id(
    payload.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${path}.providerScopeId`,
  );
  assertDomainSeparatedSha256Id(
    payload.profileRevisionId,
    DEPLOYMENT_PROFILE_ID_PREFIX,
    `${path}.profileRevisionId`,
  );
  if (
    typeof payload.targetId !== 'string' ||
    !TARGET_ID_PATTERN.test(payload.targetId)
  ) {
    throw new TypeError(
      `${path}.targetId must be a canonical supported Linux build target ID.`,
    );
  }
  if (
    payload.resourceGraphId !== AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId
  ) {
    throw new TypeError(
      `${path}.resourceGraphId must identify the exact AWS single-node resource graph.`,
    );
  }
  const machineImage = validateMachineImage(
    payload.machineImage,
    `${path}.machineImage`,
  );
  const placement = validatePlacement(payload.placement, `${path}.placement`);
  const storage = validateStorage(payload.storage, `${path}.storage`);
  const node = validateNode(payload.node, `${path}.node`);
  const expectedInstanceType =
    machineImage.architecture === 'x86_64' ? 't3.small' : 't4g.small';
  if (node.instanceType !== expectedInstanceType) {
    throw new Error(
      `${path}.node.instanceType does not match the machine-image architecture.`,
    );
  }
  const normalized = {
    schemaVersion: AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_PROVIDER_SPEC_KIND,
    providerContractVersion: AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION,
    providerScopeId: payload.providerScopeId,
    profileRevisionId: payload.profileRevisionId,
    targetId: payload.targetId,
    resourceGraphId: payload.resourceGraphId,
    machineImage,
    placement,
    storage,
    node,
    capabilities: validateCapabilities(
      payload.capabilities,
      `${path}.capabilities`,
    ),
  };
  assertManifestIsSecretFree(normalized, path);
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/** @param {Readonly<Record<string, any>>} spec @param {unknown} context @param {string} path @returns {void} */
function assertContext(spec, context, path) {
  const input = cloneJsonObject(context, `${path} context`);
  assertAllKeys(
    input,
    new Set(['profile', 'providerScope']),
    `${path} context`,
  );
  const profile = validateDeploymentProfile(
    input.profile,
    `${path} context.profile`,
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    `${path} context.providerScope`,
  );
  if (
    profile.provider.kind !== 'aws' ||
    profile.provider.contractVersion !==
      AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION
  ) {
    throw new Error(
      `${path} profile does not select AWS provider contract version 3.`,
    );
  }
  if (
    providerScope.provider !== 'aws' ||
    profile.provider.scope.region !== providerScope.region
  ) {
    throw new Error(
      `${path} provider scope does not match the exact profile provider and region.`,
    );
  }
  if (
    spec.providerScopeId !== providerScope.providerScopeId ||
    spec.profileRevisionId !== profile.profileRevisionId ||
    spec.targetId !== getBuildTargetId(profile.target)
  ) {
    throw new Error(
      `${path} does not match the exact profile, provider scope, and build target.`,
    );
  }
  const expectedArchitecture =
    profile.target.architecture === 'x64' ? 'x86_64' : 'arm64';
  if (spec.machineImage.architecture !== expectedArchitecture) {
    throw new Error(
      `${path}.machineImage.architecture does not match the profile target.`,
    );
  }
  const kmsKeyArn = KMS_KEY_ARN_PATTERN.exec(spec.storage.ebsKmsKeyArn);
  if (
    kmsKeyArn === null ||
    kmsKeyArn[1] !== providerScope.partition ||
    kmsKeyArn[2] !== providerScope.region ||
    kmsKeyArn[3] !== providerScope.accountId
  ) {
    throw new Error(
      `${path}.storage.ebsKmsKeyArn does not match the exact provider scope.`,
    );
  }
}

/**
 * Create the exact provider inputs selected for one AWS single-node plan.
 * Mutable discovery state is reduced to an explicit AMI ID and parameter
 * version before entering this boundary.
 * @param {unknown} value - Exact profile/scope, image receipt, and behavior digests.
 * @returns {Readonly<Record<string, any>>} - Immutable content-addressed specification.
 */
export function createAwsSingleNodeProviderSpec(value) {
  const input = cloneJsonObject(value, 'awsProviderSpec input');
  assertAllKeys(input, FACTORY_KEYS, 'awsProviderSpec input');
  const profile = validateDeploymentProfile(
    input.profile,
    'awsProviderSpec input.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsProviderSpec input.providerScope',
  );
  const machineImage = validateMachineImage(
    input.machineImage,
    'awsProviderSpec input.machineImage',
  );
  const placement = validatePlacement(
    input.placement,
    'awsProviderSpec input.placement',
  );
  const storage = validateStorage(
    input.storage,
    'awsProviderSpec input.storage',
  );
  const architecture =
    profile.target.architecture === 'x64' ? 'x86_64' : 'arm64';
  if (machineImage.architecture !== architecture) {
    throw new Error(
      'awsProviderSpec.machineImage.architecture does not match the profile target.',
    );
  }
  const payload = validatePayload(
    {
      schemaVersion: AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_PROVIDER_SPEC_KIND,
      providerContractVersion: AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION,
      providerScopeId: providerScope.providerScopeId,
      profileRevisionId: profile.profileRevisionId,
      targetId: getBuildTargetId(profile.target),
      resourceGraphId: AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId,
      machineImage,
      placement,
      storage,
      node: {
        instanceType: architecture === 'x86_64' ? 't3.small' : 't4g.small',
        metadataOptions: FIXED_METADATA_OPTIONS,
        bootstrap: {
          contractVersion: 1,
          digest: validateSha256Digest(
            input.bootstrapDigest,
            'awsProviderSpec input.bootstrapDigest',
          ),
        },
      },
      capabilities: {
        applicationState: FIXED_APPLICATION_VOLUME,
        controlState: FIXED_CONTROL_VOLUME,
        artifactStorage: FIXED_ARTIFACT_STORAGE,
        runtimeIdentity: {
          contractVersion: 1,
          managementChannel: 'ssm',
          artifactAccess: 'read',
          serviceHealthAccess: 'read-write-current-object',
          applicationInstanceMetadata: 'blocked',
          policyDigest: validateSha256Digest(
            input.runtimeIdentityPolicyDigest,
            'awsProviderSpec input.runtimeIdentityPolicyDigest',
          ),
        },
        networking: FIXED_NETWORKING,
        serviceHealth: FIXED_SERVICE_HEALTH,
      },
    },
    'awsProviderSpec',
  );
  assertContext(payload, { profile, providerScope }, 'awsProviderSpec');
  const providerSpecId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    value: payload,
    valuePath: 'awsProviderSpec',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, providerSpecId }));
}

/**
 * Validate one serialized provider specification and recompute its identity.
 * @param {unknown} value - Candidate serialized specification.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical independent specification.
 */
export function validateAwsSingleNodeProviderSpec(
  value,
  valuePath = 'awsProviderSpec',
) {
  const document = cloneJsonObject(value, valuePath);
  assertAllKeys(document, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.providerSpecId,
    AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    `${valuePath}.providerSpecId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.providerSpecId !== expectedId) {
    throw new Error(
      `${valuePath}.providerSpecId does not match the exact provider specification.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, providerSpecId: expectedId }),
  );
}

/**
 * Cross-check a structurally valid specification against the resolved
 * profile and credential scope that authorize its use.
 * @param {unknown} value - Candidate provider specification.
 * @param {{profile: unknown, providerScope: unknown}} context - Exact immutable context.
 * @returns {Readonly<Record<string, any>>} - Fully cross-checked specification.
 */
export function validateAwsSingleNodeProviderSpecContext(value, context) {
  const spec = validateAwsSingleNodeProviderSpec(value);
  assertContext(spec, context, 'awsProviderSpec');
  return spec;
}

export default {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION,
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN,
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  AWS_SINGLE_NODE_PROVIDER_SPEC_KIND,
  AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION,
  createAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
};
