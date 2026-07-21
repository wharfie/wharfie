import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_DOMAIN,
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX,
  createDeploymentServiceHealthReceipt,
  getDeploymentServiceHealthObjectKey,
  getDeploymentServiceHealthObjectLocation,
  validateDeploymentServiceHealthReceipt,
  validateDeploymentServiceHealthReceiptContext,
  validateDeploymentServiceHealthReceiptSuccessor,
} from '../../src/core/runtime/deployment-service-health.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} seed @returns {string} */
function actionId(seed) {
  return semanticId('wda2', 'wharfie:test:health-action:v1', { seed });
}

/** @param {number} seed @returns {string} */
function planId(seed) {
  return semanticId('wpl2', 'wharfie:test:health-plan:v1', { seed });
}

/** @param {number} seed @returns {string} */
function sessionId(seed) {
  return semanticId('wss', 'wharfie:test:health-session:v1', { seed });
}

/** @param {number} seed @returns {string} */
function headId(seed) {
  return semanticId('wdh1', 'wharfie:test:health-head:v1', { seed });
}

/** @param {number} seed @returns {string} */
function operationId(seed) {
  return semanticId('wdo1', 'wharfie:test:health-operation:v1', { seed });
}

/** @returns {Readonly<Record<string, any>>} */
function makeProfile() {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'health-demo',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
}

/** @param {Readonly<Record<string, any>>} profile @param {number} [seed] @returns {Readonly<Record<string, any>>} */
function makeDeploymentRevision(profile, seed = 1) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId('wrv1', 'wharfie:test:health-revision:v1', {
      seed,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: `health artifact ${seed}`,
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  return Object.freeze({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
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
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('health bootstrap'),
    runtimeIdentityPolicyDigest: digest('health runtime identity'),
  });
}

/** @param {Readonly<Record<string, any>>} fixture @param {number} [seed] @param {string} [resourceKey] @returns {Readonly<Record<string, any>>} */
function makeNodeBinding(fixture, seed = 1, resourceKey = 'node') {
  return createDeploymentResourceBinding({
    schemaVersion: 1,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    resourceKey,
    capability: { kind: 'resident-node', version: 1 },
    management: 'managed',
    providerType: 'ec2-instance',
    providerResourceId: `i-0123456789abcde${seed}`,
    providerScopeId: fixture.providerScope.providerScopeId,
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, seed)),
    createdByActionId: actionId(seed),
  });
}

/** @param {number} seed @param {'create'|'update'|'reconcile'|'destroy'} [kind] @returns {Record<string, any>} */
function completedOperation(seed, kind = 'create') {
  return {
    kind,
    planId: planId(seed),
    intents: [
      {
        actionId: actionId(seed),
        status: 'settled',
        ownershipNonce: createOwnershipNonce(Buffer.alloc(32, seed)),
      },
    ],
  };
}

/** @returns {Readonly<Record<string, any>>} */
function makeFixture() {
  const profile = makeProfile();
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const providerSpec = makeProviderSpec(profile, providerScope);
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const base = {
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 9)),
  };
  const node = makeNodeBinding(base);
  const head = createDeploymentHead({
    deploymentInstanceId,
    providerScope,
    incarnationId: base.incarnationId,
    generation: 7,
    phase: 'READY',
    settledDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    resourceBindings: [node],
    activeOperation: null,
    lastOperation: completedOperation(1),
  });
  return Object.freeze({ ...base, node, head });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] @returns {Readonly<Record<string, any>>} */
function makeReceipt(fixture, overrides = {}) {
  return createDeploymentServiceHealthReceipt({
    providerScopeId: fixture.providerScope.providerScopeId,
    providerSpecId: fixture.providerSpec.providerSpecId,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    deploymentOperationId: fixture.head.lastOperation.operationId,
    authorizedHeadId: fixture.head.headId,
    authorizedHeadGeneration: fixture.head.generation,
    nodeBindingId: fixture.node.bindingId,
    nodeProviderResourceId: fixture.node.providerResourceId,
    deploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
    appId: fixture.deploymentRevision.appId,
    artifactId: fixture.deploymentRevision.artifactId,
    revisionId: fixture.deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({
      appId: fixture.deploymentRevision.appId,
    }),
    sessionId: sessionId(1),
    lifecycleGeneration: 3,
    ownerGeneration: 4,
    activationRecordVersion: 12,
    activationSelectionGeneration: 2,
    processId: 4242,
    sequence: 1,
    health: 'healthy',
    ...overrides,
  });
}

