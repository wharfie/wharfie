/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable host-boundary contracts are clearer than repeated parser-specific expansions. */

import nodePath from 'node:path';

import { assertApplicationRevisionId } from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  validateAwsSingleNodeHostActivationRequest,
} from './deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from './deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_DESIRED_KIND,
  AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_DESIRED_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_RUNTIME_GROUP,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_RUNTIME_USER,
  getAwsSingleNodeHostRetainedFilesystemUuid,
  getAwsSingleNodeHostRetainedStorageLayout,
  validateAwsSingleNodeHostApplicationStorageEvidence,
  validateAwsSingleNodeHostControlStorageEvidence,
  validateAwsSingleNodeHostRetainedStorageDesired,
} from './deployment-aws-host-retained-storage.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
  getAwsSingleNodeHostRetainedStorageBootProjection,
} from './deployment-aws-host-retained-storage-observer.js';
import {
  getAwsSingleNodeHostRetainedStorageByIdPath,
  getAwsSingleNodeHostRetainedStorageMountUnitName,
} from './deployment-aws-host-retained-storage-projection.js';
import { AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX } from './deployment-aws-provider-spec.js';
import {
  assertAwsEc2InstanceId,
  assertAwsIamRoleId,
  getAwsSingleNodeRuntimeRoleName,
} from './deployment-aws-runtime-identity-contract.js';
import { validateAwsSingleNodeHostRuntimeIdentityEvidence } from './deployment-aws-host-runtime-identity.js';
import { AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX } from './deployment-aws-volume-attachment-evidence.js';
import {
  assertDeploymentHeadId,
  assertDeploymentOperationId,
  validateDeploymentHead,
} from './deployment-head.js';
import {
  DEPLOYMENT_PLAN_ID_PREFIX,
  validateDeploymentPlan,
} from './deployment-plan.js';
import { DEPLOYMENT_PROFILE_ID_PREFIX } from './deployment-profile.js';
import {
  PROVIDER_SCOPE_ID_PREFIX,
  assertDeploymentInstanceId,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
  assertDeploymentIncarnationId,
} from './deployment-resource-binding.js';
import { DEPLOYMENT_REVISION_ID_PREFIX } from './deployment-revision.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { createLocalAppStorageLayout } from './local-app-storage.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import { createSystemdUserServiceLayout } from './services/systemd-user-service.js';

export const AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_KIND =
  'awsSingleNodeHostDeactivationRequest';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_DOMAIN =
  'wharfie:aws-single-node-host-deactivation-request:v1';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX = 'whdq1';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_KIND =
  'awsSingleNodeHostDeactivationReceipt';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_DOMAIN =
  'wharfie:aws-single-node-host-deactivation-receipt:v1';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX = 'whdr1';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_KIND =
  'awsSingleNodeHostDeactivationServiceTerminalAssertion';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_KIND =
  'awsSingleNodeHostDeactivationStorageTerminalAssertion';
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_DOCUMENT_MAX_BYTES = 64 * 1024;
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_CONTEXT_MAX_BYTES = 512 * 1024;
export const AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_CONFIG_ROOT =
  '/var/lib/wharfie-runtime/.config';

const REQUEST_CONTEXT_KEYS = new Set([
  'activationRequest',
  'plan',
  'head',
  'runtimeIdentity',
  'applicationStorage',
  'controlStorage',
]);
const REQUEST_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'activationRequestId',
  'providerScopeId',
  'providerSpecId',
  'deploymentInstanceId',
  'incarnationId',
  'destroyPlanId',
  'destroyOperationId',
  'authorizedHeadId',
  'authorizedHeadGeneration',
  'lastSettledOperationId',
  'deploymentRevisionId',
  'profileRevisionId',
  'appId',
  'artifactId',
  'revisionId',
  'nodeBindingId',
  'nodeProviderResourceId',
  'runtimeRoleBindingId',
  'runtimeRoleId',
  'runtimeRoleName',
  'runtimeAccount',
  'service',
  'storage',
]);
const REQUEST_DOCUMENT_KEYS = new Set(['requestId', ...REQUEST_PAYLOAD_KEYS]);
const REQUEST_SERVICE_KEYS = new Set([
  'unitName',
  'unitPath',
  'installationPath',
]);
const RUNTIME_ACCOUNT_KEYS = new Set(['user', 'group', 'uid', 'gid']);
const STORAGE_IDENTITY_KEYS = new Set([
  'capabilityKind',
  'volumeBindingId',
  'volumeProviderResourceId',
  'sizeBytes',
  'createdWithoutSnapshot',
  'attachmentBindingId',
  'attachmentProviderResourceId',
  'filesystemType',
  'filesystemUuid',
  'filesystemProfileId',
  'mountTarget',
  'mountUnitName',
  'mountUnitPath',
  'localFsEnableLinkPath',
  'roleDropInPath',
  'userManagerUnitName',
  'volumeIdentityPath',
  'bootWiringId',
  'bootProjectionId',
]);
const DISTINCT_STORAGE_IDENTITY_KEYS = Object.freeze([
  'volumeBindingId',
  'volumeProviderResourceId',
  'attachmentBindingId',
  'attachmentProviderResourceId',
  'filesystemUuid',
  'mountTarget',
  'mountUnitName',
  'volumeIdentityPath',
  'bootWiringId',
]);
const STORAGE_ROLES = Object.freeze([
  Object.freeze({
    capabilityKind: 'application-state',
    attachmentResourceKey: 'application-state-attachment',
    mountTargetKey: 'applicationMountTarget',
    desiredKind: AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_DESIRED_KIND,
    dropInName: '60-wharfie-retained-application-state.conf',
  }),
  Object.freeze({
    capabilityKind: 'control-state',
    attachmentResourceKey: 'control-state-attachment',
    mountTargetKey: 'controlMountTarget',
    desiredKind: AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_DESIRED_KIND,
    dropInName: '61-wharfie-retained-control-state.conf',
  }),
]);
const FILESYSTEM_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const RECEIPT_CREATE_KEYS = new Set(['request', 'service', 'storage']);
const RECEIPT_CONTEXT_KEYS = new Set([
  'request',
  'requestContext',
  'currentHead',
]);
const RECEIPT_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'requestId',
  'destroyOperationId',
  'service',
  'storage',
]);
const RECEIPT_DOCUMENT_KEYS = new Set(['receiptId', ...RECEIPT_PAYLOAD_KEYS]);
const RECEIPT_SERVICE_KEYS = new Set([
  'schemaVersion',
  'kind',
  ...REQUEST_SERVICE_KEYS,
  'disposition',
  'lifecycleStatus',
  'runtimeSession',
  'loadState',
  'unitFileState',
  'activeState',
  'subState',
  'result',
  'mainPid',
  'execMainStatus',
  'fragmentPath',
  'dropInPaths',
  'needDaemonReload',
]);
const RECEIPT_STORAGE_KEYS = new Set([
  'schemaVersion',
  'kind',
  ...STORAGE_IDENTITY_KEYS,
  'runtimeUid',
  'runtimeGid',
  'syncStatus',
  'mountStatus',
  'mountUnitLoadState',
  'mountUnitFileState',
  'mountUnitActiveState',
  'mountUnitFragmentPath',
  'mountUnitDropInPaths',
  'mountUnitNeedDaemonReload',
  'mountUnitFileStatus',
  'localFsEnableLinkStatus',
  'roleDropInPath',
  'roleDropInStatus',
  'userManagerUnitName',
  'userManagerBindsTo',
  'userManagerAfter',
  'userManagerNeedDaemonReload',
]);
const LINUX_RUNTIME_ID_MAX = 4_294_967_293;
const LINUX_NOBODY_ID = 65_534;

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

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function cloneDocument(value, path) {
  return cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_DOCUMENT_MAX_BYTES,
    path,
  );
}

