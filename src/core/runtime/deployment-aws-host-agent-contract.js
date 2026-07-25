/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable host-boundary contracts are clearer than repeated parser-specific expansions. */

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { getBuildTargetId, validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
} from './deployment-artifact-stage.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from './deployment-aws-desired-resource-targets.js';
import { validateAwsSingleNodeManagedArtifactHeadEvidence } from './deployment-aws-managed-artifact-evidence.js';
import {
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import {
  assertAwsEc2InstanceId,
  assertAwsIamRoleId,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeRoleName,
} from './deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
} from './deployment-aws-volume-attachment-evidence.js';
import {
  assertDeploymentHeadId,
  assertDeploymentOperationId,
  validateDeploymentHead,
} from './deployment-head.js';
import {
  DEPLOYMENT_PLAN_ID_PREFIX,
  validateDeploymentPlanContext,
} from './deployment-plan.js';
import {
  DEPLOYMENT_PROFILE_ID_PREFIX,
  validateDeploymentProfile,
} from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
  assertDeploymentIncarnationId,
} from './deployment-resource-binding.js';
import { DEPLOYMENT_REVISION_ID_PREFIX } from './deployment-revision.js';
import {
  validateDeploymentServiceHealthReceipt,
  validateDeploymentServiceHealthReceiptContext,
} from './deployment-service-health.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND =
  'awsSingleNodeHostActivationRequest';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN =
  'wharfie:aws-single-node-host-activation-request:v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX = 'whaq1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND =
  'awsSingleNodeHostActivationReceipt';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN =
  'wharfie:aws-single-node-host-activation-receipt:v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX = 'whar1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_DOCUMENT_MAX_BYTES = 64 * 1024;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_CONTEXT_MAX_BYTES = 512 * 1024;

const REQUEST_CONTEXT_KEYS = new Set([
  'plan',
  'settledPlan',
  'profile',
  'head',
  'managedArtifact',
]);
const REQUEST_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerScope',
  'providerSpecId',
  'deploymentInstanceId',
  'incarnationId',
  'planId',
  'deploymentOperationId',
  'authorizedHeadId',
  'authorizedHeadGeneration',
  'deploymentRevisionId',
  'profileRevisionId',
  'appId',
  'artifactId',
  'revisionId',
  'target',
  'targetId',
  'nodeBindingId',
  'nodeProviderResourceId',
  'runtimeRoleBindingId',
  'runtimeRoleId',
  'runtimeRoleName',
  'artifact',
  'volumes',
]);
const REQUEST_DOCUMENT_KEYS = new Set(['requestId', ...REQUEST_PAYLOAD_KEYS]);
const ARTIFACT_KEYS = new Set([
  'bindingId',
  'providerResourceId',
  'bucketName',
  'key',
  'versionId',
  'etag',
  'contentLength',
  'byteDigest',
  'stateDigest',
  'stageIntentId',
  'stageReceiptId',
]);
const VOLUME_KEYS = new Set([
  'capabilityKind',
  'volumeBindingId',
  'volumeProviderResourceId',
  'attachmentBindingId',
  'attachmentProviderResourceId',
  'requestedDeviceName',
]);
const RECEIPT_CREATE_KEYS = new Set(['request', 'serviceHealthReceipt']);
const RECEIPT_CONTEXT_KEYS = new Set([
  'request',
  'requestContext',
  'currentHead',
]);
const RECEIPT_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'requestId',
  'artifactVersionId',
  'serviceHealthReceipt',
]);
const RECEIPT_DOCUMENT_KEYS = new Set(['receiptId', ...RECEIPT_PAYLOAD_KEYS]);
const VOLUME_CONTRACTS = Object.freeze([
  Object.freeze({
    capabilityKind: 'application-state',
    attachmentResourceKey: 'application-state-attachment',
    requestedDeviceName: '/dev/sdf',
  }),
  Object.freeze({
    capabilityKind: 'control-state',
    attachmentResourceKey: 'control-state-attachment',
    requestedDeviceName: '/dev/sdg',
  }),
]);
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;

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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
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
    AWS_SINGLE_NODE_HOST_ACTIVATION_DOCUMENT_MAX_BYTES,
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

