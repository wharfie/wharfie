/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  sha256Base64Url,
} from './content-id.js';
import {
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
  getDeploymentArtifactStageObjectLocation,
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
} from './deployment-artifact-stage.js';
import {
  DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE,
  DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA,
} from './deployment-artifact-stager.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from './deployment-aws-runtime-identity-contract.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  DEPLOYMENT_REVISION_ID_PREFIX,
  validateDeploymentRevision,
} from './deployment-revision.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import {
  DEPLOYMENT_PROFILE_ID_PREFIX,
  validateDeploymentProfile,
} from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  assertDeploymentIncarnationId,
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { assertLogicalId } from './logical-id.js';

export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES = 16;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS = 16_000;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE = 1000;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-managed-artifact-state:v1';
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE =
  'application/octet-stream';
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL = 'no-store';
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA =
  'deployment-managed-artifact-v1';

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'copyObject',
  'headObject',
  'listObjectVersions',
  'deleteObjectVersion',
]);
const ACTION_CONTEXT_KEYS = new Set([
  'operation',
  'plan',
  'action',
  'actionIndex',
  'ownershipNonce',
  'head',
  'profile',
  'artifactStage',
]);
const STATE_AUTHORITY_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
]);
const ARTIFACT_STAGE_KEYS = new Set(['intent', 'receipt']);
const MANAGED_METADATA_KEYS = new Set([
  'wharfie-schema',
  'wharfie-managed-by',
  'wharfie-resource-kind',
  'wharfie-retention',
  'wharfie-capability',
  'wharfie-role',
  'wharfie-provider-scope-id',
  'wharfie-deployment-instance-id',
  'wharfie-incarnation-id',
  'wharfie-resource-key',
  'wharfie-created-by-action-id',
  'wharfie-ownership-nonce',
  'wharfie-state-digest',
  'wharfie-deployment-revision-id',
  'wharfie-profile-revision-id',
  'wharfie-app-id',
  'wharfie-revision-id',
  'wharfie-artifact-id',
  'wharfie-content-length',
  'wharfie-stage-intent-id',
  'wharfie-stage-receipt-id',
]);
const STAGE_METADATA_KEYS = new Set([
  'wharfie-schema',
  'wharfie-intent',
  'wharfie-nonce',
  'wharfie-artifact',
  'wharfie-digest',
]);

/** Exact controller authority or provider evidence is contradictory. */
export class AwsSingleNodeManagedArtifactResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node managed artifact resource conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeManagedArtifactResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeManagedArtifactResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node managed artifact resource state is unknown.');
    this.name = 'AwsSingleNodeManagedArtifactResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class ArtifactEvidenceConflictError extends Error {}
class ArtifactEvidenceTransientError extends Error {}

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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameStringMap(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        typeof left[key] === 'string' &&
        typeof right[key] === 'string' &&
        left[key] === right[key],
    )
  );
}

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {unknown} error @returns {boolean} */
function isCurrentObjectMissingError(error) {
  return errorNamed(error, 'NoSuchKey') || errorNamed(error, 'NotFound');
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
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

/** @param {unknown} value @returns {value is string} */
function isUsableVersionId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== 'null' &&
    isWellFormedUnicode(value) &&
    Buffer.byteLength(value, 'utf8') <= 1024
  );
}

/** @param {unknown} value @returns {value is string} */
function isUsableOpaqueEtag(value) {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value[0] !== '"' ||
    value[value.length - 1] !== '"' ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, 'utf8') > 1024
  ) {
    return false;
  }
  const opaque = value.slice(1, -1);
  if (opaque === '*') return false;
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
      return false;
    }
  }
  return true;
}

/** @param {unknown} value @returns {string} */
function decodeListedKey(value) {
  if (typeof value !== 'string' || !isWellFormedUnicode(value)) {
    throw new ProviderResponseUnknownError();
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ProviderResponseUnknownError();
  }
  if (!isWellFormedUnicode(decoded)) throw new ProviderResponseUnknownError();
  return decoded;
}

/** @param {string} artifactId @returns {string} */
function artifactChecksumBase64(artifactId) {
  assertArtifactId(artifactId, 'managedArtifact artifactId');
  return Buffer.from(artifactId.slice('waf1_'.length), 'base64url').toString(
    'base64',
  );
}