/** @param {unknown} value @param {string} path @returns {number} */
function positiveSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} path @returns {number} */
function linuxRuntimeId(value, path) {
  const id = positiveSafeInteger(value, path);
  if (id > LINUX_RUNTIME_ID_MAX || id === LINUX_NOBODY_ID) {
    throw new TypeError(
      `${path} must be a usable Linux account ID from 1 through ${LINUX_RUNTIME_ID_MAX}, excluding nobody.`,
    );
  }
  return id;
}

/** @param {unknown} value @param {string} path @returns {string} */
function nonemptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a nonempty string.`);
  }
  return value;
}

/** @param {unknown} value @param {string} path @returns {ReadonlyArray<string>} */
function validateSystemdUnitList(value, path) {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError(`${path} must be an array of at most 64 unit names.`);
  }
  const units = value.map((candidate, index) => {
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      Buffer.byteLength(candidate, 'utf8') > 255 ||
      !/^[A-Za-z0-9:_.@\\-]+$/u.test(candidate)
    ) {
      throw new TypeError(`${path}[${index}] must be a systemd unit name.`);
    }
    return candidate;
  });
  const canonical = [...new Set(units)].sort(compareCanonicalStrings);
  if (
    canonical.length !== units.length ||
    units.some((unit, index) => unit !== canonical[index])
  ) {
    throw new Error(`${path} must contain sorted unique unit names.`);
  }
  return Object.freeze(canonical);
}

/** @param {string} appId @returns {Readonly<Record<string, string>>} */
function expectedServiceIdentity(appId) {
  const layout = createSystemdUserServiceLayout({
    appId,
    dataRoot: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
    configRoot: AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_CONFIG_ROOT,
  });
  return deepFreeze({
    unitName: layout.unitName,
    unitPath: layout.unitPath,
    installationPath: layout.installationPath,
  });
}

/** @param {string} appId @returns {Readonly<Record<string, string>>} */
function expectedStorageTargets(appId) {
  const layout = createLocalAppStorageLayout({
    appId,
    dataRoot: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
  });
  return deepFreeze({
    applicationMountTarget: layout.applicationStatePath,
    controlMountTarget: layout.controlPath,
  });
}

/** @param {unknown} value @param {string} appId @param {string} path @returns {Readonly<Record<string, string>>} */
function validateRequestService(value, appId, path) {
  const service = cloneDocument(value, path);
  assertExactKeys(service, REQUEST_SERVICE_KEYS, path);
  const expected = expectedServiceIdentity(appId);
  for (const key of REQUEST_SERVICE_KEYS) {
    if (service[key] !== expected[key]) {
      throw new Error(`${path}.${key} does not match its fixed service.`);
    }
  }
  return expected;
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateRuntimeAccount(value, path) {
  const account = cloneDocument(value, path);
  assertExactKeys(account, RUNTIME_ACCOUNT_KEYS, path);
  if (
    account.user !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_RUNTIME_USER ||
    account.group !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_RUNTIME_GROUP
  ) {
    throw new TypeError(
      `${path} must name the fixed wharfie-runtime user and group.`,
    );
  }
  return deepFreeze({
    user: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_RUNTIME_USER,
    group: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_RUNTIME_GROUP,
    uid: linuxRuntimeId(account.uid, `${path}.uid`),
    gid: linuxRuntimeId(account.gid, `${path}.gid`),
  });
}

/** @param {unknown} value @param {number} index @param {string} appId @param {Readonly<Record<string, any>>} runtimeAccount @param {string} path @returns {Readonly<Record<string, any>>} */
function validateStorageIdentity(value, index, appId, runtimeAccount, path) {
  const storage = cloneDocument(value, path);
  assertExactKeys(storage, STORAGE_IDENTITY_KEYS, path);
  const role = STORAGE_ROLES[index];
  if (role === undefined || storage.capabilityKind !== role.capabilityKind) {
    throw new TypeError(
      `${path}.capabilityKind must be the canonical retained-storage role at index ${index}.`,
    );
  }
  assertDomainSeparatedSha256Id(
    storage.volumeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.volumeBindingId`,
  );
  const volumeIdentityPath = getAwsSingleNodeHostRetainedStorageByIdPath(
    storage.volumeProviderResourceId,
  );
  const sizeBytes = positiveSafeInteger(storage.sizeBytes, `${path}.sizeBytes`);
  if (storage.createdWithoutSnapshot !== true) {
    throw new TypeError(`${path}.createdWithoutSnapshot must be literal true.`);
  }
  assertDomainSeparatedSha256Id(
    storage.attachmentBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.attachmentBindingId`,
  );
  assertDomainSeparatedSha256Id(
    storage.attachmentProviderResourceId,
    AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    `${path}.attachmentProviderResourceId`,
  );
  if (
    typeof storage.filesystemUuid !== 'string' ||
    !FILESYSTEM_UUID_PATTERN.test(storage.filesystemUuid)
  ) {
    throw new TypeError(
      `${path}.filesystemUuid must be a lowercase Wharfie UUIDv8.`,
    );
  }
  if (
    storage.filesystemType !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE ||
    storage.filesystemProfileId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID ||
    storage.bootProjectionId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID
  ) {
    throw new TypeError(
      `${path} must use the fixed retained filesystem and boot projection profiles.`,
    );
  }
  const targets = expectedStorageTargets(appId);
  const mountTarget = targets[role.mountTargetKey];
  const mountUnitName =
    getAwsSingleNodeHostRetainedStorageMountUnitName(mountTarget);
  const mountUnitPath = nodePath.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    mountUnitName,
  );
  const localFsEnableLinkPath = nodePath.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    'local-fs.target.wants',
    mountUnitName,
  );
  const userManagerUnitName = `user@${runtimeAccount.uid}.service`;
  const roleDropInPath = nodePath.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    `${userManagerUnitName}.d`,
    role.dropInName,
  );
  const bootWiringId = `wharfie-retained-${role.capabilityKind}-${storage.filesystemUuid}`;
  const expected =
    /** @type {Record<string, any>} */
    ({
      capabilityKind: role.capabilityKind,
      volumeBindingId: storage.volumeBindingId,
      volumeProviderResourceId: storage.volumeProviderResourceId,
      sizeBytes,
      createdWithoutSnapshot: true,
      attachmentBindingId: storage.attachmentBindingId,
      attachmentProviderResourceId: storage.attachmentProviderResourceId,
      filesystemType: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
      filesystemUuid: storage.filesystemUuid,
      filesystemProfileId:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
      mountTarget,
      mountUnitName,
      mountUnitPath,
      localFsEnableLinkPath,
      roleDropInPath,
      userManagerUnitName,
      volumeIdentityPath,
      bootWiringId,
      bootProjectionId:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID,
    });
  for (const key of STORAGE_IDENTITY_KEYS) {
    if (storage[key] !== expected[key]) {
      throw new Error(`${path}.${key} does not match its fixed storage role.`);
    }
  }
  return deepFreeze(sortCanonicalJsonValue(expected));
}

/** @param {Readonly<Record<string, any>>[]} storage @param {string} path @returns {void} */
function assertDistinctStorageIdentities(storage, path) {
  for (const key of DISTINCT_STORAGE_IDENTITY_KEYS) {
    if (storage[0][key] === storage[1][key]) {
      throw new Error(
        `${path} must use distinct ${key} values across application-state and control-state.`,
      );
    }
  }
}

/** @param {Readonly<Record<string, any>>[]} storage @param {string} path @returns {void} */
function assertDistinctStorageBindingIds(storage, path) {
  const bindingIds = storage.flatMap((identity) => [
    identity.volumeBindingId,
    identity.attachmentBindingId,
  ]);
  if (new Set(bindingIds).size !== bindingIds.length) {
    throw new Error(
      `${path} must use four globally distinct volume and attachment binding IDs.`,
    );
  }
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>[]} storage @param {string} path @returns {void} */
function assertGlobalRequestBindingIds(request, storage, path) {
  const bindingIds = [
    request.nodeBindingId,
    request.runtimeRoleBindingId,
    ...storage.flatMap((identity) => [
      identity.volumeBindingId,
      identity.attachmentBindingId,
    ]),
  ];
  if (new Set(bindingIds).size !== bindingIds.length) {
    throw new Error(
      `${path} must use globally distinct host and storage binding IDs.`,
    );
  }
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} storage @param {number} index @param {string} path @returns {Readonly<Record<string, string>>} */
function validateRequestStorageProjection(request, storage, index, path) {
  const role = STORAGE_ROLES[index];
  if (role === undefined) {
    throw new TypeError(`${path} retained-storage role is not supported.`);
  }
  const desired = validateAwsSingleNodeHostRetainedStorageDesired({
    schemaVersion: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_SCHEMA_VERSION,
    kind: role.desiredKind,
    requestId: request.activationRequestId,
    providerScopeId: request.providerScopeId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
    nodeProviderResourceId: request.nodeProviderResourceId,
    appId: request.appId,
    capabilityKind: role.capabilityKind,
    volumeBindingId: storage.volumeBindingId,
    volumeProviderResourceId: storage.volumeProviderResourceId,
    sizeBytes: storage.sizeBytes,
    createdWithoutSnapshot: true,
    attachmentBindingId: storage.attachmentBindingId,
    attachmentProviderResourceId: storage.attachmentProviderResourceId,
    filesystem: {
      type: storage.filesystemType,
      uuid: storage.filesystemUuid,
      profileId: storage.filesystemProfileId,
    },
    mount: {
      target: storage.mountTarget,
      readOnly: false,
      nodev: true,
      noexec: true,
      nosuid: true,
      privatePropagation: true,
    },
    directory: {
      user: request.runtimeAccount.user,
      group: request.runtimeAccount.group,
      uid: request.runtimeAccount.uid,
      gid: request.runtimeAccount.gid,
      mode: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE,
    },
    bootWiring: {
      id: storage.bootWiringId,
      projectionId: storage.bootProjectionId,
      persistent: true,
      enabled: true,
      sourceByVolumeIdentity: true,
      orderedBeforeRuntimeUserManager: true,
    },
  });
  const projection = getAwsSingleNodeHostRetainedStorageBootProjection(desired);
  const matches = [
    ['mountUnitName', projection.unitName],
    ['mountUnitPath', projection.unitPath],
    ['localFsEnableLinkPath', projection.enableLinkPath],
    ['roleDropInPath', projection.dropInPath],
    ['volumeIdentityPath', projection.sourcePath],
    ['userManagerUnitName', `user@${request.runtimeAccount.uid}.service`],
  ];
  for (const [key, expected] of matches) {
    if (storage[key] !== expected) {
      throw new Error(`${path}.${key} does not match its exact projection.`);
    }
  }
  return projection;
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateRequestPayload(value, path) {
  const request = cloneDocument(value, path);
  assertExactKeys(request, REQUEST_PAYLOAD_KEYS, path);
  if (
    request.schemaVersion !==
    AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_SCHEMA_VERSION
  ) {
    throw new TypeError(
      `${path}.schemaVersion must be the integer ${AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_SCHEMA_VERSION}.`,
    );
  }
  if (request.kind !== AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_KIND) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    request.activationRequestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    `${path}.activationRequestId`,
  );
  assertDomainSeparatedSha256Id(
    request.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${path}.providerScopeId`,
  );
  assertDomainSeparatedSha256Id(
    request.providerSpecId,
    AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    `${path}.providerSpecId`,
  );
  assertDeploymentInstanceId(
    request.deploymentInstanceId,
    `${path}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(request.incarnationId, `${path}.incarnationId`);
  assertDomainSeparatedSha256Id(
    request.destroyPlanId,
    DEPLOYMENT_PLAN_ID_PREFIX,
    `${path}.destroyPlanId`,
  );
  assertDeploymentOperationId(
    request.destroyOperationId,
    `${path}.destroyOperationId`,
  );
  assertDeploymentHeadId(request.authorizedHeadId, `${path}.authorizedHeadId`);
  const authorizedHeadGeneration = positiveSafeInteger(
    request.authorizedHeadGeneration,
    `${path}.authorizedHeadGeneration`,
  );
  assertDeploymentOperationId(
    request.lastSettledOperationId,
    `${path}.lastSettledOperationId`,
  );
  assertDomainSeparatedSha256Id(
    request.deploymentRevisionId,
    DEPLOYMENT_REVISION_ID_PREFIX,
    `${path}.deploymentRevisionId`,
  );
  assertDomainSeparatedSha256Id(
    request.profileRevisionId,
    DEPLOYMENT_PROFILE_ID_PREFIX,
    `${path}.profileRevisionId`,
  );
  assertLogicalId(request.appId, `${path}.appId`);
  assertArtifactId(request.artifactId, `${path}.artifactId`);
  assertApplicationRevisionId(request.revisionId, `${path}.revisionId`);
  assertDomainSeparatedSha256Id(
    request.nodeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.nodeBindingId`,
  );
  assertAwsEc2InstanceId(
    request.nodeProviderResourceId,
    `${path}.nodeProviderResourceId`,
  );
  assertDomainSeparatedSha256Id(
    request.runtimeRoleBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.runtimeRoleBindingId`,
  );
  assertAwsIamRoleId(request.runtimeRoleId, `${path}.runtimeRoleId`);
  const runtimeRoleName = getAwsSingleNodeRuntimeRoleName({
    providerScopeId: request.providerScopeId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
  });
  if (request.runtimeRoleName !== runtimeRoleName) {
    throw new Error(
      `${path}.runtimeRoleName does not match its exact deployment authority.`,
    );
  }
  const runtimeAccount = validateRuntimeAccount(
    request.runtimeAccount,
    `${path}.runtimeAccount`,
  );
  const service = validateRequestService(
    request.service,
    request.appId,
    `${path}.service`,
  );
  if (
    !Array.isArray(request.storage) ||
    request.storage.length !== STORAGE_ROLES.length
  ) {
    throw new TypeError(
      `${path}.storage must contain the exact application-state and control-state roles.`,
    );
  }
  const storage = request.storage.map((candidate, index) =>
    validateStorageIdentity(
      candidate,
      index,
      request.appId,
      runtimeAccount,
      `${path}.storage[${index}]`,
    ),
  );
  assertDistinctStorageIdentities(storage, `${path}.storage`);
  assertDistinctStorageBindingIds(storage, `${path}.storage`);
  assertGlobalRequestBindingIds(request, storage, path);
  const normalized = {
    schemaVersion: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_KIND,
    activationRequestId: request.activationRequestId,
    providerScopeId: request.providerScopeId,
    providerSpecId: request.providerSpecId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
    destroyPlanId: request.destroyPlanId,
    destroyOperationId: request.destroyOperationId,
    authorizedHeadId: request.authorizedHeadId,
    authorizedHeadGeneration,
    lastSettledOperationId: request.lastSettledOperationId,
    deploymentRevisionId: request.deploymentRevisionId,
    profileRevisionId: request.profileRevisionId,
    appId: request.appId,
    artifactId: request.artifactId,
    revisionId: request.revisionId,
    nodeBindingId: request.nodeBindingId,
    nodeProviderResourceId: request.nodeProviderResourceId,
    runtimeRoleBindingId: request.runtimeRoleBindingId,
    runtimeRoleId: request.runtimeRoleId,
    runtimeRoleName,
    runtimeAccount,
    service,
    storage,
  };
  storage.forEach((identity, index) =>
    validateRequestStorageProjection(
      normalized,
      identity,
      index,
      `${path}.storage[${index}]`,
    ),
  );
  assertManifestIsSecretFree(normalized, path);
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/** @param {Readonly<Record<string, any>>} head @param {string} resourceKey @param {string} path @returns {Readonly<Record<string, any>>} */
function bindingFor(head, resourceKey, path) {
  const binding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (binding === undefined) {
    throw new Error(`${path} lacks binding '${resourceKey}'.`);
  }
  return binding;
}

/** @param {Readonly<Record<string, any>>} request @param {string} kind @param {Readonly<Record<string, any>>} priorEvidence @returns {Readonly<Record<string, any>>} */
function activationEvidenceContext(request, kind, priorEvidence) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(request, kind),
      kind,
      attemptGeneration: 0,
    },
    priorEvidence,
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function deriveRequestAuthority(value, path) {
  const input = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_CONTEXT_MAX_BYTES,
    path,
  );
  assertExactKeys(input, REQUEST_CONTEXT_KEYS, path);
  const activationRequest = validateAwsSingleNodeHostActivationRequest(
    input.activationRequest,
    `${path}.activationRequest`,
  );
  const runtimeIdentity = validateAwsSingleNodeHostRuntimeIdentityEvidence(
    input.runtimeIdentity,
    activationEvidenceContext(activationRequest, 'runtime-identity', {}),
    `${path}.runtimeIdentity`,
  );
  const applicationStorage =
    validateAwsSingleNodeHostApplicationStorageEvidence(
      input.applicationStorage,
      activationEvidenceContext(activationRequest, 'application-storage', {
        'runtime-identity': runtimeIdentity,
      }),
    );
  const controlStorage = validateAwsSingleNodeHostControlStorageEvidence(
    input.controlStorage,
    activationEvidenceContext(activationRequest, 'control-storage', {
      'runtime-identity': runtimeIdentity,
      'application-storage': applicationStorage,
    }),
  );
  if (
    applicationStorage.directory.uid !== controlStorage.directory.uid ||
    applicationStorage.directory.gid !== controlStorage.directory.gid
  ) {
    throw new Error(
      `${path} retained storage evidence must bind one shared runtime account.`,
    );
  }
  const runtimeAccount = validateRuntimeAccount(
    {
      user: applicationStorage.directory.user,
      group: applicationStorage.directory.group,
      uid: applicationStorage.directory.uid,
      gid: applicationStorage.directory.gid,
    },
    `${path}.runtimeAccount`,
  );
  const plan = validateDeploymentPlan(input.plan, `${path}.plan`);
  const head = validateDeploymentHead(input.head, `${path}.head`);
  const activeOperation = head.activeOperation;
  const lastOperation = head.lastOperation;
  const exactIdentity =
    plan.deploymentInstanceId === activationRequest.deploymentInstanceId &&
    plan.incarnationId === activationRequest.incarnationId &&
    sameJson(plan.providerScope, activationRequest.providerScope) &&
    plan.providerSpec.providerSpecId === activationRequest.providerSpecId &&
    plan.deploymentRevision.deploymentRevisionId ===
      activationRequest.deploymentRevisionId &&
    plan.deploymentRevision.profileRevisionId ===
      activationRequest.profileRevisionId &&
    plan.deploymentRevision.appId === activationRequest.appId &&
    plan.deploymentRevision.artifactId === activationRequest.artifactId &&
    plan.deploymentRevision.revisionId === activationRequest.revisionId &&
    head.deploymentInstanceId === activationRequest.deploymentInstanceId &&
    head.incarnationId === activationRequest.incarnationId &&
    sameJson(head.providerScope, activationRequest.providerScope);
  if (!exactIdentity) {
    throw new Error(
      `${path} plan/head identity does not match the prior activation request.`,
    );
  }
  if (
    plan.operation !== 'destroy' ||
    plan.basis.settledDeploymentRevisionId !==
      activationRequest.deploymentRevisionId ||
    plan.basis.headGeneration <= activationRequest.authorizedHeadGeneration ||
    head.generation <= plan.basis.headGeneration ||
    head.phase !== 'DESTROYING' ||
    head.settledDeploymentRevisionId !==
      activationRequest.deploymentRevisionId ||
    head.targetDeploymentRevisionId !== null ||
    activeOperation === null ||
    activeOperation.kind !== 'destroy' ||
    activeOperation.status !== 'running' ||
    activeOperation.planId !== plan.planId ||
    activeOperation.nextActionIndex !== 0 ||
    activeOperation.intents.length !== plan.actions.length ||
    lastOperation === null ||
    lastOperation.kind === 'destroy' ||
    lastOperation.planId !== activationRequest.planId ||
    lastOperation.operationId !== activationRequest.deploymentOperationId
  ) {
    throw new Error(
      `${path} must name an exact running all-pending DESTROYING frontier after the prior activation settlement.`,
    );
  }
  if (
    head.resourceBindings.length !== plan.actions.length ||
    plan.actions.some(
      (
        /** @type {Readonly<Record<string, any>>} */ action,
        /** @type {number} */ index,
      ) => {
        const intent = activeOperation.intents[index];
        const binding = head.resourceBindings.find(
          (/** @type {Readonly<Record<string, any>>} */ candidate) =>
            candidate.resourceKey === action.resourceKey,
        );
        return (
          binding === undefined ||
          intent.actionId !== action.actionId ||
          intent.status !== 'pending' ||
          intent.ownershipNonce !== binding.ownershipNonce ||
          action.capability.kind !== binding.capability.kind ||
          action.capability.version !== binding.capability.version ||
          action.role.kind !== binding.role.kind ||
          action.role.version !== binding.role.version ||
          action.management !== binding.management ||
          action.ownershipMode !== binding.ownershipMode ||
          action.onDestroy !== binding.onDestroy ||
          action.before === null ||
          action.before.providerType !== binding.providerType ||
          action.before.providerResourceId !== binding.providerResourceId ||
          (binding.onDestroy === 'retain'
            ? !sameJson(action.before, action.after)
            : action.after !== null)
        );
      },
    )
  ) {
    throw new Error(
      `${path} destroy intents/actions must exactly cover the current owned binding frontier.`,
    );
  }
  const nodeBinding = bindingFor(head, 'substrate', path);
  const runtimeRoleBinding = bindingFor(head, 'runtime-role', path);
  if (
    nodeBinding.bindingId !== activationRequest.nodeBindingId ||
    nodeBinding.providerResourceId !==
      activationRequest.nodeProviderResourceId ||
    runtimeRoleBinding.bindingId !== activationRequest.runtimeRoleBindingId ||
    runtimeRoleBinding.providerResourceId !== activationRequest.runtimeRoleId
  ) {
    throw new Error(
      `${path} host bindings do not match the prior activation request.`,
    );
  }
  const storage = STORAGE_ROLES.map((role) => {
    const activationVolume = activationRequest.volumes.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.capabilityKind === role.capabilityKind,
    );
    if (activationVolume === undefined) {
      throw new Error(
        `${path} activation request lacks ${role.capabilityKind}.`,
      );
    }
    const volumeBinding = bindingFor(head, role.capabilityKind, path);
    const attachmentBinding = bindingFor(
      head,
      role.attachmentResourceKey,
      path,
    );
    if (
      volumeBinding.bindingId !== activationVolume.volumeBindingId ||
      volumeBinding.providerResourceId !==
        activationVolume.volumeProviderResourceId ||
      attachmentBinding.bindingId !== activationVolume.attachmentBindingId ||
      attachmentBinding.providerResourceId !==
        activationVolume.attachmentProviderResourceId
    ) {
      throw new Error(
        `${path} ${role.capabilityKind} bindings do not match the prior activation request.`,
      );
    }
    return {
      role,
      activationVolume,
    };
  });
  return deepFreeze({
    activationRequest,
    runtimeIdentity,
    applicationStorage,
    controlStorage,
    runtimeAccount,
    plan,
    head,
    activeOperation,
    lastOperation,
    nodeBinding,
    runtimeRoleBinding,
    storage,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function createRequestFromAuthority(authority) {
  const { activationRequest, plan, head, activeOperation, lastOperation } =
    authority;
  const retainedLayout =
    /** @type {Readonly<Record<string, string>>} */
    (getAwsSingleNodeHostRetainedStorageLayout(activationRequest));
  const storage = authority.storage.map(
    (/** @type {Readonly<Record<string, any>>} */ entry) => {
      const { role, activationVolume } = entry;
      const filesystemUuid = getAwsSingleNodeHostRetainedFilesystemUuid(
        activationRequest,
        role.capabilityKind,
      );
      const mountTarget = retainedLayout[role.mountTargetKey];
      const mountUnitName =
        getAwsSingleNodeHostRetainedStorageMountUnitName(mountTarget);
      const userManagerUnitName = `user@${authority.runtimeAccount.uid}.service`;
      return {
        capabilityKind: role.capabilityKind,
        volumeBindingId: activationVolume.volumeBindingId,
        volumeProviderResourceId: activationVolume.volumeProviderResourceId,
        sizeBytes: activationVolume.sizeBytes,
        createdWithoutSnapshot: true,
        attachmentBindingId: activationVolume.attachmentBindingId,
        attachmentProviderResourceId:
          activationVolume.attachmentProviderResourceId,
        filesystemType: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
        filesystemUuid,
        filesystemProfileId:
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
        mountTarget,
        mountUnitName,
        mountUnitPath: nodePath.posix.join(
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
          mountUnitName,
        ),
        localFsEnableLinkPath: nodePath.posix.join(
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
          'local-fs.target.wants',
          mountUnitName,
        ),
        roleDropInPath: nodePath.posix.join(
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
          `${userManagerUnitName}.d`,
          role.dropInName,
        ),
        userManagerUnitName,
        volumeIdentityPath: getAwsSingleNodeHostRetainedStorageByIdPath(
          activationVolume.volumeProviderResourceId,
        ),
        bootWiringId: `wharfie-retained-${role.capabilityKind}-${filesystemUuid}`,
        bootProjectionId:
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID,
      };
    },
  );
  const payload = validateRequestPayload(
    {
      schemaVersion: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_KIND,
      activationRequestId: activationRequest.requestId,
      providerScopeId: activationRequest.providerScope.providerScopeId,
      providerSpecId: activationRequest.providerSpecId,
      deploymentInstanceId: activationRequest.deploymentInstanceId,
      incarnationId: activationRequest.incarnationId,
      destroyPlanId: plan.planId,
      destroyOperationId: activeOperation.operationId,
      authorizedHeadId: head.headId,
      authorizedHeadGeneration: head.generation,
      lastSettledOperationId: lastOperation.operationId,
      deploymentRevisionId: activationRequest.deploymentRevisionId,
      profileRevisionId: activationRequest.profileRevisionId,
      appId: activationRequest.appId,
      artifactId: activationRequest.artifactId,
      revisionId: activationRequest.revisionId,
      nodeBindingId: activationRequest.nodeBindingId,
      nodeProviderResourceId: activationRequest.nodeProviderResourceId,
      runtimeRoleBindingId: activationRequest.runtimeRoleBindingId,
      runtimeRoleId: activationRequest.runtimeRoleId,
      runtimeRoleName: activationRequest.runtimeRoleName,
      runtimeAccount: authority.runtimeAccount,
      service: expectedServiceIdentity(activationRequest.appId),
      storage,
    },
    'awsSingleNodeHostDeactivationRequest',
  );
  const requestId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
    value: payload,
    valuePath: 'awsSingleNodeHostDeactivationRequest',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, requestId }));
}

/**
 * Create the exact pure host-deactivation request authorized by a running
 * all-pending destroy frontier after the most recently settled activation.
 * Recovery may advance durable head generations but cannot change the plan,
 * operation, bindings, last settlement, or untouched intent frontier.
 * @param {unknown} value - Activation request/evidence, destroy plan, and head.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
export function createAwsSingleNodeHostDeactivationRequest(value) {
  return createRequestFromAuthority(
    deriveRequestAuthority(
      value,
      'awsSingleNodeHostDeactivationRequestContext',
    ),
  );
}

/**
 * Validate, reidentify, and freeze one serialized deactivation request.
 * Context-free validation proves its canonical internal identities; mutation
 * authority still requires the exact plan/head context validator.
 * @param {unknown} value - Candidate request.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
export function validateAwsSingleNodeHostDeactivationRequest(
  value,
  valuePath = 'awsSingleNodeHostDeactivationRequest',
) {
  const document = cloneDocument(value, valuePath);
  assertExactKeys(document, REQUEST_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.requestId,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
    `${valuePath}.requestId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of REQUEST_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validateRequestPayload(payloadInput, valuePath);
  const requestId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.requestId !== requestId) {
    throw new Error(
      `${valuePath}.requestId does not match its exact deactivation request.`,
    );
  }
  return deepFreeze(sortCanonicalJsonValue({ ...payload, requestId }));
}

