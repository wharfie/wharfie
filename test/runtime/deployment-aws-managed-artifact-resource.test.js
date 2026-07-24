import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
} from '../../src/core/runtime/deployment-artifact-stage.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeManagedArtifactResourceConflictError,
  AwsSingleNodeManagedArtifactResourceUnknownError,
  createAwsSingleNodeManagedArtifactResource,
  getAwsSingleNodeManagedArtifactStateDigest,
} from '../../src/core/runtime/deployment-aws-managed-artifact-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
  validateProviderScope,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

const MANAGED_VERSION = 'managed-version-1';
const UPDATED_VERSION = 'managed-version-2';
const STAGE_VERSION = 'stage/version +opaque?=1';
const OLD_STAGE_VERSION = 'old-stage-version';
const INVALID_S3_HEAD_ETAGS = Object.freeze([
  ['empty', ''],
  ['unquoted', 'opaque-etag'],
  ['weak', 'W/"opaque-etag"'],
  ['wildcard', '*'],
  ['quoted wildcard', '"*"'],
  ['empty quoted value', '""'],
  ['comma-delimited list', '"first","second"'],
  ['quoted comma', '"first,second"'],
  ['embedded quote', '"first"second"'],
  ['missing closing quote', '"opaque-etag'],
  ['missing opening quote', 'opaque-etag"'],
  ['line feed', '"opaque\netag"'],
  ['carriage return', '"opaque\retag"'],
  ['null control', '"opaque\u0000etag"'],
  ['delete control', '"opaque\u007fetag"'],
  ['code point above obs-text', '"opaque\u0100etag"'],
  ['more than 1024 bytes', `"${'a'.repeat(1023)}"`],
]);

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {string} name @param {number} [status] @returns {Error & AnyRecord} */
function providerError(name, status = 500) {
  const error = /** @type {Error & AnyRecord} */ (
    new Error('provider-secret-detail')
  );
  error.name = name;
  error.$metadata = { httpStatusCode: status };
  return error;
}

/** @param {string} value @returns {string} */
function checksumBase64(value) {
  return Buffer.from(value, 'base64url').toString('base64');
}

/** @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} providerScope */
function makeProviderSpec(profile, providerScope) {
  return createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef0',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef0',
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
}