/** @param {string} value @returns {boolean} */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** @param {unknown} value @param {string} path @returns {string} */
function validateOpaqueVersionId(value, path) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value === 'null' ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, 'utf8') > 1024
  ) {
    throw new TypeError(
      `${path} must be a nonempty, non-'null', well-formed opaque Unicode version ID no longer than 1024 UTF-8 bytes.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} path @returns {string} */
function validateOpaqueEtag(value, path) {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value[0] !== '"' ||
    value[value.length - 1] !== '"' ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, 'utf8') > 1024
  ) {
    throw new TypeError(`${path} must be a valid opaque S3 ETag.`);
  }
  const opaque = value.slice(1, -1);
  if (opaque === '*') {
    throw new TypeError(`${path} must be a valid opaque S3 ETag.`);
  }
  for (const character of opaque) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint > 0xff ||
      character === '"' ||
      character === ','
    ) {
      throw new TypeError(`${path} must be a valid opaque S3 ETag.`);
    }
  }
  return value;
}

/** @param {unknown} value @param {string} path @returns {string} */
function validateVolumeId(value, path) {
  if (typeof value !== 'string' || !VOLUME_ID_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a canonical AWS EBS volume ID.`);
  }
  return value;
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateRequestArtifact(value, path) {
  const artifact = cloneDocument(value, path);
  assertAllKeys(artifact, ARTIFACT_KEYS, path);
  assertDomainSeparatedSha256Id(
    artifact.bindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.bindingId`,
  );
  if (
    typeof artifact.providerResourceId !== 'string' ||
    artifact.providerResourceId.length === 0
  ) {
    throw new TypeError(`${path}.providerResourceId must be nonempty.`);
  }
  if (
    typeof artifact.bucketName !== 'string' ||
    artifact.bucketName.length === 0
  ) {
    throw new TypeError(`${path}.bucketName must be nonempty.`);
  }
  if (typeof artifact.key !== 'string' || artifact.key.length === 0) {
    throw new TypeError(`${path}.key must be nonempty.`);
  }
  const versionId = validateOpaqueVersionId(
    artifact.versionId,
    `${path}.versionId`,
  );
  const etag = validateOpaqueEtag(artifact.etag, `${path}.etag`);
  if (
    !Number.isSafeInteger(artifact.contentLength) ||
    artifact.contentLength < 0 ||
    artifact.contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES
  ) {
    throw new TypeError(
      `${path}.contentLength must be a nonnegative safe integer no larger than ${DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES}.`,
    );
  }
  const byteDigest = validateSha256Digest(
    artifact.byteDigest,
    `${path}.byteDigest`,
  );
  const stateDigest = validateSha256Digest(
    artifact.stateDigest,
    `${path}.stateDigest`,
  );
  assertDomainSeparatedSha256Id(
    artifact.stageIntentId,
    DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
    `${path}.stageIntentId`,
  );
  assertDomainSeparatedSha256Id(
    artifact.stageReceiptId,
    DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
    `${path}.stageReceiptId`,
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      bindingId: artifact.bindingId,
      providerResourceId: artifact.providerResourceId,
      bucketName: artifact.bucketName,
      key: artifact.key,
      versionId,
      etag,
      contentLength: artifact.contentLength,
      byteDigest,
      stateDigest,
      stageIntentId: artifact.stageIntentId,
      stageReceiptId: artifact.stageReceiptId,
    }),
  );
}

/** @param {unknown} value @param {number} index @param {string} path @returns {Readonly<Record<string, any>>} */
function validateRequestVolume(value, index, path) {
  const volume = cloneDocument(value, path);
  assertAllKeys(volume, VOLUME_KEYS, path);
  const contract = VOLUME_CONTRACTS[index];
  if (
    contract === undefined ||
    volume.capabilityKind !== contract.capabilityKind
  ) {
    throw new TypeError(
      `${path}.capabilityKind must be the canonical volume capability at index ${index}.`,
    );
  }
  assertDomainSeparatedSha256Id(
    volume.volumeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.volumeBindingId`,
  );
  const volumeProviderResourceId = validateVolumeId(
    volume.volumeProviderResourceId,
    `${path}.volumeProviderResourceId`,
  );
  assertDomainSeparatedSha256Id(
    volume.attachmentBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.attachmentBindingId`,
  );
  assertDomainSeparatedSha256Id(
    volume.attachmentProviderResourceId,
    AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    `${path}.attachmentProviderResourceId`,
  );
  if (volume.requestedDeviceName !== contract.requestedDeviceName) {
    throw new TypeError(
      `${path}.requestedDeviceName must be '${contract.requestedDeviceName}'.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      capabilityKind: contract.capabilityKind,
      volumeBindingId: volume.volumeBindingId,
      volumeProviderResourceId,
      attachmentBindingId: volume.attachmentBindingId,
      attachmentProviderResourceId: volume.attachmentProviderResourceId,
      requestedDeviceName: contract.requestedDeviceName,
    }),
  );
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateRequestPayload(value, path) {
  const request = cloneDocument(value, path);
  assertAllKeys(request, REQUEST_PAYLOAD_KEYS, path);
  if (
    request.schemaVersion !==
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION
  ) {
    throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
  }
  if (request.kind !== AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND}'.`,
    );
  }
  const providerScope = validateProviderScope(
    request.providerScope,
    `${path}.providerScope`,
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
    request.planId,
    DEPLOYMENT_PLAN_ID_PREFIX,
    `${path}.planId`,
  );
  assertDeploymentOperationId(
    request.deploymentOperationId,
    `${path}.deploymentOperationId`,
  );
  assertDeploymentHeadId(request.authorizedHeadId, `${path}.authorizedHeadId`);
  const authorizedHeadGeneration = positiveSafeInteger(
    request.authorizedHeadGeneration,
    `${path}.authorizedHeadGeneration`,
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
  const target = validateBuildTarget(request.target, `${path}.target`);
  const targetId = getBuildTargetId(target, `${path}.target`);
  if (request.targetId !== targetId) {
    throw new Error(`${path}.targetId does not match its exact target.`);
  }
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
  const expectedRuntimeRoleName = getAwsSingleNodeRuntimeRoleName({
    providerScopeId: providerScope.providerScopeId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
  });
  if (request.runtimeRoleName !== expectedRuntimeRoleName) {
    throw new Error(
      `${path}.runtimeRoleName does not match its exact deployment authority.`,
    );
  }
  const artifact = validateRequestArtifact(
    request.artifact,
    `${path}.artifact`,
  );
  const artifactLocation = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
  });
  if (
    artifact.providerResourceId !== artifactLocation.arn ||
    artifact.bucketName !== artifactLocation.bucketName ||
    artifact.key !== artifactLocation.key
  ) {
    throw new Error(
      `${path}.artifact does not match its deterministic managed object location.`,
    );
  }
  if (
    request.artifactId !== `waf1_${artifact.byteDigest.value}` ||
    artifact.contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES
  ) {
    throw new Error(
      `${path}.artifact does not match the exact requested artifact bytes.`,
    );
  }
  if (
    !Array.isArray(request.volumes) ||
    request.volumes.length !== VOLUME_CONTRACTS.length
  ) {
    throw new TypeError(
      `${path}.volumes must contain the exact application-state and control-state volume contracts.`,
    );
  }
  const volumes = request.volumes.map((volume, index) =>
    validateRequestVolume(volume, index, `${path}.volumes[${index}]`),
  );
  const normalized = {
    schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND,
    providerScope,
    providerSpecId: request.providerSpecId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
    planId: request.planId,
    deploymentOperationId: request.deploymentOperationId,
    authorizedHeadId: request.authorizedHeadId,
    authorizedHeadGeneration,
    deploymentRevisionId: request.deploymentRevisionId,
    profileRevisionId: request.profileRevisionId,
    appId: request.appId,
    artifactId: request.artifactId,
    revisionId: request.revisionId,
    target,
    targetId,
    nodeBindingId: request.nodeBindingId,
    nodeProviderResourceId: request.nodeProviderResourceId,
    runtimeRoleBindingId: request.runtimeRoleBindingId,
    runtimeRoleId: request.runtimeRoleId,
    runtimeRoleName: request.runtimeRoleName,
    artifact,
    volumes,
  };
  assertManifestIsSecretFree(
    {
      ...normalized,
      artifact: {
        ...normalized.artifact,
        versionId: 'opaque-provider-version-id',
        etag: '"opaque-provider-etag"',
      },
    },
    path,
  );
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function deriveRequestAuthority(value, path) {
  const input = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_CONTEXT_MAX_BYTES,
    path,
  );
  assertAllKeys(input, REQUEST_CONTEXT_KEYS, path);
  const profile = validateDeploymentProfile(input.profile, `${path}.profile`);
  const plan = validateDeploymentPlanContext(input.plan, { profile });
  const providerScope = validateProviderScope(
    plan.providerScope,
    `${path}.plan.providerScope`,
  );
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope },
  );
  const head = validateDeploymentHead(input.head, `${path}.head`);
  if (
    plan.operation === 'destroy' ||
    head.phase !== 'CONVERGING' ||
    head.activeOperation === null ||
    head.activeOperation.kind === 'destroy' ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.nextActionIndex !== plan.actions.length ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (/** @type {Readonly<Record<string, any>>} */ intent) =>
        intent.status !== 'settled',
    ) ||
    head.targetDeploymentRevisionId !==
      plan.deploymentRevision.deploymentRevisionId
  ) {
    throw new Error(
      `${path} must name the exact all-settled frontier of one active non-destroy deployment operation.`,
    );
  }

  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: plan.deploymentRevision,
    profile,
    providerScope,
    providerSpec,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
    head,
  });
  const targetByKey = new Map(
    targets.map((target) => [target.resourceKey, target]),
  );
  /** @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
  function resourceAuthority(resourceKey) {
    const target = targetByKey.get(resourceKey);
    if (target === undefined) {
      throw new Error(`${path} lacks desired target '${resourceKey}'.`);
    }
    const authority = createAwsSingleNodeResourceObservationAuthority({
      operation: plan.operation,
      deploymentRevision: plan.deploymentRevision,
      profile,
      providerScope,
      providerSpec,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      head,
      plan,
      settledPlan: input.settledPlan,
      target,
    });
    if (authority.binding === null) {
      throw new Error(`${path} lacks settled binding '${resourceKey}'.`);
    }
    return authority;
  }

  const artifactAuthority = resourceAuthority('artifact');
  const nodeAuthority = resourceAuthority('substrate');
  const runtimeRoleAuthority = resourceAuthority('runtime-role');
  const volumeAuthorities = VOLUME_CONTRACTS.map((contract) => ({
    contract,
    volume: resourceAuthority(contract.capabilityKind),
    attachment: resourceAuthority(contract.attachmentResourceKey),
  }));
  const artifactBinding = artifactAuthority.binding;
  const managedArtifact = validateAwsSingleNodeManagedArtifactHeadEvidence(
    input.managedArtifact,
    {
      providerScope,
      artifactStorage: providerSpec.capabilities.artifactStorage,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      createdByActionId: artifactBinding.createdByActionId,
      ownershipNonce: artifactBinding.ownershipNonce,
      appId: plan.deploymentRevision.appId,
    },
  );
  if (
    managedArtifact.deploymentRevisionId !==
      plan.deploymentRevision.deploymentRevisionId ||
    managedArtifact.artifactId !== plan.deploymentRevision.artifactId ||
    managedArtifact.revisionId !== plan.deploymentRevision.revisionId ||
    !sameJson(
      managedArtifact.stateDigest,
      artifactAuthority.target.target.stateDigest,
    )
  ) {
    throw new Error(
      `${path}.managedArtifact does not match the exact desired deployment release.`,
    );
  }
  const artifactLocation = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  if (
    artifactBinding.providerResourceId !== artifactLocation.arn ||
    artifactAuthority.target.target.providerResourceId !== artifactLocation.arn
  ) {
    throw new Error(
      `${path} artifact binding does not match its deterministic managed object.`,
    );
  }

  const volumes = volumeAuthorities.map(({ contract, volume, attachment }) => {
    const volumeBinding = volume.binding;
    const attachmentBinding = attachment.binding;
    const requestedDeviceName =
      providerSpec.capabilities[
        contract.capabilityKind === 'application-state'
          ? 'applicationState'
          : 'controlState'
      ].deviceName;
    const expectedAttachmentId =
      getAwsSingleNodeVolumeAttachmentProviderResourceId(
        providerSpec,
        contract.capabilityKind,
        nodeAuthority.binding.providerResourceId,
        volumeBinding.providerResourceId,
      );
    const dependencyByKey = new Map(
      attachmentBinding.dependencyBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ dependency) => [
          dependency.resourceKey,
          dependency.bindingId,
        ],
      ),
    );
    if (
      requestedDeviceName !== contract.requestedDeviceName ||
      attachmentBinding.providerResourceId !== expectedAttachmentId ||
      dependencyByKey.get('substrate') !== nodeAuthority.binding.bindingId ||
      dependencyByKey.get(contract.capabilityKind) !== volumeBinding.bindingId
    ) {
      throw new Error(
        `${path} ${contract.capabilityKind} attachment does not bind the exact node, volume, and provider contract.`,
      );
    }
    return {
      capabilityKind: contract.capabilityKind,
      volumeBindingId: volumeBinding.bindingId,
      volumeProviderResourceId: volumeBinding.providerResourceId,
      attachmentBindingId: attachmentBinding.bindingId,
      attachmentProviderResourceId: attachmentBinding.providerResourceId,
      requestedDeviceName,
    };
  });

  return deepFreeze({
    plan,
    profile,
    providerScope,
    providerSpec,
    head,
    settledPlan: input.settledPlan,
    managedArtifact,
    artifactBinding,
    artifactLocation,
    nodeBinding: nodeAuthority.binding,
    runtimeRoleBinding: runtimeRoleAuthority.binding,
    volumes,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function createRequestFromAuthority(authority) {
  const { plan, profile, providerScope, providerSpec, head, managedArtifact } =
    authority;
  const byteDigest = validateSha256Digest(
    {
      algorithm: 'sha256',
      value: plan.deploymentRevision.artifactId.slice('waf1_'.length),
    },
    'awsSingleNodeHostActivationRequest.artifact.byteDigest',
  );
  const payload = validateRequestPayload(
    {
      schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND,
      providerScope,
      providerSpecId: providerSpec.providerSpecId,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      planId: plan.planId,
      deploymentOperationId: head.activeOperation.operationId,
      authorizedHeadId: head.headId,
      authorizedHeadGeneration: head.generation,
      deploymentRevisionId: plan.deploymentRevision.deploymentRevisionId,
      profileRevisionId: profile.profileRevisionId,
      appId: plan.deploymentRevision.appId,
      artifactId: plan.deploymentRevision.artifactId,
      revisionId: plan.deploymentRevision.revisionId,
      target: profile.target,
      targetId: getBuildTargetId(profile.target),
      nodeBindingId: authority.nodeBinding.bindingId,
      nodeProviderResourceId: authority.nodeBinding.providerResourceId,
      runtimeRoleBindingId: authority.runtimeRoleBinding.bindingId,
      runtimeRoleId: authority.runtimeRoleBinding.providerResourceId,
      runtimeRoleName: getAwsSingleNodeRuntimeRoleName({
        providerScopeId: providerScope.providerScopeId,
        deploymentInstanceId: plan.deploymentInstanceId,
        incarnationId: plan.incarnationId,
      }),
      artifact: {
        bindingId: authority.artifactBinding.bindingId,
        providerResourceId: authority.artifactBinding.providerResourceId,
        bucketName: authority.artifactLocation.bucketName,
        key: authority.artifactLocation.key,
        versionId: managedArtifact.versionId,
        etag: managedArtifact.etag,
        contentLength: managedArtifact.contentLength,
        byteDigest,
        stateDigest: managedArtifact.stateDigest,
        stageIntentId: managedArtifact.stageIntentId,
        stageReceiptId: managedArtifact.stageReceiptId,
      },
      volumes: authority.volumes,
    },
    'awsSingleNodeHostActivationRequest',
  );
  const requestId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    value: payload,
    valuePath: 'awsSingleNodeHostActivationRequest',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, requestId }));
}

/**
 * Create one exact, secret-free request for a framework-owned host agent.
 * The active deployment graph has reached its all-settled frontier; no
 * unrelated graph action is repurposed as host-activation authority. This
 * pure boundary revalidates a decoded managed-artifact projection but cannot
 * establish provider freshness; its controller caller must own the exact S3
 * read and decoder invocation.
 * @param {unknown} value - Exact settled plan/head and managed artifact evidence.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
export function createAwsSingleNodeHostActivationRequest(value) {
  return createRequestFromAuthority(
    deriveRequestAuthority(value, 'awsSingleNodeHostActivationRequestContext'),
  );
}

/**
 * Validate, reidentify, and freeze one serialized activation request.
 * @param {unknown} value - Candidate request.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
export function validateAwsSingleNodeHostActivationRequest(
  value,
  valuePath = 'awsSingleNodeHostActivationRequest',
) {
  const document = cloneDocument(value, valuePath);
  assertAllKeys(document, REQUEST_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.requestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    `${valuePath}.requestId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of REQUEST_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validateRequestPayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.requestId !== expectedId) {
    throw new Error(
      `${valuePath}.requestId does not match its exact activation request.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, requestId: expectedId }),
  );
}

/**
 * Require a serialized request to equal the one derivable from exact current
 * settled deployment authority and exact provider artifact evidence.
 * @param {unknown} value - Candidate request.
 * @param {unknown} context - Exact request-creation context.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Context-bound request.
 */