/**
 * Require a serialized request to equal the one derivable from the exact
 * current destroy plan/head and prior activation request.
 * @param {unknown} value - Candidate request.
 * @param {unknown} context - Exact request-creation context.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Context-bound request.
 */
export function validateAwsSingleNodeHostDeactivationRequestContext(
  value,
  context,
  valuePath = 'awsSingleNodeHostDeactivationRequest',
) {
  const request = validateAwsSingleNodeHostDeactivationRequest(
    value,
    valuePath,
  );
  const expected = createRequestFromAuthority(
    deriveRequestAuthority(context, `${valuePath}.context`),
  );
  if (!sameJson(request, expected)) {
    throw new Error(`${valuePath} does not match its exact context.`);
  }
  return request;
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateReceiptService(value, path) {
  const service = cloneDocument(value, path);
  assertExactKeys(service, RECEIPT_SERVICE_KEYS, path);
  if (
    service.schemaVersion !==
    AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_SCHEMA_VERSION
  ) {
    throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
  }
  if (
    service.kind !== AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_KIND
  ) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_KIND}'.`,
    );
  }
  for (const key of REQUEST_SERVICE_KEYS) {
    nonemptyString(service[key], `${path}.${key}`);
  }
  /** @type {ReadonlyArray<readonly [string, string | number | boolean]>} */
  const fixed = [
    ['disposition', 'uninstalled'],
    ['lifecycleStatus', 'STOPPED'],
    ['runtimeSession', 'absent'],
    ['loadState', 'not-found'],
    ['unitFileState', ''],
    ['activeState', 'inactive'],
    ['subState', 'dead'],
    ['result', 'success'],
    ['mainPid', 0],
    ['execMainStatus', 0],
    ['fragmentPath', ''],
    ['dropInPaths', ''],
    ['needDaemonReload', false],
  ];
  for (const [key, expected] of fixed) {
    if (service[key] !== expected) {
      throw new TypeError(
        `${path}.${key} must be ${JSON.stringify(expected)}.`,
      );
    }
  }
  return deepFreeze(
    sortCanonicalJsonValue(
      Object.fromEntries(
        [
          'schemaVersion',
          'kind',
          ...REQUEST_SERVICE_KEYS,
          ...fixed.map(([key]) => key),
        ].map((key) => [key, service[key]]),
      ),
    ),
  );
}