/** @param {Readonly<Record<string, any>>} profile @param {number} revisionNumber @param {string} artifactPayload */
function makeDeploymentRevision(profile, revisionNumber, artifactPayload) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:managed-artifact-application-revision:v1',
      { revisionNumber },
    ),
    artifactId: createSha256Id({ prefix: 'waf1', payload: artifactPayload }),
    profileRevisionId: profile.profileRevisionId,
  };
  return validateDeploymentRevision({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'managed-artifact-resource-test',
      target: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      mode: { kind: 'single-node-systemd-user', version: 1 },
      provider: createAwsSingleNodeProvider('us-east-1'),
    }),
  );
  const deploymentRevision = makeDeploymentRevision(
    profile,
    2,
    'managed artifact desired bytes',
  );
  const previousDeploymentRevision = makeDeploymentRevision(
    profile,
    1,
    'managed artifact previous bytes',
  );
  const providerScope = validateProviderScope(
    createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    }),
  );
  const providerSpec = makeProviderSpec(profile, providerScope);
  return Object.freeze({
    profile,
    previousProfile: profile,
    deploymentRevision,
    previousDeploymentRevision,
    providerScope,
    providerSpec,
    previousProviderSpec: providerSpec,
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 7)),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function makeCrossProfileBase() {
  const base = makeBase();
  const previousProfile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: base.profile.profile,
      appId: base.profile.appId,
      target: { ...base.profile.target, nodeVersion: '22.14.0' },
      mode: base.profile.mode,
      provider: base.profile.provider,
    }),
  );
  const previousDeploymentRevision = makeDeploymentRevision(
    previousProfile,
    1,
    'managed artifact previous profile bytes',
  );
  const previousProviderSpec = makeProviderSpec(
    previousProfile,
    base.providerScope,
  );
  const previousDeploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision: previousDeploymentRevision,
    providerScope: base.providerScope,
  });
  if (previousDeploymentInstanceId !== base.deploymentInstanceId) {
    throw new Error(
      'Profile revision unexpectedly changed deployment identity.',
    );
  }
  return Object.freeze({
    ...base,
    previousProfile,
    previousDeploymentRevision,
    previousProviderSpec,
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} [deploymentRevision] @param {{profile?: Readonly<Record<string, any>>, providerSpec?: Readonly<Record<string, any>>}} [options] */
function stateAuthority(
  base,
  deploymentRevision = base.deploymentRevision,
  options = {},
) {
  return Object.freeze({
    deploymentRevision,
    profile: options.profile ?? base.profile,
    providerScope: base.providerScope,
    providerSpec: options.providerSpec ?? base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} base */
function location(base) {
  return getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} deploymentRevision @param {string} versionId @param {number} byte @param {Readonly<Record<string, any>>} [profile] */
function makeArtifactStage(
  base,
  deploymentRevision,
  versionId,
  byte,
  profile = base.profile,
) {
  const byteDigest = {
    algorithm: 'sha256',
    value: deploymentRevision.artifactId.slice('waf1_'.length),
  };
  const size = deploymentRevision === base.deploymentRevision ? 137 : 113;
  const intent = createDeploymentArtifactStageIntent({
    providerScope: base.providerScope,
    artifact: {
      artifactId: deploymentRevision.artifactId,
      byteDigest,
      size,
      appId: deploymentRevision.appId,
      revisionId: deploymentRevision.revisionId,
      target: profile.target,
    },
    ownershipNonce: nonce(byte),
  });
  const receipt = createDeploymentArtifactStageReceipt({
    intent,
    object: {
      bucketName: intent.object.bucketName,
      key: intent.object.key,
      versionId,
      contentLength: size,
      checksum: byteDigest,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD',
    },
  });
  return Object.freeze({ intent, receipt });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition */
function genericState(base, definition) {
  return {
    providerType: definition.providerType,
    providerResourceId: `provider-resource-${definition.resourceKey}`,
    stateDigest: digest(`${definition.resourceKey} state`),
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'create'|'noop'|'update'|'delete'} mode @param {string|null} [artifactProviderResourceId] */
function makePlan(base, mode, artifactProviderResourceId = location(base).arn) {
  const operation =
    mode === 'delete'
      ? 'destroy'
      : mode === 'update'
        ? 'apply'
        : mode === 'noop'
          ? 'reconcile'
          : 'apply';
  const definitions =
    operation === 'destroy'
      ? [...AWS_SINGLE_NODE_RESOURCE_GRAPH.resources].reverse()
      : AWS_SINGLE_NODE_RESOURCE_GRAPH.resources;
  const desiredArtifactDigest = getAwsSingleNodeManagedArtifactStateDigest(
    stateAuthority(base),
  );
  const previousArtifactDigest = getAwsSingleNodeManagedArtifactStateDigest(
    stateAuthority(base, base.previousDeploymentRevision, {
      profile: base.previousProfile,
      providerSpec: base.previousProviderSpec,
    }),
  );
  const objectLocation = location(base);
  const actions = definitions.map(
    (/** @type {Readonly<AnyRecord>} */ definition) => {
      const contract = {
        resourceKey: definition.resourceKey,
        capability: definition.capability,
        role: definition.role,
        management: 'managed',
        ownershipMode: definition.ownershipMode,
        dependsOn: definition.dependsOn,
        onDestroy: definition.onDestroy,
      };
      if (definition.resourceKey === 'artifact') {
        const desired = {
          providerType: 's3-object',
          providerResourceId: artifactProviderResourceId,
          stateDigest: desiredArtifactDigest,
        };
        const previous = {
          providerType: 's3-object',
          providerResourceId: objectLocation.arn,
          stateDigest:
            mode === 'update' ? previousArtifactDigest : desiredArtifactDigest,
        };
        if (mode === 'create') {
          return {
            ...contract,
            action: 'create',
            destructive: false,
            reason: 'missing',
            before: null,
            after: desired,
          };
        }
        if (mode === 'update') {
          return {
            ...contract,
            action: 'update',
            destructive: false,
            reason: 'deployment-change',
            before: previous,
            after: desired,
          };
        }
        if (mode === 'noop') {
          return {
            ...contract,
            action: 'noop',
            destructive: false,
            reason: 'already-converged',
            before: desired,
            after: desired,
          };
        }
        return {
          ...contract,
          action: 'delete',
          destructive: true,
          reason: 'destroy-requested',
          before: previous,
          after: null,
        };
      }
      const state = genericState(base, definition);
      if (mode === 'create') {
        return {
          ...contract,
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: { ...state, providerResourceId: null },
        };
      }
      if (operation === 'destroy') {
        const retained = definition.onDestroy === 'retain';
        return {
          ...contract,
          action: retained ? 'noop' : 'delete',
          destructive: !retained,
          reason: retained ? 'retained-data' : 'destroy-requested',
          before: state,
          after: retained ? state : null,
        };
      }
      return {
        ...contract,
        action: 'noop',
        destructive: false,
        reason: 'already-converged',
        before: state,
        after: state,
      };
    },
  );
  return createDeploymentPlan(
    {
      operation,
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: mode === 'create' ? 0 : 1,
        settledDeploymentRevisionId:
          mode === 'create'
            ? null
            : mode === 'update'
              ? base.previousDeploymentRevision.deploymentRevisionId
              : base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:managed-artifact-inspection:v1',
          { mode },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {string} ownershipNonce @param {string} createdByActionId */
function makeArtifactBinding(base, action, ownershipNonce, createdByActionId) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: 'artifact',
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [],
    providerType: 's3-object',
    providerResourceId: location(base).arn,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId,
  });
}

/** @param {{mode?: 'create'|'noop'|'update'|'delete', artifactProviderResourceId?: string|null, base?: Readonly<Record<string, any>>}} [options] @returns {Readonly<AnyRecord>} */
function makeFixture(options = {}) {
  const mode = options.mode ?? 'create';
  const base = options.base ?? makeBase();
  const plan = makePlan(base, mode, options.artifactProviderResourceId);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'artifact',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing artifact action.');
  const ownershipNonce = nonce(73);
  const historicalActionId = semanticId(
    'wda3',
    'wharfie:test:managed-artifact-create-action:v1',
    { resourceKey: 'artifact' },
  );
  const priorBinding =
    mode === 'create'
      ? null
      : makeArtifactBinding(base, action, ownershipNonce, historicalActionId);
  const intentNonces = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ _candidate,
      /** @type {number} */ index,
    ) => (index === actionIndex ? ownershipNonce : nonce(10 + index)),
  );
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ candidate,
      /** @type {number} */ index,
    ) => ({
      actionId: candidate.actionId,
      status:
        index < actionIndex
          ? 'settled'
          : index === actionIndex
            ? 'intended'
            : 'pending',
      ownershipNonce: intentNonces[index],
    }),
  );
  const lastOperation =
    priorBinding === null
      ? null
      : {
          kind: 'create',
          planId: semanticId(
            'wpl3',
            'wharfie:test:managed-artifact-last-plan:v1',
            { mode },
          ),
          intents: [
            {
              actionId: priorBinding.createdByActionId,
              status: 'settled',
              ownershipNonce: priorBinding.ownershipNonce,
            },
          ],
        };
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: mode === 'create' ? 1 : 2,
    phase: mode === 'delete' ? 'DESTROYING' : 'CONVERGING',
    settledDeploymentRevisionId:
      mode === 'create'
        ? null
        : mode === 'update'
          ? base.previousDeploymentRevision.deploymentRevisionId
          : base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId:
      mode === 'delete' ? null : base.deploymentRevision.deploymentRevisionId,
    resourceBindings: priorBinding === null ? [] : [priorBinding],
    activeOperation: {
      kind:
        mode === 'create'
          ? 'create'
          : mode === 'update'
            ? 'update'
            : mode === 'delete'
              ? 'destroy'
              : 'reconcile',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: actionIndex,
      intents,
    },
    lastOperation,
  });
  const artifactStage =
    mode === 'delete'
      ? null
      : makeArtifactStage(base, base.deploymentRevision, STAGE_VERSION, 91);
  const previousArtifactStage = makeArtifactStage(
    base,
    base.previousDeploymentRevision,
    OLD_STAGE_VERSION,
    92,
    base.previousProfile,
  );
  const context = Object.freeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex,
    ownershipNonce,
    head,
    profile: base.profile,
    artifactStage,
  });
  return Object.freeze({
    mode,
    base,
    plan,
    action,
    actionIndex,
    ownershipNonce,
    priorBinding,
    head,
    artifactStage,
    previousArtifactStage,
    context,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {{deploymentRevision?: Readonly<Record<string, any>>, profile?: Readonly<Record<string, any>>, providerSpec?: Readonly<Record<string, any>>, artifactStage?: Readonly<Record<string, any>>, stateDigest?: Readonly<Record<string, any>>, binding?: Readonly<Record<string, any>>|null}} [options] @returns {AnyRecord} */
function managedMetadata(fixture, options = {}) {
  const deploymentRevision =
    options.deploymentRevision ?? fixture.base.deploymentRevision;
  const artifactStage = options.artifactStage ?? fixture.artifactStage;
  if (artifactStage === null) {
    throw new Error('Managed artifact metadata requires stage evidence.');
  }
  const stateDigest =
    options.stateDigest ??
    getAwsSingleNodeManagedArtifactStateDigest(
      stateAuthority(fixture.base, deploymentRevision, {
        profile: options.profile,
        providerSpec: options.providerSpec,
      }),
    );
  const binding = options.binding ?? fixture.priorBinding;
  const createdByActionId =
    binding?.createdByActionId ?? fixture.action.actionId;
  const ownershipNonce = binding?.ownershipNonce ?? fixture.ownershipNonce;
  return {
    'wharfie-schema': AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie-incarnation-id': fixture.base.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id': createdByActionId,
    'wharfie-ownership-nonce': ownershipNonce,
    'wharfie-state-digest': stateDigest.value,
    'wharfie-deployment-revision-id': deploymentRevision.deploymentRevisionId,
    'wharfie-profile-revision-id': deploymentRevision.profileRevisionId,
    'wharfie-app-id': deploymentRevision.appId,
    'wharfie-revision-id': deploymentRevision.revisionId,
    'wharfie-artifact-id': deploymentRevision.artifactId,
    'wharfie-content-length': String(
      artifactStage.receipt.object.contentLength,
    ),
    'wharfie-stage-intent-id': artifactStage.intent.stageIntentId,
    'wharfie-stage-receipt-id': artifactStage.receipt.stageReceiptId,
  };
}

/** @param {Readonly<Record<string, any>>} stage @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function stageHead(stage, overrides = {}) {
  return {
    VersionId: stage.receipt.object.versionId,
    ContentLength: stage.receipt.object.contentLength,
    ChecksumSHA256: checksumBase64(stage.receipt.object.checksum.value),
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: 'application/octet-stream',
    ETag: '"stage-etag"',
    Metadata: {
      'wharfie-schema': 'deployment-artifact-stage-v1',
      'wharfie-intent': stage.intent.stageIntentId,
      'wharfie-nonce': stage.intent.ownershipNonce,
      'wharfie-artifact': stage.intent.artifact.artifactId,
      'wharfie-digest': stage.intent.artifact.byteDigest.value,
    },
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {{versionId?: string, deploymentRevision?: Readonly<Record<string, any>>, profile?: Readonly<Record<string, any>>, providerSpec?: Readonly<Record<string, any>>, artifactStage?: Readonly<Record<string, any>>, stateDigest?: Readonly<Record<string, any>>, binding?: Readonly<Record<string, any>>|null, etag?: string, overrides?: Record<string, any>}} [options] @returns {AnyRecord} */
function managedHead(fixture, options = {}) {
  const deploymentRevision =
    options.deploymentRevision ?? fixture.base.deploymentRevision;
  const artifactStage = options.artifactStage ?? fixture.artifactStage;
  if (artifactStage === null)
    throw new Error('Managed head requires stage evidence.');
  return {
    VersionId: options.versionId ?? MANAGED_VERSION,
    ContentLength: artifactStage.receipt.object.contentLength,
    ChecksumSHA256: checksumBase64(
      deploymentRevision.artifactId.slice('waf1_'.length),
    ),
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
    CacheControl: 'no-store',
    ETag: options.etag ?? '"managed-etag"',
    Metadata: managedMetadata(fixture, {
      deploymentRevision,
      profile: options.profile,
      providerSpec: options.providerSpec,
      artifactStage,
      stateDigest: options.stateDigest,
      binding: options.binding,
    }),
    ...(options.overrides ?? {}),
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {AnyRecord} head @param {boolean} [isLatest] */
function versionEntry(fixture, head, isLatest = true) {
  return {
    Key: location(fixture.base).key,
    VersionId: head.VersionId,
    IsLatest: isLatest,
    ETag: head.ETag,
    Size: head.ContentLength,
    StorageClass: 'STANDARD',
    ChecksumAlgorithm: ['SHA256'],
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {string} versionId @param {boolean} [isLatest] */
function markerEntry(fixture, versionId, isLatest = true) {
  return {
    Key: location(fixture.base).key,
    VersionId: versionId,
    IsLatest: isLatest,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {AnyRecord[]} versions @param {AnyRecord[]} [markers] @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function historyPage(fixture, versions, markers = [], overrides = {}) {
  return {
    Name: location(fixture.base).bucketName,
    Prefix: location(fixture.base).key,
    MaxKeys: 1000,
    EncodingType: 'url',
    IsTruncated: false,
    Versions: versions.map(({ __head: _head, ...entry }) => entry),
    DeleteMarkers: markers.map(({ __head: _head, ...entry }) => entry),
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {{current?: AnyRecord|null|'marker', history?: AnyRecord[], markers?: AnyRecord[], source?: AnyRecord, copyObject?: Function, listObjectVersions?: Function, headObject?: Function, deleteObjectVersion?: Function}} [options] @returns {any} */
function makeClient(fixture, options = {}) {
  let current = options.current === undefined ? null : options.current;
  let history = options.history ? [...options.history] : [];
  let markers = options.markers ? [...options.markers] : [];
  const source =
    options.source ??
    (fixture.artifactStage === null ? null : stageHead(fixture.artifactStage));
  const listObjectVersions =
    options.listObjectVersions ??
    jest.fn(async () => historyPage(fixture, history, markers));
  const headObject =
    options.headObject ??
    jest.fn(async (/** @type {AnyRecord} */ request) => {
      if (
        fixture.artifactStage !== null &&
        request.Key === fixture.artifactStage.intent.object.key
      ) {
        if (source === null) throw providerError('NoSuchVersion', 404);
        return clone(source);
      }
      if (request.VersionId !== undefined) {
        const item = history.find(
          (candidate) => candidate.VersionId === request.VersionId,
        );
        if (!item || !item.__head) throw providerError('NoSuchVersion', 404);
        return clone(item.__head);
      }
      if (current === null || current === 'marker') {
        throw providerError('NotFound', 404);
      }
      return clone(current);
    });
  const copyObject =
    options.copyObject ??
    jest.fn(async () => {
      if (fixture.artifactStage === null) throw new Error('missing stage');
      current = managedHead(fixture, {
        versionId: UPDATED_VERSION,
        etag: '"updated-etag"',
      });
      history = [
        {
          ...versionEntry(fixture, current, true),
          __head: current,
        },
        ...history.map((entry) => ({ ...entry, IsLatest: false })),
      ];
      markers = markers.map((entry) => ({ ...entry, IsLatest: false }));
      return {
        VersionId: UPDATED_VERSION,
        CopyObjectResult: {
          ETag: '"updated-etag"',
          ChecksumSHA256: current.ChecksumSHA256,
        },
      };
    });
  const deleteObjectVersion =
    options.deleteObjectVersion ??
    jest.fn(async (/** @type {AnyRecord} */ request) => {
      history = history.filter(
        (candidate) => candidate.VersionId !== request.VersionId,
      );
      markers = markers.filter(
        (candidate) => candidate.VersionId !== request.VersionId,
      );
      if (
        current !== null &&
        current !== 'marker' &&
        current.VersionId === request.VersionId
      ) {
        current = null;
      }
      return {};
    });
  return Object.freeze({
    copyObject,
    headObject,
    listObjectVersions,
    deleteObjectVersion,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] @returns {any} */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeManagedArtifactResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

describe('AWS single-node managed artifact identity', () => {
  it('pins a stable incarnation key and a desired digest independent of provider versions', () => {
    const base = makeBase();
    const authority = stateAuthority(base);
    const object = location(base);
    const desired = getAwsSingleNodeManagedArtifactStateDigest(authority);

    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS).toBe(16_000);
    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-managed-artifact-state:v1',
    );
    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE).toBe(
      'application/octet-stream',
    );
    expect(AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA).toBe(
      'deployment-managed-artifact-v1',
    );
    expect(object).toEqual({
      bucketName: expect.stringMatching(/^wharfie-dc-v1-/),
      key: `artifact/v1/${base.deploymentInstanceId}/${base.incarnationId}/current`,
      arn: `arn:aws:s3:::${object.bucketName}/artifact/v1/${base.deploymentInstanceId}/${base.incarnationId}/current`,
    });
    expect(desired).toMatchObject({
      algorithm: 'sha256',
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(desired).toEqual(
      getAwsSingleNodeManagedArtifactStateDigest(clone(authority)),
    );
    expect(desired).not.toEqual(
      getAwsSingleNodeManagedArtifactStateDigest(
        stateAuthority(base, base.previousDeploymentRevision),
      ),
    );
    expectDeepFrozen(desired);
  });

  it('rejects unsupported state-digest inputs instead of accepting stage receipts or provider observations', () => {
    const base = makeBase();
    const authority = stateAuthority(base);
    expect(() =>
      getAwsSingleNodeManagedArtifactStateDigest({
        ...authority,
        versionId: 'provider-version-must-not-affect-desired-state',
      }),
    ).toThrow(/versionId.*not supported/i);
    expect(() =>
      getAwsSingleNodeManagedArtifactStateDigest({
        ...authority,
        artifactStage: makeArtifactStage(
          base,
          base.deploymentRevision,
          'v2',
          4,
        ),
      }),
    ).toThrow(/artifactStage.*not supported/i);
  });
});

describe('AWS single-node managed artifact create and recovery', () => {
  it('copies one exact retained stage version into an empty stable namespace and settles an ARN binding', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(client.copyObject).toHaveBeenCalledTimes(1);
    const request = client.copyObject.mock.calls[0][0];
    expect(request).toEqual({
      Bucket: location(fixture.base).bucketName,
      Key: location(fixture.base).key,
      CopySource: `${fixture.artifactStage.receipt.object.bucketName}/${fixture.artifactStage.receipt.object.key
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?versionId=${encodeURIComponent(
        fixture.artifactStage.receipt.object.versionId,
      )}`,
      CopySourceIfMatch: '"stage-etag"',
      IfNoneMatch: '*',
      ExpectedSourceBucketOwner: fixture.base.providerScope.accountId,
      MetadataDirective: 'REPLACE',
      TaggingDirective: 'REPLACE',
      AnnotationDirective: 'EXCLUDE',
      ChecksumAlgorithm: 'SHA256',
      ServerSideEncryption: 'AES256',
      StorageClass: 'STANDARD',
      ContentType: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
      CacheControl: 'no-store',
      ExpectedBucketOwner: fixture.base.providerScope.accountId,
      Metadata: managedMetadata(fixture),
    });
    expect(request).not.toHaveProperty('IfMatch');
    expectDeepFrozen(request);
    expect(settlement).toEqual({
      status: 'converged',
      binding: makeArtifactBinding(
        fixture.base,
        fixture.action,
        fixture.ownershipNonce,
        fixture.action.actionId,
      ),
    });
    expectDeepFrozen(settlement);
  });

  it.each([
    ['a foreign content version', 'version'],
    ['an existing delete marker', 'marker'],
  ])(
    'refuses fresh create over %s even when the key is currently absent',
    async (_label, kind) => {
      const fixture = makeFixture();
      const owned = managedHead(fixture, {
        overrides: {
          Metadata: {
            ...managedMetadata(fixture),
            'wharfie-ownership-nonce': nonce(44),
          },
        },
      });
      const history =
        kind === 'version'
          ? [{ ...versionEntry(fixture, owned), __head: owned }]
          : [];
      const markers =
        kind === 'marker' ? [markerEntry(fixture, 'marker-1')] : [];
      const client = makeClient(fixture, {
        current: kind === 'version' ? owned : 'marker',
        history,
        markers,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
    },
  );

  it('adopts one exact desired version as intended-create crash recovery without copying again', async () => {
    const fixture = makeFixture();
    const current = managedHead(fixture);
    const history = [{ ...versionEntry(fixture, current), __head: current }];
    const client = makeClient(fixture, { current, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: makeArtifactBinding(
        fixture.base,
        fixture.action,
        fixture.ownershipNonce,
        fixture.action.actionId,
      ),
    });
    expect(client.copyObject).not.toHaveBeenCalled();
  });

  it('adopts exact managed metadata returned in a different property insertion order', async () => {
    const fixture = makeFixture();
    const reorderedMetadata = Object.fromEntries(
      Object.entries(managedMetadata(fixture)).reverse(),
    );
    const current = managedHead(fixture, {
      overrides: { Metadata: reorderedMetadata },
    });
    const history = [{ ...versionEntry(fixture, current), __head: current }];
    const client = makeClient(fixture, { current, history });
    const { resource } = makePorts(fixture, { client });

    expect(Object.keys(current.Metadata)).toEqual(
      Object.keys(managedMetadata(fixture)).reverse(),
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: makeArtifactBinding(
        fixture.base,
        fixture.action,
        fixture.ownershipNonce,
        fixture.action.actionId,
      ),
    });
    expect(client.copyObject).not.toHaveBeenCalled();
    expect(client.deleteObjectVersion).not.toHaveBeenCalled();
  });

  it.each([
    [
      'changed value',
      (/** @type {AnyRecord} */ metadata) => {
        metadata['wharfie-role'] = 'foreign';
      },
    ],
    [
      'extra key',
      (/** @type {AnyRecord} */ metadata) => {
        metadata['wharfie-extra'] = 'foreign';
      },
    ],
    [
      'missing key',
      (/** @type {AnyRecord} */ metadata) => {
        delete metadata['wharfie-role'];
      },
    ],
  ])(
    'blocks managed metadata with a %s before mutation',
    async (_label, mutateMetadata) => {
      const fixture = makeFixture();
      const metadata = managedMetadata(fixture);
      mutateMetadata(metadata);
      const current = managedHead(fixture, {
        overrides: { Metadata: metadata },
      });
      const history = [{ ...versionEntry(fixture, current), __head: current }];
      const client = makeClient(fixture, { current, history });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
      expect(client.deleteObjectVersion).not.toHaveBeenCalled();
    },
  );

  it('recovers a lost CopyObject response only from exact full readback', async () => {
    const fixture = makeFixture();
    const desired = managedHead(fixture, {
      versionId: UPDATED_VERSION,
      etag: '"updated-etag"',
    });
    /** @type {AnyRecord|null} */
    let current = null;
    const listObjectVersions = jest.fn(async () => {
      if (current === null) return historyPage(fixture, [], []);
      return historyPage(fixture, [versionEntry(fixture, current)], []);
    });
    const headObject = jest.fn(async (/** @type {AnyRecord} */ request) => {
      if (request.Key === fixture.artifactStage.intent.object.key) {
        return stageHead(fixture.artifactStage);
      }
      if (current === null) throw providerError('NotFound', 404);
      return current;
    });
    const copyObject = jest.fn(async () => {
      current = desired;
      throw providerError('AwsDeploymentManagedArtifactResourceError');
    });
    const client = makeClient(fixture, {
      listObjectVersions,
      headObject,
      copyObject,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
    });
    expect(copyObject).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a generic HTTP 404', 'AwsDeploymentManagedArtifactResourceError'],
    ['NoSuchBucket', 'NoSuchBucket'],
  ])(
    'does not treat %s as authoritative current-object absence',
    async (_label, errorName) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        headObject: jest.fn(async () => {
          throw providerError(errorName, 404);
        }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceUnknownError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
      expect(client.deleteObjectVersion).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong exact source version', { VersionId: 'wrong-stage-version' }],
    [
      'wrong source checksum',
      { ChecksumSHA256: checksumBase64(digest('wrong').value) },
    ],
    ['wrong source metadata', { Metadata: {} }],
    ['missing source ETag', { ETag: undefined }],
  ])(
    'blocks before copy when the staged source has %s',
    async (_label, overrides) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        source: stageHead(fixture.artifactStage, overrides),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
    },
  );

  it.each(INVALID_S3_HEAD_ETAGS)(
    'rejects a staged source HeadObject %s ETag before mutation',
    async (_label, etag) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        source: stageHead(fixture.artifactStage, { ETag: etag }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
      expect(client.deleteObjectVersion).not.toHaveBeenCalled();
    },
  );

  it('keeps a quoted multipart-style staged source ETag opaque', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      source: stageHead(fixture.artifactStage, {
        ETag: '"0123456789abcdef-12"',
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.copyObject).toHaveBeenCalledWith(
      expect.objectContaining({ CopySourceIfMatch: '"0123456789abcdef-12"' }),
    );
  });
});

describe('AWS single-node managed artifact noop and update', () => {
  it('performs no mutation for an exact current artifact and returns the unchanged binding', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    const current = managedHead(fixture);
    const history = [{ ...versionEntry(fixture, current), __head: current }];
    const client = makeClient(fixture, { current, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(client.copyObject).not.toHaveBeenCalled();
    expect(client.deleteObjectVersion).not.toHaveBeenCalled();
  });

  it('updates through destination If-Match while preserving the stable ARN and original binding receipt', async () => {
    const fixture = makeFixture({ mode: 'update' });
    const previous = managedHead(fixture, {
      deploymentRevision: fixture.base.previousDeploymentRevision,
      artifactStage: fixture.previousArtifactStage,
      versionId: MANAGED_VERSION,
      etag: '"previous-etag"',
      binding: fixture.priorBinding,
    });
    const history = [{ ...versionEntry(fixture, previous), __head: previous }];
    const client = makeClient(fixture, { current: previous, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(client.copyObject).toHaveBeenCalledTimes(1);
    expect(client.copyObject.mock.calls[0][0]).toMatchObject({
      IfMatch: '"previous-etag"',
      CopySourceIfMatch: '"stage-etag"',
      Metadata: managedMetadata(fixture, { binding: fixture.priorBinding }),
    });
    expect(client.copyObject.mock.calls[0][0]).not.toHaveProperty(
      'IfNoneMatch',
    );
    expect(settlement).toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(settlement.binding.providerResourceId).toBe(
      location(fixture.base).arn,
    );
    expect(settlement.binding.bindingId).toBe(fixture.priorBinding.bindingId);
    expect(settlement.binding.createdByActionId).toBe(
      fixture.priorBinding.createdByActionId,
    );
  });

  it.each(INVALID_S3_HEAD_ETAGS)(
    'rejects a listed destination/history %s ETag before mutation',
    async (_label, etag) => {
      const fixture = makeFixture({ mode: 'update' });
      const previous = managedHead(fixture, {
        deploymentRevision: fixture.base.previousDeploymentRevision,
        artifactStage: fixture.previousArtifactStage,
        versionId: MANAGED_VERSION,
        etag: '"valid-history-etag"',
        binding: fixture.priorBinding,
      });
      const history = [
        {
          ...versionEntry(fixture, previous),
          ETag: etag,
          __head: previous,
        },
      ];
      const client = makeClient(fixture, { current: previous, history });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceUnknownError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
      expect(client.deleteObjectVersion).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['versioned history HeadObject', true],
    ['unversioned current HeadObject', false],
  ])(
    'rejects comma/list grammar from the %s ETag before mutation',
    async (_label, corruptVersionedHead) => {
      const fixture = makeFixture({ mode: 'update' });
      const previous = managedHead(fixture, {
        deploymentRevision: fixture.base.previousDeploymentRevision,
        artifactStage: fixture.previousArtifactStage,
        versionId: MANAGED_VERSION,
        etag: '"valid-history-etag"',
        binding: fixture.priorBinding,
      });
      const invalid = {
        ...previous,
        ETag: '"first","second"',
      };
      const history = [
        {
          ...versionEntry(fixture, previous),
          __head: corruptVersionedHead ? invalid : previous,
        },
      ];
      const client = makeClient(fixture, {
        current: corruptVersionedHead ? previous : invalid,
        history,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
      expect(client.deleteObjectVersion).not.toHaveBeenCalled();
    },
  );

  it('audits and replaces an owned current version from a prior profile revision under the same deployment identity', async () => {
    const base = makeCrossProfileBase();
    const fixture = makeFixture({ mode: 'update', base });
    const previous = managedHead(fixture, {
      deploymentRevision: base.previousDeploymentRevision,
      profile: base.previousProfile,
      providerSpec: base.previousProviderSpec,
      artifactStage: fixture.previousArtifactStage,
      versionId: MANAGED_VERSION,
      etag: '"previous-profile-etag"',
      binding: fixture.priorBinding,
    });
    const history = [{ ...versionEntry(fixture, previous), __head: previous }];
    const client = makeClient(fixture, { current: previous, history });
    const { resource } = makePorts(fixture, { client });

    expect(base.previousProfile.profileRevisionId).not.toBe(
      base.profile.profileRevisionId,
    );
    expect(
      getDeploymentInstanceId({
        deploymentRevision: base.previousDeploymentRevision,
        providerScope: base.providerScope,
      }),
    ).toBe(base.deploymentInstanceId);
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(client.copyObject).toHaveBeenCalledTimes(1);
    expect(client.copyObject.mock.calls[0][0]).toMatchObject({
      IfMatch: '"previous-profile-etag"',
      AnnotationDirective: 'EXCLUDE',
    });
  });

  it('rejects historical profile metadata whose retained state digest is not self-consistent', async () => {
    const base = makeCrossProfileBase();
    const fixture = makeFixture({ mode: 'update', base });
    const previous = managedHead(fixture, {
      deploymentRevision: base.previousDeploymentRevision,
      profile: base.previousProfile,
      providerSpec: base.previousProviderSpec,
      artifactStage: fixture.previousArtifactStage,
      binding: fixture.priorBinding,
    });
    previous.Metadata['wharfie-profile-revision-id'] =
      base.profile.profileRevisionId;
    const history = [{ ...versionEntry(fixture, previous), __head: previous }];
    const client = makeClient(fixture, { current: previous, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactResourceConflictError);
    expect(client.copyObject).not.toHaveBeenCalled();
  });

  it.each(['no history', 'an exact-key delete marker'])(
    'recreates an absent bound current key with If-None-Match after validating %s',
    async (historyKind) => {
      const fixture = makeFixture({ mode: 'update' });
      const markers =
        historyKind === 'an exact-key delete marker'
          ? [markerEntry(fixture, 'marker-1')]
          : [];
      const client = makeClient(fixture, {
        current: markers.length === 0 ? null : 'marker',
        history: [],
        markers,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.copyObject).toHaveBeenCalledTimes(1);
      expect(client.copyObject.mock.calls[0][0]).toMatchObject({
        IfNoneMatch: '*',
      });
      expect(client.copyObject.mock.calls[0][0]).not.toHaveProperty('IfMatch');
    },
  );

  it('adopts an exact desired current version after a conditional-copy race without recopying', async () => {
    const fixture = makeFixture({ mode: 'update' });
    const desired = managedHead(fixture, {
      versionId: UPDATED_VERSION,
      etag: '"desired-etag"',
      binding: fixture.priorBinding,
    });
    const history = [{ ...versionEntry(fixture, desired), __head: desired }];
    const client = makeClient(fixture, { current: desired, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(client.copyObject).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign ownership metadata', { Metadata: { foreign: 'true' } }],
    [
      'a checksum inconsistent with artifactId',
      { ChecksumSHA256: checksumBase64(digest('tampered').value) },
    ],
    ['a wrong storage class', { StorageClass: 'GLACIER' }],
  ])(
    'blocks update before mutation when history contains %s',
    async (_label, overrides) => {
      const fixture = makeFixture({ mode: 'update' });
      const previous = managedHead(fixture, {
        deploymentRevision: fixture.base.previousDeploymentRevision,
        artifactStage: fixture.previousArtifactStage,
        binding: fixture.priorBinding,
        overrides,
      });
      const history = [
        { ...versionEntry(fixture, previous), __head: previous },
      ];
      const client = makeClient(fixture, { current: previous, history });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
    },
  );
});

describe('AWS single-node managed artifact physical destroy', () => {
  it('audits every owned version, then deletes nonlatest versions, markers, and the latest version by opaque ID', async () => {
    const fixture = makeFixture({ mode: 'delete' });
    const desiredStage = makeArtifactStage(
      fixture.base,
      fixture.base.deploymentRevision,
      STAGE_VERSION,
      91,
    );
    const latest = managedHead(fixture, {
      artifactStage: desiredStage,
      versionId: MANAGED_VERSION,
      binding: fixture.priorBinding,
    });
    const older = managedHead(fixture, {
      deploymentRevision: fixture.base.previousDeploymentRevision,
      artifactStage: fixture.previousArtifactStage,
      versionId: 'managed-old-version',
      binding: fixture.priorBinding,
      etag: '"old-etag"',
    });
    const history = [
      { ...versionEntry(fixture, latest, true), __head: latest },
      { ...versionEntry(fixture, older, false), __head: older },
      {
        ...versionEntry(fixture, older, true),
        Key: `${location(fixture.base).key}.sibling`,
        VersionId: 'sibling-version',
      },
    ];
    const markers = [markerEntry(fixture, 'old-delete-marker', false)];
    const client = makeClient(fixture, { current: latest, history, markers });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });

    expect(client.copyObject).not.toHaveBeenCalled();
    expect(
      client.deleteObjectVersion.mock.calls.map(
        (/** @type {any[]} */ call) => call[0],
      ),
    ).toEqual([
      {
        Bucket: location(fixture.base).bucketName,
        Key: location(fixture.base).key,
        VersionId: 'managed-old-version',
        ExpectedBucketOwner: fixture.base.providerScope.accountId,
      },
      {
        Bucket: location(fixture.base).bucketName,
        Key: location(fixture.base).key,
        VersionId: 'old-delete-marker',
        ExpectedBucketOwner: fixture.base.providerScope.accountId,
      },
      {
        Bucket: location(fixture.base).bucketName,
        Key: location(fixture.base).key,
        VersionId: MANAGED_VERSION,
        ExpectedBucketOwner: fixture.base.providerScope.accountId,
      },
    ]);
    expect(client.deleteObjectVersion).not.toHaveBeenCalledWith(
      expect.objectContaining({ VersionId: 'sibling-version' }),
    );
    for (const [request] of client.deleteObjectVersion.mock.calls) {
      expectDeepFrozen(request);
    }
  });

  it('physically purges an owned historical version from a prior profile revision', async () => {
    const base = makeCrossProfileBase();
    const fixture = makeFixture({ mode: 'delete', base });
    const currentStage = makeArtifactStage(
      base,
      base.deploymentRevision,
      STAGE_VERSION,
      91,
    );
    const latest = managedHead(fixture, {
      artifactStage: currentStage,
      versionId: MANAGED_VERSION,
      binding: fixture.priorBinding,
    });
    const historical = managedHead(fixture, {
      deploymentRevision: base.previousDeploymentRevision,
      profile: base.previousProfile,
      providerSpec: base.previousProviderSpec,
      artifactStage: fixture.previousArtifactStage,
      versionId: 'previous-profile-version',
      etag: '"previous-profile-etag"',
      binding: fixture.priorBinding,
    });
    const history = [
      { ...versionEntry(fixture, latest, true), __head: latest },
      {
        ...versionEntry(fixture, historical, false),
        __head: historical,
      },
    ];
    const client = makeClient(fixture, { current: latest, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(
      client.deleteObjectVersion.mock.calls.map(
        (/** @type {any[]} */ call) => call[0].VersionId,
      ),
    ).toEqual(['previous-profile-version', MANAGED_VERSION]);
  });

  it('recovers delete response loss by relisting and never treats a mutation response as settlement', async () => {
    const fixture = makeFixture({ mode: 'delete' });
    const stage = makeArtifactStage(
      fixture.base,
      fixture.base.deploymentRevision,
      STAGE_VERSION,
      91,
    );
    /** @type {AnyRecord|null} */
    let current = managedHead(fixture, {
      artifactStage: stage,
      binding: fixture.priorBinding,
    });
    let history = [{ ...versionEntry(fixture, current), __head: current }];
    const listObjectVersions = jest.fn(async () =>
      historyPage(fixture, history, []),
    );
    const headObject = jest.fn(async () => {
      if (current === null) throw providerError('NotFound', 404);
      return current;
    });
    const deleteObjectVersion = jest.fn(async () => {
      history = [];
      current = null;
      throw providerError('AwsDeploymentManagedArtifactResourceError');
    });
    const client = makeClient(fixture, {
      current,
      listObjectVersions,
      headObject,
      deleteObjectVersion,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteObjectVersion).toHaveBeenCalledTimes(1);
    expect(listObjectVersions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks physical deletion when any historical content version is foreign', async () => {
    const fixture = makeFixture({ mode: 'delete' });
    const stage = makeArtifactStage(
      fixture.base,
      fixture.base.deploymentRevision,
      STAGE_VERSION,
      91,
    );
    const foreign = managedHead(fixture, {
      artifactStage: stage,
      binding: fixture.priorBinding,
      overrides: { Metadata: { foreign: 'true' } },
    });
    const history = [{ ...versionEntry(fixture, foreign), __head: foreign }];
    const client = makeClient(fixture, { current: foreign, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactResourceConflictError);
    expect(client.deleteObjectVersion).not.toHaveBeenCalled();
  });

  it('blocks physical deletion when a historical HeadObject ETag is not one quoted entity tag', async () => {
    const fixture = makeFixture({ mode: 'delete' });
    const stage = makeArtifactStage(
      fixture.base,
      fixture.base.deploymentRevision,
      STAGE_VERSION,
      91,
    );
    const listed = managedHead(fixture, {
      artifactStage: stage,
      binding: fixture.priorBinding,
      etag: '"valid-history-etag"',
    });
    const invalidHead = { ...listed, ETag: '"first","second"' };
    const history = [{ ...versionEntry(fixture, listed), __head: invalidHead }];
    const client = makeClient(fixture, { current: listed, history });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactResourceConflictError);
    expect(client.copyObject).not.toHaveBeenCalled();
    expect(client.deleteObjectVersion).not.toHaveBeenCalled();
  });
});

describe('AWS single-node managed artifact bounded history evidence', () => {
  it('follows exact paired version markers and freezes every bounded list request', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    const current = managedHead(fixture);
    const first = historyPage(fixture, [], [], {
      IsTruncated: true,
      NextKeyMarker: location(fixture.base).key,
      NextVersionIdMarker: 'next-version-marker',
    });
    const second = historyPage(
      fixture,
      [{ ...versionEntry(fixture, current), __head: current }],
      [],
    );
    const listObjectVersions = /** @type {any} */ (jest.fn())
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const client = makeClient(fixture, {
      current,
      listObjectVersions,
      headObject: jest.fn(async () => current),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(listObjectVersions).toHaveBeenNthCalledWith(1, {
      Bucket: location(fixture.base).bucketName,
      Prefix: location(fixture.base).key,
      MaxKeys: 1000,
      EncodingType: 'url',
      ExpectedBucketOwner: fixture.base.providerScope.accountId,
    });
    expect(listObjectVersions).toHaveBeenNthCalledWith(2, {
      Bucket: location(fixture.base).bucketName,
      Prefix: location(fixture.base).key,
      MaxKeys: 1000,
      EncodingType: 'url',
      ExpectedBucketOwner: fixture.base.providerScope.accountId,
      KeyMarker: location(fixture.base).key,
      VersionIdMarker: 'next-version-marker',
    });
    expectDeepFrozen(listObjectVersions.mock.calls[0][0]);
    expectDeepFrozen(listObjectVersions.mock.calls[1][0]);
  });

  it('blocks contradictory history evidence with a duplicate opaque VersionId', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    const head = managedHead(fixture);
    const client = makeClient(fixture, {
      listObjectVersions: jest.fn(async () =>
        historyPage(fixture, [
          versionEntry(fixture, head, true),
          versionEntry(fixture, head, false),
        ]),
      ),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('rejects an incomplete truncated cursor as unknown provider evidence', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    const client = makeClient(fixture, {
      listObjectVersions: jest.fn(async () =>
        historyPage(fixture, [], [], {
          IsTruncated: true,
        }),
      ),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactResourceUnknownError);
  });

  it('blocks when pagination cycles', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    const cyclic = historyPage(fixture, [], [], {
      IsTruncated: true,
      NextKeyMarker: location(fixture.base).key,
      NextVersionIdMarker: 'same-marker',
    });
    const listObjectVersions = jest.fn(async () => cyclic);
    const client = makeClient(fixture, { listObjectVersions });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(listObjectVersions.mock.calls.length).toBeLessThanOrEqual(
      AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
    );
  });

  it('blocks when pagination exceeds the fixed page budget', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    let page = 0;
    const listObjectVersions = jest.fn(async () => {
      page += 1;
      return historyPage(fixture, [], [], {
        IsTruncated: true,
        NextKeyMarker: location(fixture.base).key,
        NextVersionIdMarker: `page-${page}`,
      });
    });
    const client = makeClient(fixture, { listObjectVersions });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(listObjectVersions).toHaveBeenCalledTimes(
      AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
    );
  });

  it('fails closed before mutation when one page exceeds its declared entry bound', async () => {
    const fixture = makeFixture({ mode: 'delete' });
    const versions = Array.from({ length: 1001 }, (_value, index) => ({
      Key: location(fixture.base).key,
      VersionId: `version-${index}`,
      IsLatest: index === 0,
      ETag: `"etag-${index}"`,
      Size: 1,
      StorageClass: 'STANDARD',
      ChecksumAlgorithm: ['SHA256'],
    }));
    const client = makeClient(fixture, {
      listObjectVersions: jest.fn(async () => historyPage(fixture, versions)),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactResourceUnknownError);
    expect(client.deleteObjectVersion).not.toHaveBeenCalled();
  });
});

describe('AWS single-node managed artifact authority validation', () => {
  it.each([
    ['copyObject'],
    ['headObject'],
    ['listObjectVersions'],
    ['deleteObjectVersion'],
  ])('requires the narrow client method %s', (method) => {
    const fixture = makeFixture();
    const client = { ...makeClient(fixture), [method]: undefined };
    expect(() =>
      createAwsSingleNodeManagedArtifactResource({
        client,
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(new RegExp(`client\\.${method}.*required`, 'i'));
  });

  it('rejects unsupported factory fields and invalid retry bounds', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(() =>
      createAwsSingleNodeManagedArtifactResource({
        client,
        providerScope: fixture.base.providerScope,
        extra: true,
      }),
    ).toThrow(/extra.*not supported/i);
    for (const maxAttempts of [
      0,
      AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS + 1,
    ]) {
      expect(() =>
        createAwsSingleNodeManagedArtifactResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(/maxAttempts/i);
    }
  });

  it.each([
    ['null', null],
    ['a foreign ARN', 'arn:aws:s3:::foreign/key'],
  ])(
    'rejects create desired provider identity %s before any provider call',
    async (_label, artifactProviderResourceId) => {
      const fixture = makeFixture({
        mode: 'create',
        artifactProviderResourceId,
      });
      const client = makeClient(fixture);
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeManagedArtifactResourceConflictError,
      );
      expect(client.copyObject).not.toHaveBeenCalled();
      expect(client.headObject).not.toHaveBeenCalled();
      expect(client.listObjectVersions).not.toHaveBeenCalled();
      expect(client.deleteObjectVersion).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'wrong artifact provider identity',
      (/** @type {AnyRecord} */ context) => {
        context.action.after.providerResourceId = 'arn:aws:s3:::foreign/key';
      },
    ],
    [
      'wrong desired digest',
      (/** @type {AnyRecord} */ context) => {
        context.action.after.stateDigest = digest('wrong desired');
      },
    ],
    [
      'unexpected dependency',
      (/** @type {AnyRecord} */ context) => {
        context.action.dependsOn = ['runtime-role'];
      },
    ],
    [
      'missing non-destroy stage evidence',
      (/** @type {AnyRecord} */ context) => {
        context.artifactStage = null;
      },
    ],
  ])('causes zero provider calls for %s', async (_label, mutate) => {
    const fixture = makeFixture({ mode: 'noop' });
    const context = clone(fixture.context);
    mutate(context);
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.executeAction(context)).rejects.toBeInstanceOf(
      AwsSingleNodeManagedArtifactResourceConflictError,
    );
    expect(client.copyObject).not.toHaveBeenCalled();
    expect(client.headObject).not.toHaveBeenCalled();
    expect(client.listObjectVersions).not.toHaveBeenCalled();
    expect(client.deleteObjectVersion).not.toHaveBeenCalled();
  });

  it('retries only bounded observation failures and surfaces a stable unknown error', async () => {
    const fixture = makeFixture({ mode: 'noop' });
    const listObjectVersions = jest.fn(async () => {
      throw providerError('AwsDeploymentManagedArtifactResourceError');
    });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { listObjectVersions });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 3,
      waitForRetry,
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toMatchObject({
      name: 'AwsSingleNodeManagedArtifactResourceUnknownError',
      code: 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_RESOURCE_UNKNOWN',
      message: expect.not.stringContaining('provider-secret-detail'),
    });
    expect(listObjectVersions).toHaveBeenCalledTimes(3);
    expect(waitForRetry).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenNthCalledWith(1, 1);
    expect(waitForRetry).toHaveBeenNthCalledWith(2, 2);
  });
});
