import { describe, expect, it } from '@jest/globals';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDeploymentControlStore,
  DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
  DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
  DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES,
  DEPLOYMENT_CONTROL_RECORD_TYPES,
  DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
  DeploymentControlStoreIntegrityError,
} from '../../src/core/runtime/deployment-control-store.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
  validateDeploymentArtifactStageReceipt,
} from '../../src/core/runtime/deployment-artifact-stage.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  createDeploymentIncarnationId,
  createOwnershipNonce,
  DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
} from '../../src/core/runtime/deployment-resource-binding.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';
import {
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

const TABLE_NAME = 'deployment-control';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @returns {{profile: Readonly<Record<string, any>>, plan: Readonly<Record<string, any>>, head: Readonly<Record<string, any>>}} */
function makeDocuments() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'control-store-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId('wrv1', 'wharfie:test:revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'control store artifact',
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  const deploymentRevision = {
    ...revisionPayload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      revisionPayload,
    ),
  };
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 1,
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
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 17));
  const plan = createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision,
      providerScope,
      providerSpec,
      deploymentInstanceId,
      incarnationId,
      basis: {
        headGeneration: 0,
        settledDeploymentRevisionId: null,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:deployment-inspection:v6',
          { inspection: 1 },
        ),
      },
      actions: AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
        (/** @type {Readonly<Record<string, any>>} */ resource) => ({
          resourceKey: resource.resourceKey,
          capability: resource.capability,
          role: resource.role,
          management: 'managed',
          ownershipMode: resource.ownershipMode,
          dependsOn: resource.dependsOn,
          onDestroy: resource.onDestroy,
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: resource.providerType,
            providerResourceId: null,
            stateDigest: digest(resource.resourceKey),
          },
        }),
      ),
    },
    { profile },
  );
  const head = createDeploymentHead({
    deploymentInstanceId,
    providerScope,
    incarnationId,
    generation: 1,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    resourceBindings: [],
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: 0,
      intents: plan.actions.map(
        (
          /** @type {Record<string, any>} */ action,
          /** @type {number} */ index,
        ) => ({
          actionId: action.actionId,
          status: 'pending',
          ownershipNonce: createOwnershipNonce(Buffer.alloc(32, index + 1)),
        }),
      ),
    },
    lastOperation: null,
  });
  return { profile, plan, head };
}

/** @param {string} [artifactBytes] @param {number} [nonceByte] @param {string} [versionId] @returns {{artifact: Readonly<Record<string, any>>, intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}} */
function makeArtifactStageDocuments(
  artifactBytes = 'control store artifact',
  nonceByte = 23,
  versionId = 'stage-version-1',
) {
  const { profile, plan } = makeDocuments();
  const byteDigest = digest(artifactBytes);
  const artifact = Object.freeze({
    artifactId: `waf1_${byteDigest.value}`,
    byteDigest,
    size: Buffer.byteLength(artifactBytes),
    appId: plan.deploymentRevision.appId,
    revisionId: plan.deploymentRevision.revisionId,
    target: profile.target,
  });
  const intent = createDeploymentArtifactStageIntent({
    providerScope: plan.providerScope,
    artifact,
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, nonceByte)),
  });
  const receipt = createDeploymentArtifactStageReceipt({
    intent,
    object: {
      bucketName: intent.object.bucketName,
      key: intent.object.key,
      versionId,
      contentLength: artifact.size,
      checksum: artifact.byteDigest,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD',
    },
  });
  return { artifact, intent, receipt };
}