/** @param {unknown} value @param {number} index @param {string} path @returns {Readonly<Record<string, any>>} */
function validateReceiptStorage(value, index, path) {
  const storage = cloneDocument(value, path);
  assertExactKeys(storage, RECEIPT_STORAGE_KEYS, path);
  const role = STORAGE_ROLES[index];
  if (role === undefined || storage.capabilityKind !== role.capabilityKind) {
    throw new TypeError(
      `${path}.capabilityKind must be the canonical retained-storage role at index ${index}.`,
    );
  }
  if (
    storage.schemaVersion !==
      AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_SCHEMA_VERSION ||
    storage.kind !== AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_KIND
  ) {
    throw new TypeError(
      `${path} must use the V1 storage terminal-assertion schema.`,
    );
  }
  assertDomainSeparatedSha256Id(
    storage.volumeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.volumeBindingId`,
  );
  const volumeIdentityPath = getAwsSingleNodeHostRetainedStorageByIdPath(
    storage.volumeProviderResourceId,
  );
  const sizeBytes = positiveSafeInteger(storage.sizeBytes, `${path}.sizeBytes`);
  if (storage.createdWithoutSnapshot !== true) {
    throw new TypeError(`${path}.createdWithoutSnapshot must be literal true.`);
  }
  assertDomainSeparatedSha256Id(
    storage.attachmentBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.attachmentBindingId`,
  );
  assertDomainSeparatedSha256Id(
    storage.attachmentProviderResourceId,
    AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    `${path}.attachmentProviderResourceId`,
  );
  if (
    typeof storage.filesystemUuid !== 'string' ||
    !FILESYSTEM_UUID_PATTERN.test(storage.filesystemUuid)
  ) {
    throw new TypeError(
      `${path}.filesystemUuid must be a lowercase Wharfie UUIDv8.`,
    );
  }
  if (
    storage.filesystemType !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE ||
    storage.filesystemProfileId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID ||
    storage.bootProjectionId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID
  ) {
    throw new TypeError(
      `${path} must use the fixed retained filesystem and boot projection profiles.`,
    );
  }
  const mountTarget = nonemptyString(
    storage.mountTarget,
    `${path}.mountTarget`,
  );
  const mountUnitName =
    getAwsSingleNodeHostRetainedStorageMountUnitName(mountTarget);
  const mountUnitPath = nodePath.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    mountUnitName,
  );
  const localFsEnableLinkPath = nodePath.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    'local-fs.target.wants',
    mountUnitName,
  );
  const runtimeUid = linuxRuntimeId(storage.runtimeUid, `${path}.runtimeUid`);
  const runtimeGid = linuxRuntimeId(storage.runtimeGid, `${path}.runtimeGid`);
  const userManagerUnitName = `user@${runtimeUid}.service`;
  const roleDropInPath = nodePath.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    `${userManagerUnitName}.d`,
    role.dropInName,
  );
  const bootWiringId = `wharfie-retained-${role.capabilityKind}-${storage.filesystemUuid}`;
  const identities =
    /** @type {Record<string, any>} */
    ({
      capabilityKind: role.capabilityKind,
      volumeBindingId: storage.volumeBindingId,
      volumeProviderResourceId: storage.volumeProviderResourceId,
      sizeBytes,
      createdWithoutSnapshot: true,
      attachmentBindingId: storage.attachmentBindingId,
      attachmentProviderResourceId: storage.attachmentProviderResourceId,
      filesystemType: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
      filesystemUuid: storage.filesystemUuid,
      filesystemProfileId:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
      mountTarget,
      mountUnitName,
      mountUnitPath,
      localFsEnableLinkPath,
      roleDropInPath,
      userManagerUnitName,
      volumeIdentityPath,
      bootWiringId,
      bootProjectionId:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID,
    });
  for (const key of STORAGE_IDENTITY_KEYS) {
    if (storage[key] !== identities[key]) {
      throw new Error(`${path}.${key} does not match its exact identity.`);
    }
  }
  /** @type {ReadonlyArray<readonly [string, string | boolean]>} */
  const fixed = [
    ['syncStatus', 'complete'],
    ['mountStatus', 'unmounted'],
    ['mountUnitLoadState', 'not-found'],
    ['mountUnitFileState', ''],
    ['mountUnitActiveState', 'inactive'],
    ['mountUnitFragmentPath', ''],
    ['mountUnitDropInPaths', ''],
    ['mountUnitNeedDaemonReload', false],
    ['mountUnitFileStatus', 'absent'],
    ['localFsEnableLinkStatus', 'absent'],
    ['roleDropInStatus', 'absent'],
    ['userManagerNeedDaemonReload', false],
  ];
  for (const [key, expected] of fixed) {
    if (storage[key] !== expected) {
      throw new TypeError(
        `${path}.${key} must be ${JSON.stringify(expected)}.`,
      );
    }
  }
  const userManagerBindsTo = validateSystemdUnitList(
    storage.userManagerBindsTo,
    `${path}.userManagerBindsTo`,
  );
  const userManagerAfter = validateSystemdUnitList(
    storage.userManagerAfter,
    `${path}.userManagerAfter`,
  );
  if (
    userManagerBindsTo.includes(mountUnitName) ||
    userManagerAfter.includes(mountUnitName)
  ) {
    throw new Error(
      `${path} effective user-manager dependencies must not name its removed mount unit.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_KIND,
      ...identities,
      runtimeUid,
      runtimeGid,
      ...Object.fromEntries(fixed),
      userManagerBindsTo,
      userManagerAfter,
    }),
  );
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateReceiptPayload(value, path) {
  const receipt = cloneDocument(value, path);
  assertExactKeys(receipt, RECEIPT_PAYLOAD_KEYS, path);
  if (
    receipt.schemaVersion !==
    AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_SCHEMA_VERSION
  ) {
    throw new TypeError(
      `${path}.schemaVersion must be the integer ${AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_SCHEMA_VERSION}.`,
    );
  }
  if (receipt.kind !== AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_KIND) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    receipt.requestId,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
    `${path}.requestId`,
  );
  assertDeploymentOperationId(
    receipt.destroyOperationId,
    `${path}.destroyOperationId`,
  );
  const service = validateReceiptService(receipt.service, `${path}.service`);
  if (
    !Array.isArray(receipt.storage) ||
    receipt.storage.length !== STORAGE_ROLES.length
  ) {
    throw new TypeError(
      `${path}.storage must contain the exact application-state and control-state roles.`,
    );
  }
  const storage = receipt.storage.map((candidate, index) =>
    validateReceiptStorage(candidate, index, `${path}.storage[${index}]`),
  );
  assertDistinctStorageIdentities(storage, `${path}.storage`);
  assertDistinctStorageBindingIds(storage, `${path}.storage`);
  if (
    storage[0].runtimeUid !== storage[1].runtimeUid ||
    storage[0].runtimeGid !== storage[1].runtimeGid ||
    storage[0].userManagerUnitName !== storage[1].userManagerUnitName ||
    !sameJson(storage[0].userManagerBindsTo, storage[1].userManagerBindsTo) ||
    !sameJson(storage[0].userManagerAfter, storage[1].userManagerAfter)
  ) {
    throw new Error(
      `${path}.storage must assert one request-bound runtime account and identical effective user-manager dependencies.`,
    );
  }
  const retainedMountUnits = storage.map((identity) => identity.mountUnitName);
  if (
    storage.some((identity) =>
      [...identity.userManagerBindsTo, ...identity.userManagerAfter].some(
        (unitName) => retainedMountUnits.includes(unitName),
      ),
    )
  ) {
    throw new Error(
      `${path}.storage effective user-manager dependencies must not name either removed retained mount unit.`,
    );
  }
  const normalized = {
    schemaVersion: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_KIND,
    requestId: receipt.requestId,
    destroyOperationId: receipt.destroyOperationId,
    service,
    storage,
  };
  assertManifestIsSecretFree(normalized, path);
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/** @param {Readonly<Record<string, any>>} receipt @param {Readonly<Record<string, any>>} request @param {string} path @returns {void} */
function assertReceiptMatchesRequest(receipt, request, path) {
  if (
    receipt.requestId !== request.requestId ||
    receipt.destroyOperationId !== request.destroyOperationId
  ) {
    throw new Error(`${path} does not match its exact deactivation request.`);
  }
  for (const key of REQUEST_SERVICE_KEYS) {
    if (receipt.service[key] !== request.service[key]) {
      throw new Error(`${path}.service.${key} does not match its request.`);
    }
  }
  for (let index = 0; index < request.storage.length; index += 1) {
    validateRequestStorageProjection(
      request,
      request.storage[index],
      index,
      `${path}.request.storage[${index}]`,
    );
    if (
      receipt.storage[index].runtimeUid !== request.runtimeAccount.uid ||
      receipt.storage[index].runtimeGid !== request.runtimeAccount.gid
    ) {
      throw new Error(
        `${path}.storage[${index}] runtime account does not match its request.`,
      );
    }
    for (const key of STORAGE_IDENTITY_KEYS) {
      if (receipt.storage[index][key] !== request.storage[index][key]) {
        throw new Error(
          `${path}.storage[${index}].${key} does not match its request.`,
        );
      }
    }
  }
}

/** @param {unknown} value @param {string} path @returns {{request: Readonly<Record<string, any>>, payload: Readonly<Record<string, any>>}} */
function deriveReceipt(value, path) {
  const input = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_CONTEXT_MAX_BYTES,
    path,
  );
  assertExactKeys(input, RECEIPT_CREATE_KEYS, path);
  const request = validateAwsSingleNodeHostDeactivationRequest(
    input.request,
    `${path}.request`,
  );
  const payload = validateReceiptPayload(
    {
      schemaVersion: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_KIND,
      requestId: request.requestId,
      destroyOperationId: request.destroyOperationId,
      service: input.service,
      storage: input.storage,
    },
    'awsSingleNodeHostDeactivationReceipt',
  );
  assertReceiptMatchesRequest(payload, request, path);
  return deepFreeze({ request, payload });
}

/** @param {Readonly<Record<string, any>>} payload @returns {Readonly<Record<string, any>>} */
function createReceiptFromPayload(payload) {
  const receiptId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath: 'awsSingleNodeHostDeactivationReceipt',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, receiptId }));
}

/**
 * Normalize one trusted-host success assertion into a content-addressed pure
 * document. Its exact schema proves only what the caller asserted: service
 * absence plus synced, unmounted, projection-absent retained storage. It is
 * not host observation or provenance and is not controller authority without
 * the strengthened context validator and a future authenticated closed host
 * execution/readback boundary.
 * @param {unknown} value - Request-bound service and storage assertions.
 * @returns {Readonly<Record<string, any>>} - Canonical receipt.
 */
export function createAwsSingleNodeHostDeactivationReceipt(value) {
  return createReceiptFromPayload(
    deriveReceipt(value, 'awsSingleNodeHostDeactivationReceiptContext').payload,
  );
}

/**
 * Validate, reidentify, and freeze one serialized trusted-host assertion.
 * This remains normalization, not authenticated host provenance.
 * @param {unknown} value - Candidate receipt.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical receipt.
 */
export function validateAwsSingleNodeHostDeactivationReceipt(
  value,
  valuePath = 'awsSingleNodeHostDeactivationReceipt',
) {
  const document = cloneDocument(value, valuePath);
  assertExactKeys(document, RECEIPT_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.receiptId,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX,
    `${valuePath}.receiptId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of RECEIPT_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validateReceiptPayload(payloadInput, valuePath);
  const receiptId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.receiptId !== receiptId) {
    throw new Error(
      `${valuePath}.receiptId does not match its exact deactivation receipt.`,
    );
  }
  return deepFreeze(sortCanonicalJsonValue({ ...payload, receiptId }));
}