/** @param {Readonly<Record<string, any>>} receipt @param {Record<string, any>} overrides @returns {Readonly<Record<string, any>>} */
function successor(receipt, overrides) {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    receiptId: _receiptId,
    ...input
  } = clone(receipt);
  return createDeploymentServiceHealthReceipt({ ...input, ...overrides });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Readonly<Record<string, any>>} [head] @param {Readonly<Record<string, any>>} [deploymentRevision] */
function context(
  fixture,
  head = fixture.head,
  deploymentRevision = fixture.deploymentRevision,
) {
  return {
    deploymentRevision,
    profile: fixture.profile,
    providerScope: fixture.providerScope,
    providerSpec: fixture.providerSpec,
    head,
  };
}

describe('deployment service-health receipt', () => {
  it('creates bounded canonical secret-free content-addressed health', () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const { receiptId, ...payload } = receipt;

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: 'deploymentServiceHealthReceipt',
      receiptId: expect.stringMatching(/^whr1_[A-Za-z0-9_-]{43}$/),
      health: 'healthy',
      nodeBindingId: fixture.node.bindingId,
      nodeProviderResourceId: fixture.node.providerResourceId,
      deploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
      sequence: 1,
    });
    expect(receiptId).toBe(
      createCanonicalJsonSha256Id({
        domain: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_DOMAIN,
        prefix: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX,
        value: payload,
      }),
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(validateDeploymentServiceHealthReceipt(clone(receipt))).toEqual(
      receipt,
    );
  });

  it('derives the only current-object key and canonical control bucket', () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const key = `health/v1/${fixture.deploymentInstanceId}/${fixture.incarnationId}/${fixture.node.bindingId}`;

    expect(getDeploymentServiceHealthObjectKey(receipt)).toBe(key);
    const location = getDeploymentServiceHealthObjectLocation(
      fixture.providerScope,
      receipt,
    );
    expect(location).toEqual({
      bucketName: expect.stringMatching(
        /^wharfie-dc-v1-123456789012-[a-f0-9]{20}$/,
      ),
      key,
    });
    expect(Object.isFrozen(location)).toBe(true);
  });

  it('rejects noncanonical fields, identity changes, false health, and invalid local fences', () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const unsupported = { ...clone(receipt), observedAt: 1 };
    const changed = { ...clone(receipt), sequence: 2 };

    expect(() => validateDeploymentServiceHealthReceipt(unsupported)).toThrow(
      /observedAt is not supported/,
    );
    expect(() => validateDeploymentServiceHealthReceipt(changed)).toThrow(
      /receiptId does not match/,
    );
    expect(() => makeReceipt(fixture, { health: 'starting' })).toThrow(
      /health must be 'healthy'/,
    );
    expect(() => makeReceipt(fixture, { processId: 0 })).toThrow(
      /processId must be a positive safe integer/,
    );
    expect(() =>
      makeReceipt(fixture, {
        serviceId: semanticId('wls', 'wharfie:test:other-service:v1', {
          other: true,
        }),
      }),
    ).toThrow(/serviceId must bind its exact appId/);
    expect(() =>
      makeReceipt(fixture, {
        nodeProviderResourceId: 'https://user:password@example.com/node',
      }),
    ).toThrow(/credential-bearing URLs/);
  });

  it('binds exact scope, specification, head, node, revision, and resident service authority', () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);

    expect(
      validateDeploymentServiceHealthReceiptContext(
        clone(receipt),
        context(fixture),
      ),
    ).toEqual(receipt);
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, {
          nodeProviderResourceId: 'i-0fedcba9876543210',
        }),
        context(fixture),
      ),
    ).toThrow(/nodeProviderResourceId does not match context/);
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, { deploymentOperationId: operationId(77) }),
        context(fixture),
      ),
    ).toThrow(/deploymentOperationId is not current non-destroy authority/);
  });

  it('accepts an older head authorization only while current lineage retains its operation', () => {
    const fixture = makeFixture();
    const older = makeReceipt(fixture, {
      authorizedHeadId: headId(6),
      authorizedHeadGeneration: 6,
    });

    expect(
      validateDeploymentServiceHealthReceiptContext(older, context(fixture)),
    ).toEqual(older);
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, { authorizedHeadId: headId(7) }),
        context(fixture),
      ),
    ).toThrow(/authorizedHeadId must equal the current head/);
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, { authorizedHeadGeneration: 8 }),
        context(fixture),
      ),
    ).toThrow(/cannot exceed the current head generation/);
  });

  it('requires exactly one profile-conforming resident-node binding', () => {
    const fixture = makeFixture();
    const second = makeNodeBinding(fixture, 2, 'replacement-node');
    const head = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: fixture.incarnationId,
      generation: 8,
      phase: 'READY',
      settledDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      targetDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      resourceBindings: [fixture.node, second],
      activeOperation: null,
      lastOperation: completedOperation(1),
    });

    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, {
          authorizedHeadId: head.headId,
          authorizedHeadGeneration: head.generation,
        }),
        context(fixture, head),
      ),
    ).toThrow(/exactly one resident-node binding/);
  });

  it('allows target and settled non-destroy lineage but rejects destroy authority', () => {
    const fixture = makeFixture();
    const activeAction = actionId(3);
    const active = {
      kind: 'reconcile',
      planId: planId(3),
      status: 'running',
      nextActionIndex: 0,
      intents: [
        {
          actionId: activeAction,
          status: 'pending',
          ownershipNonce: null,
        },
      ],
    };
    const reconciling = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: fixture.incarnationId,
      generation: 8,
      phase: 'CONVERGING',
      settledDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      targetDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      resourceBindings: [fixture.node],
      activeOperation: active,
      lastOperation: completedOperation(1),
    });
    const activeReceipt = makeReceipt(fixture, {
      deploymentOperationId: reconciling.activeOperation.operationId,
      authorizedHeadId: reconciling.headId,
      authorizedHeadGeneration: reconciling.generation,
    });
    const settledReceipt = makeReceipt(fixture, {
      authorizedHeadId: reconciling.headId,
      authorizedHeadGeneration: reconciling.generation,
    });

    expect(
      validateDeploymentServiceHealthReceiptContext(
        activeReceipt,
        context(fixture, reconciling),
      ),
    ).toEqual(activeReceipt);
    expect(
      validateDeploymentServiceHealthReceiptContext(
        settledReceipt,
        context(fixture, reconciling),
      ),
    ).toEqual(settledReceipt);

    const destroying = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: fixture.incarnationId,
      generation: 9,
      phase: 'DESTROYING',
      settledDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      targetDeploymentRevisionId: null,
      resourceBindings: [fixture.node],
      activeOperation: {
        kind: 'destroy',
        planId: planId(4),
        status: 'running',
        nextActionIndex: 0,
        intents: [
          {
            actionId: actionId(4),
            status: 'pending',
            ownershipNonce: null,
          },
        ],
      },
      lastOperation: completedOperation(1),
    });
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        settledReceipt,
        context(fixture, destroying),
      ),
    ).toThrow(/cannot authorize health during destroy/);
  });
});