/** @returns {{plan: Readonly<Record<string, any>>, head: Readonly<Record<string, any>>, planEnvelopeBytes: number, headEnvelopeBytes: number}} */
function makeMaximumDocuments() {
  const { profile, plan: basePlan } = makeDocuments();
  const providerResourceId = 'R'.repeat(
    DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
  );
  const plan = createDeploymentPlan(
    {
      operation: 'reconcile',
      deploymentRevision: basePlan.deploymentRevision,
      providerScope: basePlan.providerScope,
      providerSpec: basePlan.providerSpec,
      deploymentInstanceId: basePlan.deploymentInstanceId,
      incarnationId: basePlan.incarnationId,
      basis: {
        headGeneration: 1,
        settledDeploymentRevisionId:
          basePlan.deploymentRevision.deploymentRevisionId,
        inspectionId: basePlan.basis.inspectionId,
      },
      actions: AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
        (
          /** @type {Readonly<Record<string, any>>} */ resource,
          /** @type {number} */ index,
        ) => ({
          resourceKey: resource.resourceKey,
          capability: resource.capability,
          role: resource.role,
          management: 'managed',
          ownershipMode: resource.ownershipMode,
          dependsOn: resource.dependsOn,
          onDestroy: resource.onDestroy,
          action: 'update',
          destructive: false,
          reason: 'drift',
          before: {
            providerType: resource.providerType,
            providerResourceId,
            stateDigest: digest(`max-resource-before-${index}`),
          },
          after: {
            providerType: resource.providerType,
            providerResourceId,
            stateDigest: digest(`max-resource-after-${index}`),
          },
        }),
      ),
    },
    { profile },
  );
  const nonces = plan.actions.map(
    (/** @type {Record<string, any>} */ _action, /** @type {number} */ index) =>
      createOwnershipNonce(Buffer.alloc(64, index + 1)),
  );
  /** @type {Map<string, Readonly<Record<string, any>>>} */
  const bindingByResourceKey = new Map();
  const bindings = plan.actions.map(
    (
      /** @type {Record<string, any>} */ action,
      /** @type {number} */ index,
    ) => {
      const binding = createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: plan.deploymentInstanceId,
        incarnationId: plan.incarnationId,
        resourceKey: action.resourceKey,
        capability: action.capability,
        role: action.role,
        management: 'managed',
        ownershipMode: action.ownershipMode,
        onDestroy: action.onDestroy,
        dependencyBindings: action.dependsOn.map(
          (/** @type {string} */ resourceKey) => {
            const dependency = bindingByResourceKey.get(resourceKey);
            if (dependency === undefined) {
              throw new Error(`Missing graph dependency '${resourceKey}'.`);
            }
            return {
              resourceKey,
              bindingId: dependency.bindingId,
            };
          },
        ),
        providerType: action.after.providerType,
        providerResourceId: action.after.providerResourceId,
        providerScopeId: plan.providerScope.providerScopeId,
        ownershipNonce: nonces[index],
        createdByActionId: action.actionId,
      });
      bindingByResourceKey.set(binding.resourceKey, binding);
      return binding;
    },
  );
  const head = createDeploymentHead({
    deploymentInstanceId: plan.deploymentInstanceId,
    providerScope: plan.providerScope,
    incarnationId: plan.incarnationId,
    generation: 1,
    phase: 'READY',
    settledDeploymentRevisionId: plan.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: plan.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'reconcile',
      planId: plan.planId,
      intents: plan.actions.map(
        (
          /** @type {Record<string, any>} */ action,
          /** @type {number} */ index,
        ) => ({
          actionId: action.actionId,
          status: 'settled',
          ownershipNonce: nonces[index],
        }),
      ),
    },
  });
  const planEnvelopeBytes = Buffer.byteLength(
    JSON.stringify({
      record_key: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.plan}${plan.planId}`,
      storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
      record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.plan,
      document_id: plan.planId,
      document: plan,
    }),
    'utf8',
  );
  const headEnvelopeBytes = Buffer.byteLength(
    JSON.stringify({
      record_key: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.head}${head.deploymentInstanceId}`,
      storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
      record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.head,
      document_id: head.headId,
      document: head,
    }),
    'utf8',
  );
  return { plan, head, planEnvelopeBytes, headEnvelopeBytes };
}

/** @param {Readonly<Record<string, any>>} head @returns {Readonly<Record<string, any>>} */
function blockHead(head) {
  return createDeploymentHead({
    deploymentInstanceId: head.deploymentInstanceId,
    providerScope: head.providerScope,
    incarnationId: head.incarnationId,
    generation: head.generation + 1,
    phase: head.phase,
    settledDeploymentRevisionId: head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: head.targetDeploymentRevisionId,
    resourceBindings: head.resourceBindings,
    activeOperation: { ...head.activeOperation, status: 'blocked' },
    lastOperation: head.lastOperation,
  });
}

/**
 * @typedef AdapterHarness
 * @property {import('../../src/core/lib/db/base.js').DBClient} db - Branded portable DB adapter.
 * @property {() => Promise<void>} cleanup - Close the adapter and remove local files.
 */