/** @param {unknown} value @returns {number} */
function parseCanonicalContentLength(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new ArtifactEvidenceConflictError();
  }
  const contentLength = Number(value);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES ||
    String(contentLength) !== value
  ) {
    throw new ArtifactEvidenceConflictError();
  }
  return contentLength;
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} deploymentInstanceId @param {string} incarnationId @param {{deploymentRevisionId: string, profileRevisionId: string, appId: string, revisionId: string, artifactId: string}} artifact @param {Readonly<Record<string, any>>} artifactStorage @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function stateDigestFromReferences(
  providerScope,
  deploymentInstanceId,
  incarnationId,
  artifact,
  artifactStorage,
) {
  const location = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope,
    deploymentInstanceId,
    incarnationId,
  });
  const source = getDeploymentArtifactStageObjectLocation(
    providerScope,
    artifact.artifactId,
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeManagedArtifactState',
    location,
    source,
    artifact: {
      deploymentRevisionId: artifact.deploymentRevisionId,
      profileRevisionId: artifact.profileRevisionId,
      appId: artifact.appId,
      revisionId: artifact.revisionId,
      artifactId: artifact.artifactId,
      checksumAlgorithm: 'SHA256',
      checksum: artifact.artifactId.slice('waf1_'.length),
    },
    object: {
      storage: artifactStorage.storage,
      encryption: artifactStorage.encryption,
      storageClass: 'STANDARD',
      contentType: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
      cacheControl: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
      metadataSchema: AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
      onDestroy: artifactStorage.onDestroy,
    },
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive the exact plan-time state of the managed current object. Provider
 * version IDs, ETags, byte length, stage receipts, action IDs and ownership
 * nonces are intentionally excluded because none exists when a fresh plan is
 * created. The artifact ID already commits the complete byte digest.
 * @param {unknown} value - Complete deterministic deployment authority.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - Exact desired state digest.
 */
export function getAwsSingleNodeManagedArtifactStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact state must be an object.',
    );
  }
  assertExactKeys(
    value,
    STATE_AUTHORITY_KEYS,
    'awsSingleNodeManagedArtifact state',
  );
  const deploymentRevision = validateDeploymentRevision(
    value.deploymentRevision,
    'awsSingleNodeManagedArtifact state.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeManagedArtifact state.profile',
  );
  const providerScope = validateProviderScope(
    value.providerScope,
    'awsSingleNodeManagedArtifact state.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    value.providerSpec,
    { profile, providerScope },
  );
  assertDeploymentInstanceId(
    value.deploymentInstanceId,
    'awsSingleNodeManagedArtifact state.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    value.incarnationId,
    'awsSingleNodeManagedArtifact state.incarnationId',
  );
  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId ||
    value.deploymentInstanceId !==
      getDeploymentInstanceId({ deploymentRevision, providerScope })
  ) {
    throw new Error(
      'awsSingleNodeManagedArtifact state deployment revision, profile, scope, and instance identity do not match.',
    );
  }
  return stateDigestFromReferences(
    providerScope,
    value.deploymentInstanceId,
    value.incarnationId,
    deploymentRevision,
    providerSpec.capabilities.artifactStorage,
  );
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function managedMetadata(authority) {
  const stage = authority.artifactStage;
  return deepFreeze({
    'wharfie-schema': AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': authority.plan.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': authority.plan.deploymentInstanceId,
    'wharfie-incarnation-id': authority.plan.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id':
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    'wharfie-ownership-nonce': authority.ownershipNonce,
    'wharfie-state-digest': authority.stateDigest.value,
    'wharfie-deployment-revision-id':
      authority.plan.deploymentRevision.deploymentRevisionId,
    'wharfie-profile-revision-id':
      authority.plan.deploymentRevision.profileRevisionId,
    'wharfie-app-id': authority.plan.deploymentRevision.appId,
    'wharfie-revision-id': authority.plan.deploymentRevision.revisionId,
    'wharfie-artifact-id': authority.plan.deploymentRevision.artifactId,
    'wharfie-content-length': String(stage.receipt.object.contentLength),
    'wharfie-stage-intent-id': stage.intent.stageIntentId,
    'wharfie-stage-receipt-id': stage.receipt.stageReceiptId,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>} */
function validateArtifactStage(value, authority) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeManagedArtifactResourceConflictError();
  }
  try {
    assertExactKeys(
      value,
      ARTIFACT_STAGE_KEYS,
      'awsSingleNodeManagedArtifact artifactStage',
    );
    const intent = validateDeploymentArtifactStageIntentContext(
      value.intent,
      {
        deploymentRevision: authority.plan.deploymentRevision,
        profile: authority.profile,
        providerScope: authority.plan.providerScope,
      },
      'awsSingleNodeManagedArtifact artifactStage.intent',
    );
    const receipt = validateDeploymentArtifactStageReceiptContext(
      value.receipt,
      { intent },
      'awsSingleNodeManagedArtifact artifactStage.receipt',
    );
    return deepFreeze({ intent, receipt });
  } catch (error) {
    if (error instanceof AwsSingleNodeManagedArtifactResourceConflictError) {
      throw error;
    }
    throw new AwsSingleNodeManagedArtifactResourceConflictError();
  }
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeManagedArtifact context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeManagedArtifact context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeManagedArtifact context.head',
  );
  const expectedOperationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : head.settledDeploymentRevisionId === null
        ? 'create'
        : head.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  if (
    value.operation !== plan.operation ||
    plan.providerScope.providerScopeId !== providerScope.providerScopeId ||
    providerSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
    head.deploymentInstanceId !== plan.deploymentInstanceId ||
    head.incarnationId !== plan.incarnationId ||
    head.providerScope.providerScopeId !== providerScope.providerScopeId ||
    head.activeOperation === null ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.kind !== expectedOperationKind ||
    plan.basis.headGeneration >= head.generation ||
    plan.basis.settledDeploymentRevisionId !==
      head.settledDeploymentRevisionId ||
    head.targetDeploymentRevisionId !==
      (expectedOperationKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId) ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ candidate,
        /** @type {number} */ index,
      ) => candidate.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeManagedArtifactResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeManagedArtifactResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.management !== 'managed' ||
    action.resourceKey !== 'artifact' ||
    action.capability.kind !== 'artifact-storage' ||
    action.role.kind !== 'object' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0 ||
    (action.before !== null && action.before.providerType !== 's3-object') ||
    (action.after !== null && action.after.providerType !== 's3-object') ||
    !['create', 'update', 'noop', 'delete'].includes(action.action)
  ) {
    throw new AwsSingleNodeManagedArtifactResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeManagedArtifact context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeManagedArtifactResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeManagedArtifactStateDigest({
    deploymentRevision: plan.deploymentRevision,
    profile,
    providerScope: plan.providerScope,
    providerSpec,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  const location = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope: plan.providerScope,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerResourceId !== location.arn ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
  } else {
    if (
      priorBinding === undefined ||
      priorBinding.management !== 'managed' ||
      priorBinding.providerType !== 's3-object' ||
      priorBinding.providerResourceId !== location.arn ||
      priorBinding.deploymentInstanceId !== plan.deploymentInstanceId ||
      priorBinding.incarnationId !== plan.incarnationId ||
      priorBinding.providerScopeId !== providerScope.providerScopeId ||
      priorBinding.resourceKey !== 'artifact' ||
      !sameJson(priorBinding.capability, action.capability) ||
      !sameJson(priorBinding.role, action.role) ||
      priorBinding.ownershipMode !== 'direct' ||
      priorBinding.onDestroy !== 'purge' ||
      priorBinding.dependencyBindings.length !== 0 ||
      priorBinding.ownershipNonce !== ownershipNonce ||
      action.before === null ||
      action.before.providerResourceId !== location.arn ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
    if (action.action === 'delete') {
      if (
        plan.operation !== 'destroy' ||
        action.after !== null ||
        !sameJson(action.before.stateDigest, stateDigest)
      ) {
        throw new AwsSingleNodeManagedArtifactResourceConflictError();
      }
    } else if (
      action.after === null ||
      action.after.providerResourceId !== location.arn ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
    if (
      action.action === 'noop' &&
      !sameJson(action.before.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
  }
  const shell = {
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec,
    stateDigest,
    location,
    priorBinding: priorBinding ?? null,
  };
  const artifactStage =
    action.action === 'delete'
      ? (() => {
          if (value.artifactStage !== null) {
            throw new AwsSingleNodeManagedArtifactResourceConflictError();
          }
          return null;
        })()
      : validateArtifactStage(value.artifactStage, shell);
  return deepFreeze({ ...shell, artifactStage });
}

/** Stable namespace ownership only; mutable per-version semantics are authenticated by their state digest below. @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function ownershipCore(authority) {
  return deepFreeze({
    'wharfie-schema': AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': authority.plan.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': authority.plan.deploymentInstanceId,
    'wharfie-incarnation-id': authority.plan.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id':
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    'wharfie-ownership-nonce': authority.ownershipNonce,
    'wharfie-app-id': authority.plan.deploymentRevision.appId,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateManagedMetadata(value, authority) {
  if (!isPlainObject(value)) throw new ArtifactEvidenceConflictError();
  const keys = Object.keys(value);
  if (
    keys.length !== MANAGED_METADATA_KEYS.size ||
    keys.some((key) => !MANAGED_METADATA_KEYS.has(key))
  ) {
    throw new ArtifactEvidenceConflictError();
  }
  for (const [key, expected] of Object.entries(ownershipCore(authority))) {
    if (value[key] !== expected) throw new ArtifactEvidenceConflictError();
  }
  try {
    assertDomainSeparatedSha256Id(
      value['wharfie-created-by-action-id'],
      DEPLOYMENT_ACTION_ID_PREFIX,
      'managedArtifact metadata createdByActionId',
    );
    validateOwnershipNonce(
      value['wharfie-ownership-nonce'],
      'managedArtifact metadata ownershipNonce',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-deployment-revision-id'],
      DEPLOYMENT_REVISION_ID_PREFIX,
      'managedArtifact metadata deploymentRevisionId',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-profile-revision-id'],
      DEPLOYMENT_PROFILE_ID_PREFIX,
      'managedArtifact metadata profileRevisionId',
    );
    assertLogicalId(value['wharfie-app-id'], 'managedArtifact metadata appId');
    assertApplicationRevisionId(
      value['wharfie-revision-id'],
      'managedArtifact metadata revisionId',
    );
    assertArtifactId(
      value['wharfie-artifact-id'],
      'managedArtifact metadata artifactId',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-stage-intent-id'],
      DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
      'managedArtifact metadata stageIntentId',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-stage-receipt-id'],
      DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
      'managedArtifact metadata stageReceiptId',
    );
  } catch {
    throw new ArtifactEvidenceConflictError();
  }
  const contentLength = parseCanonicalContentLength(
    value['wharfie-content-length'],
  );
  let stateDigest;
  try {
    stateDigest = validateSha256Digest(
      {
        algorithm: 'sha256',
        value: value['wharfie-state-digest'],
      },
      'managedArtifact metadata stateDigest',
    );
  } catch {
    throw new ArtifactEvidenceConflictError();
  }
  const expectedDigest = stateDigestFromReferences(
    authority.plan.providerScope,
    authority.plan.deploymentInstanceId,
    authority.plan.incarnationId,
    {
      deploymentRevisionId: value['wharfie-deployment-revision-id'],
      profileRevisionId: value['wharfie-profile-revision-id'],
      appId: value['wharfie-app-id'],
      revisionId: value['wharfie-revision-id'],
      artifactId: value['wharfie-artifact-id'],
    },
    authority.providerSpec.capabilities.artifactStorage,
  );
  if (!sameJson(stateDigest, expectedDigest)) {
    throw new ArtifactEvidenceConflictError();
  }
  return deepFreeze({
    metadata: { ...value },
    contentLength,
    stateDigest,
    artifactId: value['wharfie-artifact-id'],
    deploymentRevisionId: value['wharfie-deployment-revision-id'],
    revisionId: value['wharfie-revision-id'],
    stageIntentId: value['wharfie-stage-intent-id'],
    stageReceiptId: value['wharfie-stage-receipt-id'],
  });
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @param {string|undefined} exactVersionId @returns {Readonly<Record<string, any>>} */
function validateManagedHead(response, authority, exactVersionId) {
  if (!isPlainObject(response)) throw new ProviderResponseUnknownError();
  if (!isUsableVersionId(response.VersionId)) {
    throw new ArtifactEvidenceConflictError();
  }
  if (exactVersionId !== undefined && response.VersionId !== exactVersionId) {
    throw new ArtifactEvidenceConflictError();
  }
  if (!isUsableOpaqueEtag(response.ETag)) {
    throw new ArtifactEvidenceConflictError();
  }
  const parsed = validateManagedMetadata(response.Metadata, authority);
  if (
    response.ContentLength !== parsed.contentLength ||
    response.ChecksumSHA256 !== artifactChecksumBase64(parsed.artifactId) ||
    response.ServerSideEncryption !== 'AES256' ||
    (response.StorageClass ?? 'STANDARD') !== 'STANDARD' ||
    response.ContentType !== AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE ||
    response.CacheControl !== AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL ||
    response.DeleteMarker === true ||
    (response.ChecksumType !== undefined &&
      response.ChecksumType !== 'FULL_OBJECT') ||
    (response.TagCount !== undefined && response.TagCount !== 0) ||
    response.ContentDisposition !== undefined ||
    response.ContentEncoding !== undefined ||
    response.ContentLanguage !== undefined ||
    response.WebsiteRedirectLocation !== undefined ||
    response.SSECustomerAlgorithm !== undefined ||
    response.SSEKMSKeyId !== undefined ||
    response.ReplicationStatus !== undefined ||
    response.ObjectLockMode !== undefined ||
    response.ObjectLockRetainUntilDate !== undefined ||
    response.ObjectLockLegalHoldStatus !== undefined ||
    response.PartsCount !== undefined
  ) {
    throw new ArtifactEvidenceConflictError();
  }
  return deepFreeze({
    versionId: response.VersionId,
    etag: response.ETag,
    contentLength: response.ContentLength,
    ...parsed,
  });
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<{versionId: string, etag: string}>} */
function validateStageHead(response, authority) {
  if (!isPlainObject(response)) throw new ProviderResponseUnknownError();
  const stage = authority.artifactStage;
  const expectedMetadata = {
    'wharfie-schema': DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA,
    'wharfie-intent': stage.intent.stageIntentId,
    'wharfie-nonce': stage.intent.ownershipNonce,
    'wharfie-artifact': stage.intent.artifact.artifactId,
    'wharfie-digest': stage.intent.artifact.byteDigest.value,
  };
  if (
    !isUsableVersionId(response.VersionId) ||
    response.VersionId !== stage.receipt.object.versionId ||
    !isUsableOpaqueEtag(response.ETag) ||
    response.ContentLength !== stage.receipt.object.contentLength ||
    response.ChecksumSHA256 !==
      artifactChecksumBase64(stage.intent.artifact.artifactId) ||
    response.ServerSideEncryption !== 'AES256' ||
    (response.StorageClass ?? 'STANDARD') !== 'STANDARD' ||
    response.ContentType !== DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE ||
    response.DeleteMarker === true ||
    !isPlainObject(response.Metadata) ||
    Object.keys(response.Metadata).length !== STAGE_METADATA_KEYS.size ||
    Object.keys(response.Metadata).some(
      (key) => !STAGE_METADATA_KEYS.has(key),
    ) ||
    Object.entries(expectedMetadata).some(
      ([key, expected]) => response.Metadata[key] !== expected,
    )
  ) {
    throw new ArtifactEvidenceConflictError();
  }
  return deepFreeze({ versionId: response.VersionId, etag: response.ETag });
}

/** @param {unknown} value @returns {Readonly<{key: string, versionId: string, isLatest: boolean, etag: string, size: number}>} */
function validateListedVersion(value) {
  if (!isPlainObject(value)) throw new ProviderResponseUnknownError();
  if (
    !isUsableVersionId(value.VersionId) ||
    typeof value.IsLatest !== 'boolean' ||
    !isUsableOpaqueEtag(value.ETag) ||
    !Number.isSafeInteger(value.Size) ||
    value.Size < 0 ||
    value.Size > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES ||
    (value.StorageClass ?? 'STANDARD') !== 'STANDARD' ||
    (value.ChecksumType !== undefined &&
      value.ChecksumType !== 'FULL_OBJECT') ||
    (value.ChecksumAlgorithm !== undefined &&
      (!Array.isArray(value.ChecksumAlgorithm) ||
        value.ChecksumAlgorithm.length !== 1 ||
        value.ChecksumAlgorithm[0] !== 'SHA256'))
  ) {
    throw new ProviderResponseUnknownError();
  }
  return deepFreeze({
    key: decodeListedKey(value.Key),
    versionId: value.VersionId,
    isLatest: value.IsLatest,
    etag: value.ETag,
    size: value.Size,
  });
}

/** @param {unknown} value @returns {Readonly<{key: string, versionId: string, isLatest: boolean}>} */
function validateListedMarker(value) {
  if (!isPlainObject(value)) throw new ProviderResponseUnknownError();
  if (
    !isUsableVersionId(value.VersionId) ||
    typeof value.IsLatest !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  return deepFreeze({
    key: decodeListedKey(value.Key),
    versionId: value.VersionId,
    isLatest: value.IsLatest,
  });
}

/** @param {string} key @returns {string} */
function encodeCopyKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} stageHead @param {Readonly<Record<string, any>>|null} current @returns {Readonly<import('@aws-sdk/client-s3').CopyObjectCommandInput>} */
function copyRequest(authority, stageHead, current) {
  const source = authority.artifactStage.receipt.object;
  return deepFreeze({
    Bucket: authority.location.bucketName,
    Key: authority.location.key,
    CopySource: `${source.bucketName}/${encodeCopyKey(source.key)}?versionId=${encodeURIComponent(
      source.versionId,
    )}`,
    CopySourceIfMatch: stageHead.etag,
    ExpectedBucketOwner: authority.plan.providerScope.accountId,
    ExpectedSourceBucketOwner: authority.plan.providerScope.accountId,
    MetadataDirective: 'REPLACE',
    Metadata: managedMetadata(authority),
    TaggingDirective: 'REPLACE',
    AnnotationDirective: 'EXCLUDE',
    ChecksumAlgorithm: 'SHA256',
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
    CacheControl: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
    ...(current === null ? { IfNoneMatch: '*' } : { IfMatch: current.etag }),
  });
}

/**
 * Bind one stable, versioned S3 current-object namespace to the managed
 * artifact graph role. Every mutation settles from exact provider readback;
 * the factory never owns or closes its caller's narrow S3 client.
 * @param {unknown} options - Client, provider scope and bounded retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeManagedArtifactResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeManagedArtifact options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeManagedArtifact options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeManagedArtifact client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeManagedArtifact providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeManagedArtifact maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeManagedArtifact waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeManagedArtifactResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string|undefined} versionId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readHead(authority, versionId) {
    let response;
    try {
      response = await client.headObject(
        deepFreeze({
          Bucket: authority.location.bucketName,
          Key: authority.location.key,
          ...(versionId === undefined ? {} : { VersionId: versionId }),
          ChecksumMode: 'ENABLED',
          ExpectedBucketOwner: providerScope.accountId,
        }),
      );
    } catch (error) {
      if (versionId === undefined && isCurrentObjectMissingError(error)) {
        return null;
      }
      if (
        versionId !== undefined &&
        (errorNamed(error, 'NoSuchVersion') ||
          isCurrentObjectMissingError(error))
      ) {
        throw new ArtifactEvidenceTransientError();
      }
      throw new ProviderResponseUnknownError();
    }
    return validateManagedHead(response, authority, versionId);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>>} */
  async function readStageHead(authority) {
    const source = authority.artifactStage.receipt.object;
    let response;
    try {
      response = await client.headObject(
        deepFreeze({
          Bucket: source.bucketName,
          Key: source.key,
          VersionId: source.versionId,
          ChecksumMode: 'ENABLED',
          ExpectedBucketOwner: providerScope.accountId,
        }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'NoSuchKey') ||
        errorNamed(error, 'NoSuchVersion') ||
        errorNamed(error, 'NotFound')
      ) {
        throw new ArtifactEvidenceConflictError();
      }
      throw new ProviderResponseUnknownError();
    }
    return validateStageHead(response, authority);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<{versions: Readonly<Record<string, any>>[], markers: Readonly<Record<string, any>>[], current: Readonly<Record<string, any>>|null}>>} */
  async function readHistory(authority) {
    const versions = [];
    const markers = [];
    const markerPairs = new Set();
    let keyMarker;
    let versionIdMarker;
    let totalEntries = 0;
    for (
      let pageIndex = 0;
      pageIndex < AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES;
      pageIndex += 1
    ) {
      const request = deepFreeze({
        Bucket: authority.location.bucketName,
        Prefix: authority.location.key,
        MaxKeys: AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE,
        EncodingType: 'url',
        ExpectedBucketOwner: providerScope.accountId,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(versionIdMarker === undefined
          ? {}
          : { VersionIdMarker: versionIdMarker }),
      });
      let response;
      try {
        response = await client.listObjectVersions(request);
      } catch {
        throw new ProviderResponseUnknownError();
      }
      if (
        !isPlainObject(response) ||
        typeof response.IsTruncated !== 'boolean' ||
        (response.Name !== undefined &&
          response.Name !== authority.location.bucketName) ||
        (response.Prefix !== undefined &&
          decodeListedKey(response.Prefix) !== authority.location.key) ||
        response.EncodingType !== 'url' ||
        (response.MaxKeys !== undefined &&
          (!Number.isSafeInteger(response.MaxKeys) ||
            response.MaxKeys < 0 ||
            response.MaxKeys >
              AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE)) ||
        (response.Versions !== undefined &&
          !Array.isArray(response.Versions)) ||
        (response.DeleteMarkers !== undefined &&
          !Array.isArray(response.DeleteMarkers))
      ) {
        throw new ProviderResponseUnknownError();
      }
      const listedVersions = (response.Versions ?? []).map(
        validateListedVersion,
      );
      const listedMarkers = (response.DeleteMarkers ?? []).map(
        validateListedMarker,
      );
      if (
        listedVersions.length + listedMarkers.length >
        AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE
      ) {
        throw new ProviderResponseUnknownError();
      }
      const exactVersions = listedVersions.filter(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          entry.key === authority.location.key,
      );
      const exactMarkers = listedMarkers.filter(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          entry.key === authority.location.key,
      );
      totalEntries += exactVersions.length + exactMarkers.length;
      if (
        totalEntries > AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS
      ) {
        throw new ArtifactEvidenceConflictError();
      }
      versions.push(...exactVersions);
      markers.push(...exactMarkers);
      if (!response.IsTruncated) break;
      if (
        typeof response.NextKeyMarker !== 'string' ||
        response.NextKeyMarker.length === 0 ||
        !isUsableVersionId(response.NextVersionIdMarker)
      ) {
        throw new ProviderResponseUnknownError();
      }
      const nextKeyMarker = decodeListedKey(response.NextKeyMarker);
      const pair = JSON.stringify([
        nextKeyMarker,
        response.NextVersionIdMarker ?? null,
      ]);
      if (markerPairs.has(pair)) throw new ArtifactEvidenceConflictError();
      markerPairs.add(pair);
      keyMarker = nextKeyMarker;
      versionIdMarker = response.NextVersionIdMarker;
      if (
        pageIndex + 1 ===
        AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES
      ) {
        throw new ArtifactEvidenceConflictError();
      }
    }
    const all = [...versions, ...markers];
    const versionIds = new Set();
    for (const entry of all) {
      if (versionIds.has(entry.versionId)) {
        throw new ArtifactEvidenceConflictError();
      }
      versionIds.add(entry.versionId);
    }
    const latest = all.filter((entry) => entry.isLatest);
    if ((all.length === 0 && latest.length !== 0) || latest.length > 1) {
      throw new ArtifactEvidenceConflictError();
    }
    if (all.length > 0 && latest.length !== 1) {
      throw new ArtifactEvidenceConflictError();
    }

    const auditedVersions = [];
    for (const version of versions) {
      const head = await readHead(authority, version.versionId);
      if (head === null) throw new ArtifactEvidenceTransientError();
      if (head.etag !== version.etag || head.contentLength !== version.size) {
        throw new ArtifactEvidenceConflictError();
      }
      auditedVersions.push(deepFreeze({ ...version, head }));
    }

    const latestEntry = latest[0] ?? null;
    const current = await readHead(authority, undefined);
    if (latestEntry === null) {
      if (current !== null) throw new ArtifactEvidenceTransientError();
    } else {
      const latestIsMarker = markers.some(
        (marker) => marker.versionId === latestEntry.versionId,
      );
      if (latestIsMarker) {
        if (current !== null) throw new ArtifactEvidenceTransientError();
      } else if (
        current === null ||
        current.versionId !== latestEntry.versionId ||
        current.etag !== latestEntry.etag ||
        current.contentLength !== latestEntry.size
      ) {
        throw new ArtifactEvidenceTransientError();
      }
    }
    return deepFreeze({
      versions: auditedVersions,
      markers,
      current,
    });
  }

  /** @param {Readonly<Record<string, any>>} current @param {Readonly<Record<string, any>>} authority @returns {boolean} */
  function isExactDesired(current, authority) {
    if (!sameJson(current.stateDigest, authority.stateDigest)) return false;
    const expected = managedMetadata(authority);
    return sameStringMap(current.metadata, expected);
  }

  /** @param {unknown} error @returns {never} */
  function throwPublicReadError(error) {
    if (error instanceof ArtifactEvidenceConflictError) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
    throw new AwsSingleNodeManagedArtifactResourceUnknownError();
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let history;
    try {
      history = await readHistory(authority);
    } catch (error) {
      throwPublicReadError(error);
    }
    if (authority.action.action === 'delete') {
      const deletionOrder = [
        ...history.versions.filter((entry) => !entry.isLatest),
        ...history.markers.filter((entry) => !entry.isLatest),
        ...history.versions.filter((entry) => entry.isLatest),
        ...history.markers.filter((entry) => entry.isLatest),
      ];
      for (const entry of deletionOrder) {
        try {
          await client.deleteObjectVersion(
            deepFreeze({
              Bucket: authority.location.bucketName,
              Key: authority.location.key,
              VersionId: entry.versionId,
              ExpectedBucketOwner: providerScope.accountId,
            }),
          );
        } catch (error) {
          if (errorNamed(error, 'NoSuchVersion')) continue;
          let readback;
          try {
            readback = await readHistory(authority);
          } catch (readError) {
            if (readError instanceof ArtifactEvidenceConflictError) {
              throw new AwsSingleNodeManagedArtifactResourceConflictError();
            }
            throw new AwsSingleNodeManagedArtifactResourceUnknownError();
          }
          const stillPresent = [...readback.versions, ...readback.markers].some(
            (/** @type {Readonly<Record<string, any>>} */ candidate) =>
              candidate.versionId === entry.versionId,
          );
          if (!stillPresent) continue;
          throw new AwsSingleNodeManagedArtifactResourceUnknownError();
        }
      }
      return;
    }

    if (
      history.current !== null &&
      isExactDesired(history.current, authority)
    ) {
      if (
        authority.action.action === 'create' &&
        (history.versions.length !== 1 || history.markers.length !== 0)
      ) {
        throw new AwsSingleNodeManagedArtifactResourceConflictError();
      }
      return;
    }
    if (authority.action.action === 'create' && history.versions.length > 0) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
    if (authority.action.action === 'create' && history.markers.length > 0) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }
    if (
      authority.action.action === 'update' &&
      history.current !== null &&
      !sameJson(
        history.current.stateDigest,
        authority.action.before.stateDigest,
      )
    ) {
      throw new AwsSingleNodeManagedArtifactResourceConflictError();
    }

    let stageHead;
    try {
      stageHead = await readStageHead(authority);
    } catch (error) {
      throwPublicReadError(error);
    }
    /** @type {unknown} */
    let copyError;
    try {
      await client.copyObject(
        copyRequest(authority, stageHead, history.current),
      );
    } catch (error) {
      copyError = error;
    }

    let readback;
    try {
      readback = await readHistory(authority);
    } catch (error) {
      if (error instanceof ArtifactEvidenceConflictError) {
        throw new AwsSingleNodeManagedArtifactResourceConflictError();
      }
      throw new AwsSingleNodeManagedArtifactResourceUnknownError();
    }
    if (
      readback.current !== null &&
      isExactDesired(readback.current, authority)
    ) {
      return;
    }
    if (
      copyError !== undefined &&
      (errorNamed(copyError, 'PreconditionFailed') ||
        errorNamed(copyError, 'ConditionalRequestConflict'))
    ) {
      return;
    }
    throw new AwsSingleNodeManagedArtifactResourceUnknownError();
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const history = await readHistory(authority);
        if (authority.action.action === 'delete') {
          if (history.versions.length === 0 && history.markers.length === 0) {
            return deepFreeze({ status: 'converged', binding: null });
          }
          return Object.freeze({ status: 'not-converged' });
        }
        if (history.current === null) {
          return authority.action.action === 'noop'
            ? Object.freeze({ status: 'blocked' })
            : Object.freeze({ status: 'not-converged' });
        }
        if (!isExactDesired(history.current, authority)) {
          if (
            authority.action.action === 'update' &&
            sameJson(
              history.current.stateDigest,
              authority.action.before.stateDigest,
            )
          ) {
            return Object.freeze({ status: 'not-converged' });
          }
          return Object.freeze({ status: 'blocked' });
        }
        if (
          authority.action.action === 'create' &&
          (history.versions.length !== 1 || history.markers.length !== 0)
        ) {
          return Object.freeze({ status: 'blocked' });
        }
        const binding =
          authority.priorBinding ??
          createDeploymentResourceBinding({
            schemaVersion: 2,
            kind: 'deploymentResourceBinding',
            deploymentInstanceId: authority.plan.deploymentInstanceId,
            incarnationId: authority.plan.incarnationId,
            resourceKey: authority.action.resourceKey,
            capability: authority.action.capability,
            role: authority.action.role,
            management: 'managed',
            ownershipMode: authority.action.ownershipMode,
            onDestroy: authority.action.onDestroy,
            dependencyBindings: [],
            providerType: 's3-object',
            providerResourceId: authority.location.arn,
            providerScopeId: providerScope.providerScopeId,
            ownershipNonce: authority.ownershipNonce,
            createdByActionId: authority.action.actionId,
          });
        return deepFreeze({ status: 'converged', binding });
      } catch (error) {
        if (error instanceof ArtifactEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof ArtifactEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeManagedArtifactResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
      }
    }
    return Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeManagedArtifactResourceConflictError,
  AwsSingleNodeManagedArtifactResourceUnknownError,
  createAwsSingleNodeManagedArtifactResource,
  getAwsSingleNodeManagedArtifactStateDigest,
};