describe('deployment service-health successors', () => {
  it('requires the exact next sequence and stable lifecycle/process within one session', () => {
    const previous = makeReceipt(makeFixture());
    const next = successor(previous, {
      sequence: 2,
      activationRecordVersion: 13,
    });

    expect(
      validateDeploymentServiceHealthReceiptSuccessor(previous, next),
    ).toEqual(next);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { sequence: 3 }),
      ),
    ).toThrow(/exact next safe integer/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { sequence: 2, ownerGeneration: 5 }),
      ),
    ).toThrow(/ownerGeneration cannot change within one session/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { sequence: 2, lifecycleGeneration: 4 }),
      ),
    ).toThrow(/lifecycleGeneration cannot change within one session/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { sequence: 2, processId: 5252 }),
      ),
    ).toThrow(/processId cannot change within one session/);
  });

  it('allows a same-session reconcile only under a newer authorized head', () => {
    const previous = makeReceipt(makeFixture());
    const next = successor(previous, {
      deploymentOperationId: operationId(2),
      authorizedHeadId: headId(8),
      authorizedHeadGeneration: 8,
      sequence: 2,
    });

    expect(
      validateDeploymentServiceHealthReceiptSuccessor(previous, next),
    ).toEqual(next);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          deploymentOperationId: operationId(2),
          sequence: 2,
        }),
      ),
    ).toThrow(/can change only with a newer authorized head generation/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          authorizedHeadId: headId(6),
          authorizedHeadGeneration: 6,
          sequence: 2,
        }),
      ),
    ).toThrow(/authorizedHeadGeneration cannot regress/);
  });

  it('admits a fresh service session only with a newer lifecycle and sequence reset', () => {
    const previous = makeReceipt(makeFixture(), { sequence: 19 });
    const next = successor(previous, {
      sessionId: sessionId(2),
      lifecycleGeneration: 4,
      ownerGeneration: 1,
      processId: 5252,
      sequence: 1,
    });

    expect(
      validateDeploymentServiceHealthReceiptSuccessor(previous, next),
    ).toEqual(next);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          sessionId: sessionId(2),
          lifecycleGeneration: 3,
          sequence: 1,
        }),
      ),
    ).toThrow(/lifecycleGeneration must increase for a new session/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          sessionId: sessionId(2),
          lifecycleGeneration: 4,
          sequence: 20,
        }),
      ),
    ).toThrow(/sequence must restart at 1/);
  });

  it('requires a distinct content-addressed head when head generation advances', () => {
    const previous = makeReceipt(makeFixture());

    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          authorizedHeadGeneration: previous.authorizedHeadGeneration + 1,
          sequence: 2,
        }),
      ),
    ).toThrow(/authorizedHeadId must change with a newer head generation/);
  });

  it('requires the complete new operation, head, activation, and session fence for an update', () => {
    const fixture = makeFixture();
    const previous = makeReceipt(fixture, { sequence: 9 });
    const revision = makeDeploymentRevision(fixture.profile, 2);
    const update = {
      deploymentRevisionId: revision.deploymentRevisionId,
      artifactId: revision.artifactId,
      revisionId: revision.revisionId,
      deploymentOperationId: operationId(2),
      authorizedHeadId: headId(8),
      authorizedHeadGeneration: 8,
      sessionId: sessionId(2),
      lifecycleGeneration: 4,
      ownerGeneration: 5,
      activationRecordVersion: 13,
      activationSelectionGeneration: 3,
      processId: 5252,
      sequence: 1,
    };
    const next = successor(previous, update);

    expect(
      validateDeploymentServiceHealthReceiptSuccessor(previous, next),
    ).toEqual(next);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { ...update, sessionId: previous.sessionId }),
      ),
    ).toThrow(/sessionId must change with deployed revision authority/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          ...update,
          activationSelectionGeneration: previous.activationSelectionGeneration,
        }),
      ),
    ).toThrow(/strictly newer activation record and selection generations/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          ...update,
          deploymentOperationId: previous.deploymentOperationId,
        }),
      ),
    ).toThrow(/deploymentOperationId must change/);
  });

  it('rejects scope, node, and same-session owner changes from an old writer', () => {
    const fixture = makeFixture();
    const previous = makeReceipt(fixture);

    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          nodeProviderResourceId: 'i-0fedcba9876543210',
          sequence: 2,
        }),
      ),
    ).toThrow(/nodeProviderResourceId cannot change/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { ownerGeneration: 3, sequence: 2 }),
      ),
    ).toThrow(/ownerGeneration cannot change within one session/);
  });
});