/** @returns {Promise<AdapterHarness>} */
async function createVanillaHarness() {
  const path = mkdtempSync(join(tmpdir(), 'wharfie-control-store-'));
  const db = await createVanillaDB(path);
  return {
    db,
    async cleanup() {
      await db.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}

/** @returns {Promise<AdapterHarness>} */
async function createDynamoHarness() {
  const { db } = await createMockedDynamoDB({
    tableSchemas: { [TABLE_NAME]: [DEPLOYMENT_CONTROL_RECORD_KEY_NAME] },
  });
  return { db, cleanup: async () => db.close() };
}

/** @type {ReadonlyArray<{name: string, create: () => Promise<AdapterHarness>}>} */
const ADAPTERS = [
  { name: 'vanilla', create: createVanillaHarness },
  { name: 'mocked DynamoDB', create: createDynamoHarness },
];

describe.each(ADAPTERS)('deployment control store on $name', ({ create }) => {
  it('strongly reads and atomically publishes one complete host-activation authority', async () => {
    const harness = await create();
    try {
      /** @type {Array<Record<string, any>>} */
      const reads = [];
      /** @type {Array<Record<string, any>>} */
      const transactions = [];
      const db = {
        ...harness.db,
        async get(/** @type {any} */ params) {
          reads.push(params);
          return await harness.db.get(params);
        },
        async transactionWrite(/** @type {any} */ params) {
          transactions.push(params);
          return await harness.db.transactionWrite(params);
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const fixture = makeFixture();
      const request = createAwsSingleNodeHostActivationRequest(
        fixture.requestContext,
      );

      await expect(
        store.readHostActivationAuthority(fixture.deploymentInstanceId),
      ).resolves.toBeNull();
      await expect(
        store.compareAndSetHead({
          expectedHeadId: null,
          nextHead: fixture.head,
        }),
      ).resolves.toBe(true);
      await expect(
        store.compareAndSetHostActivationAuthority({
          expectedRequest: null,
          nextRequest: request,
          authorizedHead: fixture.head,
        }),
      ).resolves.toBe(true);
      await expect(
        store.readHostActivationAuthority(fixture.deploymentInstanceId),
      ).resolves.toEqual(request);

      expect(
        reads
          .filter((read) =>
            read.keyValue.startsWith(
              DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.hostActivationAuthority,
            ),
          )
          .every((read) => read.consistentRead === true),
      ).toBe(true);
      const publication = transactions.find(
        (transaction) =>
          transaction.putRequests?.[0]?.record?.record_kind ===
          DEPLOYMENT_CONTROL_RECORD_TYPES.hostActivationAuthority,
      );
      expect(publication).toMatchObject({
        tableName: TABLE_NAME,
        conditionChecks: [
          {
            keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
            keyValue: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.head}${fixture.deploymentInstanceId}`,
            conditions: expect.arrayContaining([
              {
                conditionType: 'EQUALS',
                propertyName: 'document_id',
                propertyValue: fixture.head.headId,
              },
            ]),
          },
        ],
        putRequests: [
          {
            keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
            record: {
              record_key: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.hostActivationAuthority}${fixture.deploymentInstanceId}`,
              storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
              record_kind:
                DEPLOYMENT_CONTROL_RECORD_TYPES.hostActivationAuthority,
              document_id: request.requestId,
              document: request,
            },
            conditions: [
              {
                conditionType: 'NOT_EXISTS',
                propertyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
              },
            ],
          },
        ],
      });
    } finally {
      await harness.cleanup();
    }
  });

  it('leaves no authority record when the exact authorizing head lost its transaction condition', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const fixture = makeFixture();
      const request = createAwsSingleNodeHostActivationRequest(
        fixture.requestContext,
      );
      await store.compareAndSetHead({
        expectedHeadId: null,
        nextHead: fixture.head,
      });
      await store.compareAndSetHead({
        expectedHeadId: fixture.head.headId,
        nextHead: fixture.readyHead,
      });

      await expect(
        store.compareAndSetHostActivationAuthority({
          expectedRequest: null,
          nextRequest: request,
          authorizedHead: fixture.head,
        }),
      ).resolves.toBe(false);
      await expect(
        store.readHostActivationAuthority(fixture.deploymentInstanceId),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it('replaces an earlier operation by exact predecessor and rejects a stale predecessor without changing the winner', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const fixture = makeFixture();
      const reconcile = makeReconcileFixture(fixture);
      const initialRequest = createAwsSingleNodeHostActivationRequest(
        fixture.requestContext,
      );
      const reconcileRequest = createAwsSingleNodeHostActivationRequest(
        reconcile.requestContext,
      );
      await store.compareAndSetHead({
        expectedHeadId: null,
        nextHead: fixture.head,
      });
      await store.compareAndSetHostActivationAuthority({
        expectedRequest: null,
        nextRequest: initialRequest,
        authorizedHead: fixture.head,
      });
      await store.compareAndSetHead({
        expectedHeadId: fixture.head.headId,
        nextHead: fixture.readyHead,
      });
      await store.compareAndSetHead({
        expectedHeadId: fixture.readyHead.headId,
        nextHead: reconcile.head,
      });

      await expect(
        store.compareAndSetHostActivationAuthority({
          expectedRequest: initialRequest,
          nextRequest: reconcileRequest,
          authorizedHead: reconcile.head,
        }),
      ).resolves.toBe(true);
      await expect(
        store.readHostActivationAuthority(fixture.deploymentInstanceId),
      ).resolves.toEqual(reconcileRequest);

      await expect(
        store.compareAndSetHostActivationAuthority({
          expectedRequest: initialRequest,
          nextRequest: reconcileRequest,
          authorizedHead: reconcile.head,
        }),
      ).resolves.toBe(false);
      await expect(
        store.readHostActivationAuthority(fixture.deploymentInstanceId),
      ).resolves.toEqual(reconcileRequest);
    } finally {
      await harness.cleanup();
    }
  });

  it('stores and strongly validates immutable profiles and plans', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const { profile, plan } = makeDocuments();

      expect(await store.readProfile(profile.profileRevisionId)).toBeNull();
      expect(await store.readPlan(plan.planId)).toBeNull();
      await expect(store.putProfileIfAbsent(profile)).resolves.toBe(true);
      await expect(store.putPlanIfAbsent(plan)).resolves.toBe(true);

      const storedProfile = await store.readProfile(profile.profileRevisionId);
      const storedPlan = await store.readPlan(plan.planId);
      expect(storedProfile).toEqual(profile);
      expect(storedPlan).toEqual(plan);
      expect(storedProfile).not.toBe(profile);
      expect(storedPlan).not.toBe(plan);
      expect(Object.isFrozen(storedProfile)).toBe(true);
      expect(Object.isFrozen(storedPlan)).toBe(true);
      expect(Object.isFrozen(storedPlan.actions)).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('stores immutable artifact-stage intent and receipt envelopes with strong reads', async () => {
    const harness = await create();
    try {
      /** @type {Array<Record<string, any>>} */
      const reads = [];
      const db = {
        ...harness.db,
        async get(/** @type {any} */ params) {
          reads.push(params);
          return await harness.db.get(params);
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const { artifact, intent, receipt } = makeArtifactStageDocuments();
      const intentKey = `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.artifactStageIntent}${intent.providerScope.providerScopeId}/${artifact.artifactId}`;
      const receiptKey = `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.artifactStageReceipt}${intent.stageIntentId}`;

      expect(DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageIntent).toBe(
        'deployment-artifact-stage-intent',
      );
      expect(DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt).toBe(
        'deployment-artifact-stage-receipt',
      );
      expect(DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.artifactStageIntent).toBe(
        'artifact-stage-intent/v1/',
      );
      expect(DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.artifactStageReceipt).toBe(
        'artifact-stage-receipt/v1/',
      );
      await expect(
        store.readArtifactStageIntent(
          intent.providerScope.providerScopeId,
          artifact.artifactId,
        ),
      ).resolves.toBeNull();
      await expect(
        store.readArtifactStageReceipt(intent),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);

      await expect(store.putArtifactStageIntentIfAbsent(intent)).resolves.toBe(
        true,
      );
      await expect(store.readArtifactStageReceipt(intent)).resolves.toBeNull();
      await expect(
        store.putArtifactStageReceiptIfAbsent(intent, receipt),
      ).resolves.toBe(true);
      const storedIntent = await store.readArtifactStageIntent(
        intent.providerScope.providerScopeId,
        artifact.artifactId,
      );
      const storedReceipt = await store.readArtifactStageReceipt(intent);

      expect(storedIntent).toEqual(intent);
      expect(storedReceipt).toEqual(receipt);
      expect(storedIntent).not.toBe(intent);
      expect(storedReceipt).not.toBe(receipt);
      expect(Object.isFrozen(storedIntent)).toBe(true);
      expect(Object.isFrozen(storedReceipt)).toBe(true);
      expect(reads.every((read) => read.consistentRead === true)).toBe(true);

      await expect(
        store.putArtifactStageIntentIfAbsent(clone(intent)),
      ).resolves.toBe(false);
      await expect(
        store.putArtifactStageReceiptIfAbsent(clone(intent), clone(receipt)),
      ).resolves.toBe(false);

      await expect(
        harness.db.get({
          tableName: TABLE_NAME,
          keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
          keyValue: intentKey,
          consistentRead: true,
        }),
      ).resolves.toEqual({
        record_key: intentKey,
        storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
        record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageIntent,
        document_id: intent.stageIntentId,
        document: intent,
      });
      await expect(
        harness.db.get({
          tableName: TABLE_NAME,
          keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
          keyValue: receiptKey,
          consistentRead: true,
        }),
      ).resolves.toEqual({
        record_key: receiptKey,
        storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
        record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt,
        document_id: receipt.stageReceiptId,
        document: receipt,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses orphan and context-mismatched artifact-stage receipts before writing', async () => {
    const harness = await create();
    try {
      let receiptWrites = 0;
      const db = {
        ...harness.db,
        async transactionWrite(/** @type {any} */ params) {
          if (
            params.putRequests?.[0]?.record?.record_kind ===
            DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt
          ) {
            receiptWrites += 1;
          }
          return await harness.db.transactionWrite(params);
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const expected = makeArtifactStageDocuments();
      const mismatched = makeArtifactStageDocuments(
        'control store artifact',
        24,
      );

      expect(
        validateDeploymentArtifactStageReceipt(mismatched.receipt),
      ).toEqual(mismatched.receipt);
      await expect(
        store.putArtifactStageReceiptIfAbsent(
          expected.intent,
          expected.receipt,
        ),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      await expect(
        store.readArtifactStageReceipt(expected.intent),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      expect(receiptWrites).toBe(0);

      await store.putArtifactStageIntentIfAbsent(expected.intent);
      await expect(
        store.putArtifactStageReceiptIfAbsent(
          expected.intent,
          mismatched.receipt,
        ),
      ).rejects.toThrow(/stageIntentId does not match context/);
      expect(receiptWrites).toBe(0);
      await expect(
        store.readArtifactStageReceipt(expected.intent),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it('requires the supplied artifact-stage intent to exactly equal the persisted intent', async () => {
    const harness = await create();
    try {
      let receiptWrites = 0;
      const db = {
        ...harness.db,
        async transactionWrite(/** @type {any} */ params) {
          if (
            params.putRequests?.[0]?.record?.record_kind ===
            DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt
          ) {
            receiptWrites += 1;
          }
          return await harness.db.transactionWrite(params);
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const persisted = makeArtifactStageDocuments();
      const supplied = makeArtifactStageDocuments('control store artifact', 24);
      expect(supplied.artifact).toEqual(persisted.artifact);
      expect(supplied.intent.stageIntentId).not.toBe(
        persisted.intent.stageIntentId,
      );

      await store.putArtifactStageIntentIfAbsent(persisted.intent);
      await expect(
        store.putArtifactStageReceiptIfAbsent(
          supplied.intent,
          supplied.receipt,
        ),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      expect(receiptWrites).toBe(0);
      await expect(
        store.readArtifactStageReceipt(supplied.intent),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects artifact-stage identity collisions with different immutable content', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const first = makeArtifactStageDocuments();
      const competing = makeArtifactStageDocuments(
        'control store artifact',
        24,
      );
      const competingReceipt = createDeploymentArtifactStageReceipt({
        intent: first.intent,
        object: {
          ...clone(first.receipt.object),
          versionId: 'stage-version-2',
        },
      });

      expect(competing.intent.stageIntentId).not.toBe(
        first.intent.stageIntentId,
      );
      expect(competingReceipt.stageReceiptId).not.toBe(
        first.receipt.stageReceiptId,
      );
      await store.putArtifactStageIntentIfAbsent(first.intent);
      await store.putArtifactStageReceiptIfAbsent(first.intent, first.receipt);

      await expect(
        store.putArtifactStageIntentIfAbsent(competing.intent),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      await expect(
        store.putArtifactStageReceiptIfAbsent(first.intent, competingReceipt),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      expect(
        await store.readArtifactStageIntent(
          first.intent.providerScope.providerScopeId,
          first.artifact.artifactId,
        ),
      ).toEqual(first.intent);
      expect(await store.readArtifactStageReceipt(first.intent)).toEqual(
        first.receipt,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('fails closed for malformed and cross-key artifact-stage records', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const requested = makeArtifactStageDocuments();
      const other = makeArtifactStageDocuments('different artifact bytes', 31);
      const intentKey = `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.artifactStageIntent}${requested.intent.providerScope.providerScopeId}/${requested.artifact.artifactId}`;
      const receiptKey = `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.artifactStageReceipt}${requested.intent.stageIntentId}`;

      await store.putArtifactStageIntentIfAbsent(requested.intent);
      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: receiptKey,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt,
          document_id: other.receipt.stageReceiptId,
          document: other.receipt,
        },
      });

      await expect(
        store.readArtifactStageIntent(
          requested.intent.providerScope.providerScopeId,
          requested.artifact.artifactId,
        ),
      ).resolves.toEqual(requested.intent);
      await expect(
        store.readArtifactStageReceipt(requested.intent),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);

      const contextMismatchedPayload = {
        schemaVersion: requested.receipt.schemaVersion,
        kind: requested.receipt.kind,
        stageIntentId: requested.intent.stageIntentId,
        artifactId: other.receipt.artifactId,
        object: other.receipt.object,
      };
      const contextMismatchedReceipt = {
        ...contextMismatchedPayload,
        stageReceiptId: createCanonicalJsonSha256Id({
          domain: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
          prefix: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
          value: contextMismatchedPayload,
        }),
      };
      expect(
        validateDeploymentArtifactStageReceipt(contextMismatchedReceipt),
      ).toEqual(contextMismatchedReceipt);
      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: receiptKey,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt,
          document_id: contextMismatchedReceipt.stageReceiptId,
          document: contextMismatchedReceipt,
        },
      });
      await expect(
        store.readArtifactStageReceipt(requested.intent),
      ).rejects.toMatchObject({
        name: 'DeploymentControlStoreIntegrityError',
        cause: expect.objectContaining({
          message: expect.stringContaining('artifactId does not match context'),
        }),
      });

      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: intentKey,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageIntent,
          document_id: other.intent.stageIntentId,
          document: other.intent,
        },
      });
      await expect(
        store.readArtifactStageIntent(
          requested.intent.providerScope.providerScopeId,
          requested.artifact.artifactId,
        ),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      await expect(
        store.readArtifactStageReceipt(requested.intent),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);

      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: intentKey,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageIntent,
          document_id: requested.intent.stageIntentId,
          document: requested.intent,
          unsupported: true,
        },
      });
      await expect(
        store.readArtifactStageIntent(
          requested.intent.providerScope.providerScopeId,
          requested.artifact.artifactId,
        ),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
      await expect(
        store.readArtifactStageIntent(
          'wps1_not-a-canonical-identity',
          requested.artifact.artifactId,
        ),
      ).rejects.toThrow(/canonical wps1/);
      await expect(
        store.readArtifactStageReceipt('wsi1_not-a-canonical-identity'),
      ).rejects.toThrow(/must be a JSON object/);
    } finally {
      await harness.cleanup();
    }
  });

  it('propagates artifact-stage receipt response loss and converges on exact replay', async () => {
    const harness = await create();
    try {
      const ambiguous = new Error('artifact receipt outcome is ambiguous');
      let loseReceiptResponse = true;
      const db = {
        ...harness.db,
        async transactionWrite(/** @type {any} */ params) {
          const result = await harness.db.transactionWrite(params);
          if (
            loseReceiptResponse &&
            params.putRequests?.[0]?.record?.record_kind ===
              DEPLOYMENT_CONTROL_RECORD_TYPES.artifactStageReceipt
          ) {
            loseReceiptResponse = false;
            throw ambiguous;
          }
          return result;
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const { intent, receipt } = makeArtifactStageDocuments();
      await store.putArtifactStageIntentIfAbsent(intent);

      await expect(
        store.putArtifactStageReceiptIfAbsent(intent, receipt),
      ).rejects.toBe(ambiguous);
      await expect(store.readArtifactStageReceipt(intent)).resolves.toEqual(
        receipt,
      );
      await expect(
        store.putArtifactStageReceiptIfAbsent(clone(intent), clone(receipt)),
      ).resolves.toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it('stores complete 18-role graph envelopes with maximum provider IDs below the byte limit', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const { plan, head, planEnvelopeBytes, headEnvelopeBytes } =
        makeMaximumDocuments();

      expect(plan.actions).toHaveLength(18);
      expect(head.resourceBindings).toHaveLength(18);
      expect(plan.planId).toMatch(/^wpl3_[A-Za-z0-9_-]{43}$/);
      expect(plan.basis.inspectionId).toMatch(/^win6_[A-Za-z0-9_-]{43}$/);
      expect(head.headId).toMatch(/^wdh2_[A-Za-z0-9_-]{43}$/);
      expect(head.lastOperation.operationId).toMatch(
        /^wdo2_[A-Za-z0-9_-]{43}$/,
      );
      expect(
        plan.actions.every(
          (/** @type {Record<string, any>} */ action) =>
            /^wda3_[A-Za-z0-9_-]{43}$/.test(action.actionId) &&
            action.before.providerResourceId.length ===
              DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES &&
            action.after.providerResourceId.length ===
              DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
        ),
      ).toBe(true);
      expect(
        head.resourceBindings.every(
          (/** @type {Record<string, any>} */ binding) =>
            /^wrb2_[A-Za-z0-9_-]{43}$/.test(binding.bindingId) &&
            binding.providerResourceId.length ===
              DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
        ),
      ).toBe(true);
      expect(
        head.resourceBindings.every(
          (/** @type {Record<string, any>} */ binding) => {
            const resource = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.find(
              (/** @type {Readonly<Record<string, any>>} */ candidate) =>
                candidate.resourceKey === binding.resourceKey,
            );
            return (
              resource !== undefined &&
              binding.dependencyBindings.length === resource.dependsOn.length &&
              binding.dependencyBindings.every(
                (/** @type {Readonly<Record<string, any>>} */ dependency) =>
                  resource.dependsOn.includes(dependency.resourceKey),
              )
            );
          },
        ),
      ).toBe(true);
      expect(planEnvelopeBytes).toBeLessThan(
        DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
      );
      expect(headEnvelopeBytes).toBeLessThan(
        DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
      );

      await expect(store.putPlanIfAbsent(plan)).resolves.toBe(true);
      await expect(
        store.compareAndSetHead({ expectedHeadId: null, nextHead: head }),
      ).resolves.toBe(true);
      expect(await store.readPlan(plan.planId)).toEqual(plan);
      expect(await store.readHead(head.deploymentInstanceId)).toEqual(head);
    } finally {
      await harness.cleanup();
    }
  });

  it('creates an initial head and rejects a stale CAS without changing it', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const { head } = makeDocuments();
      const successor = blockHead(head);

      await expect(
        store.compareAndSetHead({ expectedHeadId: null, nextHead: head }),
      ).resolves.toBe(true);
      await expect(
        store.compareAndSetHead({
          expectedHeadId: successor.headId,
          nextHead: successor,
        }),
      ).resolves.toBe(false);
      expect(await store.readHead(head.deploymentInstanceId)).toEqual(head);

      await expect(
        store.compareAndSetHead({
          expectedHeadId: head.headId,
          nextHead: successor,
        }),
      ).resolves.toBe(true);
      expect(await store.readHead(head.deploymentInstanceId)).toEqual(
        successor,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('fails closed for wrong document types and malformed stored records', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const { profile, plan, head } = makeDocuments();

      await expect(store.putPlanIfAbsent(profile)).rejects.toThrow();
      await expect(store.putProfileIfAbsent(plan)).rejects.toThrow();
      await expect(
        store.compareAndSetHead({ expectedHeadId: null, nextHead: plan }),
      ).rejects.toThrow();

      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.plan}${plan.planId}`,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.plan,
          document_id: plan.planId,
          document: { ...clone(profile), kind: 'deploymentPlan' },
        },
      });
      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.head}${head.deploymentInstanceId}`,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.head,
          document_id: head.headId,
          document: { ...clone(head), generation: 'not-a-generation' },
        },
      });

      await expect(store.readPlan(plan.planId)).rejects.toBeInstanceOf(
        DeploymentControlStoreIntegrityError,
      );
      await expect(
        store.readHead(head.deploymentInstanceId),
      ).rejects.toBeInstanceOf(DeploymentControlStoreIntegrityError);
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects an oversized stored envelope before document validation', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const oversizedPlanId = semanticId(
        'wpl3',
        'wharfie:test:oversized-plan:v1',
        { plan: 1 },
      );
      await harness.db.put({
        tableName: TABLE_NAME,
        keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
        record: {
          record_key: `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.plan}${oversizedPlanId}`,
          storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
          record_kind: DEPLOYMENT_CONTROL_RECORD_TYPES.plan,
          document_id: oversizedPlanId,
          document: { bytes: 'x'.repeat(DEPLOYMENT_CONTROL_MAX_RECORD_BYTES) },
        },
      });

      await expect(store.readPlan(oversizedPlanId)).rejects.toMatchObject({
        name: 'DeploymentControlStoreIntegrityError',
        cause: expect.objectContaining({
          message: expect.stringContaining(
            String(DEPLOYMENT_CONTROL_MAX_RECORD_BYTES),
          ),
        }),
      });
    } finally {
      await harness.cleanup();
    }
  });

  it('bounds invalid immutable write input before validation or DB mutation', async () => {
    const harness = await create();
    try {
      let writes = 0;
      const db = {
        ...harness.db,
        async transactionWrite(/** @type {any} */ params) {
          writes += 1;
          return await harness.db.transactionWrite(params);
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const oversizedInvalidDocument = {
        invalid: {
          nested: {
            bytes: 'x'.repeat(DEPLOYMENT_CONTROL_MAX_RECORD_BYTES),
          },
        },
      };

      await expect(
        store.putPlanIfAbsent(oversizedInvalidDocument),
      ).rejects.toThrow(
        `encoded JSON must not exceed ${DEPLOYMENT_CONTROL_MAX_RECORD_BYTES} bytes`,
      );
      await expect(
        store.putProfileIfAbsent(oversizedInvalidDocument),
      ).rejects.toThrow(
        `encoded JSON must not exceed ${DEPLOYMENT_CONTROL_MAX_RECORD_BYTES} bytes`,
      );
      expect(writes).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('bounds an invalid CAS successor before attempting the transaction', async () => {
    const harness = await create();
    try {
      let writes = 0;
      const db = {
        ...harness.db,
        async transactionWrite(/** @type {any} */ params) {
          writes += 1;
          return await harness.db.transactionWrite(params);
        },
      };
      const store = createDeploymentControlStore({ db, tableName: TABLE_NAME });
      const oversizedInvalidHead = {
        invalid: {
          nested: {
            bytes: 'x'.repeat(DEPLOYMENT_CONTROL_MAX_RECORD_BYTES),
          },
        },
      };

      await expect(
        store.compareAndSetHead({
          expectedHeadId: null,
          nextHead: oversizedInvalidHead,
        }),
      ).rejects.toThrow(
        `encoded JSON must not exceed ${DEPLOYMENT_CONTROL_MAX_RECORD_BYTES} bytes`,
      );
      expect(writes).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('accepts an exact immutable collision only after authoritative readback', async () => {
    const harness = await create();
    try {
      let reads = 0;
      const db = {
        ...harness.db,
        async get(/** @type {any} */ params) {
          reads += 1;
          return await harness.db.get(params);
        },
      };
      const store = createDeploymentControlStore({
        db,
        tableName: TABLE_NAME,
      });
      const { profile, plan } = makeDocuments();
      await store.putProfileIfAbsent(profile);
      await store.putPlanIfAbsent(plan);
      reads = 0;

      await expect(store.putProfileIfAbsent(clone(profile))).resolves.toBe(
        false,
      );
      await expect(store.putPlanIfAbsent(clone(plan))).resolves.toBe(false);
      expect(reads).toBeGreaterThanOrEqual(2);
    } finally {
      await harness.cleanup();
    }
  });

  it('propagates an ambiguous write and leaves exact readback to its caller', async () => {
    const harness = await create();
    try {
      const ambiguous = new Error('adapter outcome is ambiguous');
      let failAfterCommit = true;
      const db = {
        ...harness.db,
        async transactionWrite(/** @type {any} */ params) {
          const result = await harness.db.transactionWrite(params);
          if (failAfterCommit) {
            failAfterCommit = false;
            throw ambiguous;
          }
          return result;
        },
      };
      const store = createDeploymentControlStore({
        db,
        tableName: TABLE_NAME,
      });
      const { head } = makeDocuments();

      await expect(
        store.compareAndSetHead({ expectedHeadId: null, nextHead: head }),
      ).rejects.toBe(ambiguous);
      expect(await store.readHead(head.deploymentInstanceId)).toEqual(head);
      await expect(
        store.compareAndSetHead({ expectedHeadId: null, nextHead: head }),
      ).resolves.toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});