/**
 * Bind a terminal assertion to the exact request-creation authority and an
 * equal-or-later still-running, all-pending destroy head. This is necessary
 * controller authority validation, but it does not authenticate who produced
 * the host assertion; a controller must not accept the result until a closed
 * authenticated host execution/readback boundary supplies that assertion.
 * @param {unknown} value - Candidate receipt.
 * @param {unknown} context - Exact request, request context, and current head.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Context-bound receipt.
 */
export function validateAwsSingleNodeHostDeactivationReceiptContext(
  value,
  context,
  valuePath = 'awsSingleNodeHostDeactivationReceipt',
) {
  const receipt = validateAwsSingleNodeHostDeactivationReceipt(
    value,
    valuePath,
  );
  const input = cloneBoundedJsonObject(
    context,
    AWS_SINGLE_NODE_HOST_DEACTIVATION_CONTEXT_MAX_BYTES,
    `${valuePath}.context`,
  );
  assertExactKeys(input, RECEIPT_CONTEXT_KEYS, `${valuePath}.context`);
  const request = validateAwsSingleNodeHostDeactivationRequestContext(
    input.request,
    input.requestContext,
    `${valuePath}.context.request`,
  );
  const requestAuthority = deriveRequestAuthority(
    input.requestContext,
    `${valuePath}.context.requestContext`,
  );
  const currentAuthority = deriveRequestAuthority(
    {
      ...input.requestContext,
      head: input.currentHead,
    },
    `${valuePath}.context.currentAuthority`,
  );
  const currentHead = currentAuthority.head;
  if (
    currentHead.generation < request.authorizedHeadGeneration ||
    (currentHead.generation === request.authorizedHeadGeneration &&
      currentHead.headId !== request.authorizedHeadId) ||
    currentAuthority.plan.planId !== request.destroyPlanId ||
    currentAuthority.activeOperation.operationId !==
      request.destroyOperationId ||
    currentAuthority.lastOperation.operationId !==
      request.lastSettledOperationId ||
    !sameJson(
      currentAuthority.head.resourceBindings,
      requestAuthority.head.resourceBindings,
    ) ||
    !sameJson(
      currentAuthority.activeOperation,
      requestAuthority.activeOperation,
    ) ||
    !sameJson(currentAuthority.lastOperation, requestAuthority.lastOperation)
  ) {
    throw new Error(
      `${valuePath}.context.currentHead is not an equal-or-later live successor of the request authority.`,
    );
  }
  assertReceiptMatchesRequest(receipt, request, valuePath);
  return receipt;
}

export default {
  AWS_SINGLE_NODE_HOST_DEACTIVATION_CONTEXT_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_DOCUMENT_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_CONFIG_ROOT,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_SCHEMA_VERSION,
  createAwsSingleNodeHostDeactivationReceipt,
  createAwsSingleNodeHostDeactivationRequest,
  validateAwsSingleNodeHostDeactivationReceipt,
  validateAwsSingleNodeHostDeactivationReceiptContext,
  validateAwsSingleNodeHostDeactivationRequest,
  validateAwsSingleNodeHostDeactivationRequestContext,
};
