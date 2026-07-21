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
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import {
  createDeploymentPlan,
  DEPLOYMENT_ACTION_ID_DOMAIN,
  DEPLOYMENT_PLAN_ID_DOMAIN,
  DEPLOYMENT_PLAN_ID_PREFIX,
  validateDeploymentPlan,
} from '../../src/core/runtime/deployment-plan.js';
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
  DEPLOYMENT_ACTION_ID_PREFIX,
  DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
} from '../../src/core/runtime/deployment-resource-binding.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

const TABLE_NAME = 'deployment-control';

const RESOURCES = Object.freeze([
  ['substrate', 'resident-node', 'ec2-instance'],
  ['application-state', 'application-state', 'ebs-volume'],
  ['control-state', 'control-state', 'ebs-volume'],
  ['artifact', 'artifact-storage', 's3-object'],
  ['runtime-identity', 'runtime-identity', 'instance-profile'],
  ['network', 'networking', 'vpc'],
]);

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
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 17));
  const plan = createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision,
      providerScope,
      deploymentInstanceId,
      incarnationId,
      basis: {
        headGeneration: 0,
        settledDeploymentRevisionId: null,
        inspectionId: semanticId(
          'win1',
          'wharfie:test:deployment-inspection:v1',
          { inspection: 1 },
        ),
      },
      actions: RESOURCES.map(([resourceKey, capability, providerType]) => ({
        resourceKey,
        capability: { kind: capability, version: 1 },
        management: 'managed',
        action: 'create',
        destructive: false,
        reason: 'missing',
        before: null,
        after: {
          providerType,
          providerResourceId: null,
          stateDigest: digest(resourceKey),
        },
      })),
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

/** @returns {{plan: Readonly<Record<string, any>>, head: Readonly<Record<string, any>>, planEnvelopeBytes: number, headEnvelopeBytes: number}} */
function makeMaximumDocuments() {
  const { plan: basePlan } = makeDocuments();
  const operation = 'reconcile';
  const providerResourceId = 'R'.repeat(
    DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
  );
  const actions = Array.from({ length: 16 }, (_unused, index) => {
    const [, capability, providerType] = RESOURCES[index % RESOURCES.length];
    const action = {
      resourceKey: `max-resource-${String(index).padStart(2, '0')}`,
      capability: { kind: capability, version: 1 },
      management: 'managed',
      action: 'update',
      destructive: false,
      reason: 'drift',
      before: {
        providerType,
        providerResourceId,
        stateDigest: digest(`max-resource-before-${index}`),
      },
      after: {
        providerType,
        providerResourceId,
        stateDigest: digest(`max-resource-after-${index}`),
      },
    };
    return {
      ...action,
      actionId: createCanonicalJsonSha256Id({
        domain: DEPLOYMENT_ACTION_ID_DOMAIN,
        prefix: DEPLOYMENT_ACTION_ID_PREFIX,
        value: {
          operation,
          deploymentRevisionId:
            basePlan.deploymentRevision.deploymentRevisionId,
          deploymentInstanceId: basePlan.deploymentInstanceId,
          incarnationId: basePlan.incarnationId,
          action,
        },
      }),
    };
  });
  const planPayload = {
    schemaVersion: 1,
    kind: 'deploymentPlan',
    operation,
    deploymentRevision: basePlan.deploymentRevision,
    providerScope: basePlan.providerScope,
    deploymentInstanceId: basePlan.deploymentInstanceId,
    incarnationId: basePlan.incarnationId,
    basis: {
      headGeneration: 1,
      settledDeploymentRevisionId:
        basePlan.deploymentRevision.deploymentRevisionId,
      inspectionId: basePlan.basis.inspectionId,
    },
    actions,
    summary: {
      create: 0,
      update: 16,
      delete: 0,
      verify: 0,
      noop: 0,
      destructive: false,
    },
  };
  const plan = validateDeploymentPlan({
    ...planPayload,
    planId: createCanonicalJsonSha256Id({
      domain: DEPLOYMENT_PLAN_ID_DOMAIN,
      prefix: DEPLOYMENT_PLAN_ID_PREFIX,
      value: planPayload,
    }),
  });
  const nonces = plan.actions.map(
    (/** @type {Record<string, any>} */ _action, /** @type {number} */ index) =>
      createOwnershipNonce(Buffer.alloc(64, index + 1)),
  );
  const bindings = plan.actions.map(
    (/** @type {Record<string, any>} */ action, /** @type {number} */ index) =>
      createDeploymentResourceBinding({
        schemaVersion: 1,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: plan.deploymentInstanceId,
        incarnationId: plan.incarnationId,
        resourceKey: action.resourceKey,
        capability: action.capability,
        management: 'managed',
        providerType: action.after.providerType,
        providerResourceId: action.after.providerResourceId,
        providerScopeId: plan.providerScope.providerScopeId,
        ownershipNonce: nonces[index],
        createdByActionId: action.actionId,
      }),
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

  it('stores maximum 16-action and 16-binding envelopes below the byte limit', async () => {
    const harness = await create();
    try {
      const store = createDeploymentControlStore({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const { plan, head, planEnvelopeBytes, headEnvelopeBytes } =
        makeMaximumDocuments();

      expect(plan.actions).toHaveLength(16);
      expect(head.resourceBindings).toHaveLength(16);
      expect(
        plan.actions.every(
          (/** @type {Record<string, any>} */ action) =>
            action.before.providerResourceId.length ===
              DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES &&
            action.after.providerResourceId.length ===
              DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
        ),
      ).toBe(true);
      expect(
        head.resourceBindings.every(
          (/** @type {Record<string, any>} */ binding) =>
            binding.providerResourceId.length ===
            DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
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
        'wpl1',
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
