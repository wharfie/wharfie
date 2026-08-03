/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import {
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
} from './deployment-artifact-stage.js';
import {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeManagedArtifactEvidenceConflictError as ArtifactEvidenceConflictError,
  AwsSingleNodeManagedArtifactEvidenceTransientError as ArtifactEvidenceTransientError,
  AwsSingleNodeManagedArtifactEvidenceUnknownError as ProviderResponseUnknownError,
  createAwsSingleNodeManagedArtifactHistoryEvidence,
  decodeAwsSingleNodeManagedArtifactHead,
  decodeAwsSingleNodeManagedArtifactStageHead,
  getAwsSingleNodeManagedArtifactStateDigest,
  isAwsSingleNodeManagedArtifactCurrentMissingError as isCurrentObjectMissingError,
  isAwsSingleNodeManagedArtifactDesiredState,
  isAwsSingleNodeManagedArtifactErrorNamed as errorNamed,
} from './deployment-aws-managed-artifact-evidence.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from './deployment-aws-runtime-identity-contract.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN,
  getAwsSingleNodeManagedArtifactStateDigest,
};

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
const ARTIFACT_STAGE_KEYS = new Set(['intent', 'receipt']);

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

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
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

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function evidenceAuthority(authority) {
  return deepFreeze({
    providerScope: authority.plan.providerScope,
    artifactStorage: authority.providerSpec.capabilities.artifactStorage,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    createdByActionId:
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    ownershipNonce: authority.ownershipNonce,
    appId: authority.plan.deploymentRevision.appId,
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
    return decodeAwsSingleNodeManagedArtifactHead(
      response,
      evidenceAuthority(authority),
      versionId,
    );
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
    return decodeAwsSingleNodeManagedArtifactStageHead(
      response,
      authority.artifactStage,
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<{versions: Readonly<Record<string, any>>[], markers: Readonly<Record<string, any>>[], current: Readonly<Record<string, any>>|null}>>} */
  async function readHistory(authority) {
    const evidence = createAwsSingleNodeManagedArtifactHistoryEvidence({
      readHistoryPage: async (
        /** @type {Readonly<Record<string, any>>} */ request,
      ) => {
        try {
          return await client.listObjectVersions(request);
        } catch {
          throw new ProviderResponseUnknownError();
        }
      },
      readHead: (/** @type {string|undefined} */ versionId) =>
        readHead(authority, versionId),
    });
    return evidence.readHistory({
      location: authority.location,
      accountId: providerScope.accountId,
    });
  }

  /** @param {Readonly<Record<string, any>>} current @param {Readonly<Record<string, any>>} authority @returns {boolean} */
  function isExactDesired(current, authority) {
    return isAwsSingleNodeManagedArtifactDesiredState(current, {
      stateDigest: authority.stateDigest,
      metadata: managedMetadata(authority),
    });
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