export function validateAwsSingleNodeHostActivationRequestContext(
  value,
  context,
  valuePath = 'awsSingleNodeHostActivationRequest',
) {
  const request = validateAwsSingleNodeHostActivationRequest(value, valuePath);
  const expected = createRequestFromAuthority(
    deriveRequestAuthority(context, `${valuePath}.context`),
  );
  if (!sameJson(request, expected)) {
    throw new Error(`${valuePath} does not match its exact context.`);
  }
  return request;
}

/** @param {Readonly<Record<string, any>>} receipt @param {Readonly<Record<string, any>>} request @param {string} path @returns {void} */
function assertReceiptMatchesRequest(receipt, request, path) {
  const health = receipt.serviceHealthReceipt;
  /** @type {Array<[string, unknown, unknown]>} */
  const matches = [
    ['requestId', receipt.requestId, request.requestId],
    [
      'artifactVersionId',
      receipt.artifactVersionId,
      request.artifact.versionId,
    ],
    [
      'providerScopeId',
      health.providerScopeId,
      request.providerScope.providerScopeId,
    ],
    ['providerSpecId', health.providerSpecId, request.providerSpecId],
    [
      'deploymentInstanceId',
      health.deploymentInstanceId,
      request.deploymentInstanceId,
    ],
    ['incarnationId', health.incarnationId, request.incarnationId],
    [
      'deploymentOperationId',
      health.deploymentOperationId,
      request.deploymentOperationId,
    ],
    ['authorizedHeadId', health.authorizedHeadId, request.authorizedHeadId],
    [
      'authorizedHeadGeneration',
      health.authorizedHeadGeneration,
      request.authorizedHeadGeneration,
    ],
    ['nodeBindingId', health.nodeBindingId, request.nodeBindingId],
    [
      'nodeProviderResourceId',
      health.nodeProviderResourceId,
      request.nodeProviderResourceId,
    ],
    [
      'runtimeRoleBindingId',
      health.runtimeRoleBindingId,
      request.runtimeRoleBindingId,
    ],
    ['runtimeRoleId', health.runtimeRoleId, request.runtimeRoleId],
    [
      'deploymentRevisionId',
      health.deploymentRevisionId,
      request.deploymentRevisionId,
    ],
    ['appId', health.appId, request.appId],
    ['artifactId', health.artifactId, request.artifactId],
    ['revisionId', health.revisionId, request.revisionId],
  ];
  for (const [field, actual, expected] of matches) {
    if (actual !== expected) {
      throw new Error(`${path}.${field} does not match its exact request.`);
    }
  }
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateReceiptPayload(value, path) {
  const receipt = cloneDocument(value, path);
  assertAllKeys(receipt, RECEIPT_PAYLOAD_KEYS, path);
  if (
    receipt.schemaVersion !==
    AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION
  ) {
    throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
  }
  if (receipt.kind !== AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    receipt.requestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    `${path}.requestId`,
  );
  const artifactVersionId = validateOpaqueVersionId(
    receipt.artifactVersionId,
    `${path}.artifactVersionId`,
  );
  const serviceHealthReceipt = validateDeploymentServiceHealthReceipt(
    receipt.serviceHealthReceipt,
    `${path}.serviceHealthReceipt`,
  );
  const normalized = {
    schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND,
    requestId: receipt.requestId,
    artifactVersionId,
    serviceHealthReceipt,
  };
  assertManifestIsSecretFree(
    {
      ...normalized,
      artifactVersionId: 'opaque-provider-version-id',
    },
    path,
  );
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/**
 * Create one success-only activation receipt. A receipt is minted only after
 * the trusted durable host kernel has independently settled the request and
 * can publish validated durable service health. This pure factory proves
 * document consistency; it is not itself storage, process, or provider
 * observation authority.
 * @param {unknown} value - Exact request and health receipt.
 * @returns {Readonly<Record<string, any>>} - Canonical receipt.
 */
export function createAwsSingleNodeHostActivationReceipt(value) {
  const input = cloneDocument(value, 'awsSingleNodeHostActivationReceipt');
  assertAllKeys(
    input,
    RECEIPT_CREATE_KEYS,
    'awsSingleNodeHostActivationReceipt',
  );
  const request = validateAwsSingleNodeHostActivationRequest(
    input.request,
    'awsSingleNodeHostActivationReceipt.request',
  );
  const payload = validateReceiptPayload(
    {
      schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND,
      requestId: request.requestId,
      artifactVersionId: request.artifact.versionId,
      serviceHealthReceipt: input.serviceHealthReceipt,
    },
    'awsSingleNodeHostActivationReceipt',
  );
  assertReceiptMatchesRequest(
    payload,
    request,
    'awsSingleNodeHostActivationReceipt',
  );
  const receiptId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath: 'awsSingleNodeHostActivationReceipt',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, receiptId }));
}

/**
 * Validate, reidentify, and freeze one serialized activation receipt.
 * @param {unknown} value - Candidate receipt.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical receipt.
 */
export function validateAwsSingleNodeHostActivationReceipt(
  value,
  valuePath = 'awsSingleNodeHostActivationReceipt',
) {
  const document = cloneDocument(value, valuePath);
  assertAllKeys(document, RECEIPT_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.receiptId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
    `${valuePath}.receiptId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of RECEIPT_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validateReceiptPayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.receiptId !== expectedId) {
    throw new Error(
      `${valuePath}.receiptId does not match its exact activation settlement.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, receiptId: expectedId }),
  );
}

/**
 * Cross-check an activation receipt with its exact original request authority
 * and a current head. The current head may be the READY successor that retained
 * the request's active operation as its last settled operation.
 * @param {unknown} value - Candidate receipt.
 * @param {unknown} context - Exact request, original request context, and current head.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Context-bound receipt.
 */
export function validateAwsSingleNodeHostActivationReceiptContext(
  value,
  context,
  valuePath = 'awsSingleNodeHostActivationReceipt',
) {
  const receipt = validateAwsSingleNodeHostActivationReceipt(value, valuePath);
  const trusted = cloneBoundedJsonObject(
    context,
    AWS_SINGLE_NODE_HOST_ACTIVATION_CONTEXT_MAX_BYTES,
    `${valuePath}.context`,
  );
  assertAllKeys(trusted, RECEIPT_CONTEXT_KEYS, `${valuePath}.context`);
  const request = validateAwsSingleNodeHostActivationRequestContext(
    trusted.request,
    trusted.requestContext,
    `${valuePath}.context.request`,
  );
  const authority = deriveRequestAuthority(
    trusted.requestContext,
    `${valuePath}.context.requestContext`,
  );
  assertReceiptMatchesRequest(receipt, request, valuePath);
  validateDeploymentServiceHealthReceiptContext(
    receipt.serviceHealthReceipt,
    {
      deploymentRevision: authority.plan.deploymentRevision,
      profile: authority.profile,
      providerScope: authority.providerScope,
      providerSpec: authority.providerSpec,
      head: trusted.currentHead,
    },
    `${valuePath}.serviceHealthReceipt`,
  );
  return receipt;
}

export default {
  AWS_SINGLE_NODE_HOST_ACTIVATION_CONTEXT_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_DOCUMENT_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION,
  createAwsSingleNodeHostActivationReceipt,
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationReceipt,
  validateAwsSingleNodeHostActivationReceiptContext,
  validateAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationRequestContext,
};
