import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
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
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

const RUNTIME_ROLE_ID = 'AROA1234567890EXAMPLE';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} seed @returns {string} */
function instanceId(seed) {
  return `i-${seed.toString(16).padStart(17, '0')}`;
}

/** @param {number} seed @returns {string} */
function actionId(seed) {
  return semanticId('wda3', 'wharfie:test:health-action:v1', { seed });
}

/** @param {number} seed @param {number} index @returns {string} */
function bindingActionId(seed, index) {
  return semanticId('wda3', 'wharfie:test:health-binding-action:v1', {
    seed,
    index,
  });
}

/** @param {number} seed @returns {string} */
function planId(seed) {
  return semanticId('wpl3', 'wharfie:test:health-plan:v1', { seed });
}

/** @param {number} seed @returns {string} */
function sessionId(seed) {
  return semanticId('wss', 'wharfie:test:health-session:v1', { seed });
}

/** @param {number} seed @returns {string} */
function headId(seed) {
  return semanticId('wdh2', 'wharfie:test:health-head:v1', { seed });
}

/** @param {number} seed @returns {string} */
function operationId(seed) {
  return semanticId('wdo2', 'wharfie:test:health-operation:v1', { seed });
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

/**
 * @param {Readonly<Record<string, any>>} fixture
 * @param {number} [seed]
 * @param {Readonly<string[]>|null} [substrateDependencyKeys]
 * @param {Readonly<Record<string, string>>} [providerTypeOverrides]
 * @returns {Readonly<Record<string, any>>[]}
 */
function makeResourceBindings(
  fixture,
  seed = 1,
  substrateDependencyKeys = null,
  providerTypeOverrides = {},
) {
  /** @type {Readonly<Record<string, any>>[]} */
  const bindings = [];
  for (
    let index = 0;
    index < AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.length;
    index += 1
  ) {
    const resource = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[index];
    const dependencyKeys =
      resource.resourceKey === 'substrate' && substrateDependencyKeys !== null
        ? substrateDependencyKeys
        : resource.dependsOn;
    const dependencyBindings = dependencyKeys
      .map((/** @type {string} */ resourceKey) => {
        const dependency = bindings.find(
          (/** @type {Readonly<Record<string, any>>} */ binding) =>
            binding.resourceKey === resourceKey,
        );
        if (dependency === undefined) {
          throw new Error(
            `Health fixture lacks dependency binding '${resourceKey}'.`,
          );
        }
        return { resourceKey, bindingId: dependency.bindingId };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
    bindings.push(
      createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: fixture.deploymentInstanceId,
        incarnationId: fixture.incarnationId,
        resourceKey: resource.resourceKey,
        capability: resource.capability,
        role: resource.role,
        management: 'managed',
        ownershipMode: resource.ownershipMode,
        onDestroy: resource.onDestroy,
        dependencyBindings,
        providerType:
          providerTypeOverrides[resource.resourceKey] ?? resource.providerType,
        providerResourceId:
          resource.resourceKey === 'substrate'
            ? instanceId(seed)
            : resource.resourceKey === 'runtime-role'
              ? RUNTIME_ROLE_ID
              : `provider-resource-${resource.resourceKey}-${seed}`,
        providerScopeId: fixture.providerScope.providerScopeId,
        ownershipNonce: createOwnershipNonce(
          Buffer.alloc(32, ((seed + index) % 255) + 1),
        ),
        createdByActionId: bindingActionId(seed, index),
      }),
    );
  }
  return bindings;
}

/** @param {Readonly<Record<string, any>>} fixture @param {number} [seed] @param {string} [resourceKey] @returns {Readonly<Record<string, any>>} */
function makeNodeBinding(fixture, seed = 1, resourceKey = 'substrate') {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    resourceKey,
    capability: { kind: 'resident-node', version: 1 },
    role: { kind: 'node', version: 1 },
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: fixture.node.dependencyBindings,
    providerType: 'ec2-instance',
    providerResourceId: instanceId(seed),
    providerScopeId: fixture.providerScope.providerScopeId,
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, seed)),
    createdByActionId: actionId(seed),
  });
}

/** @param {number} seed @param {'create'|'update'|'reconcile'|'destroy'} [kind] @param {Readonly<Record<string, any>>[]|null} [bindings] @returns {Record<string, any>} */
function completedOperation(seed, kind = 'create', bindings = null) {
  return {
    kind,
    planId: planId(seed),
    intents:
      bindings === null
        ? [
            {
              actionId: actionId(seed),
              status: 'settled',
              ownershipNonce: createOwnershipNonce(Buffer.alloc(32, seed)),
            },
          ]
        : bindings.map(
            (/** @type {Readonly<Record<string, any>>} */ binding) => ({
              actionId: binding.createdByActionId,
              status: 'settled',
              ownershipNonce: binding.ownershipNonce,
            }),
          ),
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
  const bindings = makeResourceBindings(base);
  const node = bindings.find(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === 'substrate',
  );
  if (node === undefined) throw new Error('Health fixture lacks substrate.');
  const runtimeRole = bindings.find(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === 'runtime-role',
  );
  if (runtimeRole === undefined) {
    throw new Error('Health fixture lacks runtime role.');
  }
  const head = createDeploymentHead({
    deploymentInstanceId,
    providerScope,
    incarnationId: base.incarnationId,
    generation: 7,
    phase: 'READY',
    settledDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: completedOperation(1, 'create', bindings),
  });
  return Object.freeze({ ...base, bindings, node, runtimeRole, head });
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
    runtimeRoleBindingId: fixture.runtimeRole.bindingId,
    runtimeRoleId: fixture.runtimeRole.providerResourceId,
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
      schemaVersion: 3,
      kind: 'deploymentServiceHealthReceipt',
      receiptId: expect.stringMatching(/^whr3_[A-Za-z0-9_-]{43}$/),
      health: 'healthy',
      nodeBindingId: fixture.node.bindingId,
      nodeProviderResourceId: fixture.node.providerResourceId,
      runtimeRoleBindingId: fixture.runtimeRole.bindingId,
      runtimeRoleId: RUNTIME_ROLE_ID,
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
    const key = `health/v3/${RUNTIME_ROLE_ID}:${fixture.node.providerResourceId}`;

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
    const legacy = { ...clone(receipt), schemaVersion: 2 };
    const legacyReceiptId = {
      ...clone(receipt),
      receiptId: semanticId(
        'whr2',
        'wharfie:deployment-service-health-receipt:v2',
        { legacy: true },
      ),
    };

    expect(() => validateDeploymentServiceHealthReceipt(unsupported)).toThrow(
      /observedAt is not supported/,
    );
    expect(() => validateDeploymentServiceHealthReceipt(changed)).toThrow(
      /receiptId does not match/,
    );
    expect(() => validateDeploymentServiceHealthReceipt(legacy)).toThrow(
      /schemaVersion must be the integer 3/,
    );
    expect(() =>
      validateDeploymentServiceHealthReceipt(legacyReceiptId),
    ).toThrow(/whr3/);
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
    ).toThrow(/nodeProviderResourceId|EC2 instance ID/);
    expect(() =>
      makeReceipt(fixture, { runtimeRoleId: 'not-an-iam-role-id' }),
    ).toThrow(/runtimeRoleId|IAM RoleId/);
    expect(() =>
      makeReceipt(fixture, { runtimeRoleId: 'AIPA1234567890EXAMPLE' }),
    ).toThrow(/runtimeRoleId|IAM RoleId/);
    expect(() =>
      makeReceipt(fixture, { nodeProviderResourceId: 'i-01234567' }),
    ).toThrow(/nodeProviderResourceId|EC2 instance ID/);
    expect(() =>
      makeReceipt(fixture, {
        nodeProviderResourceId: 'i-0123456789ABCDEF0',
      }),
    ).toThrow(/nodeProviderResourceId|EC2 instance ID/);
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
        makeReceipt(fixture, {
          runtimeRoleId: 'AROA0987654321EXAMPLE',
        }),
        context(fixture),
      ),
    ).toThrow(/runtimeRoleId does not match context/);
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, {
          runtimeRoleBindingId: fixture.node.bindingId,
        }),
        context(fixture),
      ),
    ).toThrow(/runtimeRoleBindingId does not match context/);
    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture, { deploymentOperationId: operationId(77) }),
        context(fixture),
      ),
    ).toThrow(/deploymentOperationId is not current non-destroy authority/);
  });

  it.each([
    [
      'missing one',
      [
        'network-subnet',
        'network-default-ipv4-route',
        'network-subnet-route-table-association',
        'network-security-group',
        'runtime-role-policy',
        'runtime-identity',
        'runtime-identity-role-association',
      ],
    ],
    [
      'substituted',
      [
        'application-state',
        'network-subnet',
        'network-default-ipv4-route',
        'network-subnet-route-table-association',
        'network-security-group',
        'runtime-role-policy',
        'runtime-identity',
        'runtime-identity-role-association',
      ],
    ],
  ])(
    'rejects %s substrate dependency lineage even when every reference resolves in the head',
    (_description, dependencyKeys) => {
      const fixture = makeFixture();
      const bindings = makeResourceBindings(fixture, 20, dependencyKeys);
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
        resourceBindings: bindings,
        activeOperation: null,
        lastOperation: completedOperation(20, 'create', bindings),
      });

      expect(() =>
        validateDeploymentServiceHealthReceiptContext(
          makeReceipt(fixture),
          context(fixture, head),
        ),
      ).toThrow(/substrate binding.*exact graph definition/i);
    },
  );

  it('rejects a substrate dependency whose binding resolves but does not match its graph definition', () => {
    const fixture = makeFixture();
    const bindings = makeResourceBindings(fixture, 21, null, {
      artifact: 's3-bucket',
    });
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
      resourceBindings: bindings,
      activeOperation: null,
      lastOperation: completedOperation(21, 'create', bindings),
    });

    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture),
        context(fixture, head),
      ),
    ).toThrow(/graph dependency 'artifact'.*exact graph definition/i);
  });

  it('rejects malformed transitive authority hidden behind valid direct IAM lineage', () => {
    const fixture = makeFixture();
    const bindings = makeResourceBindings(fixture, 22, null, {
      'runtime-role': 'iam-user',
    });
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
      resourceBindings: bindings,
      activeOperation: null,
      lastOperation: completedOperation(22, 'create', bindings),
    });

    expect(() =>
      validateDeploymentServiceHealthReceiptContext(
        makeReceipt(fixture),
        context(fixture, head),
      ),
    ).toThrow(/graph dependency 'runtime-role'.*exact graph definition/i);
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

  it('rejects a second binding for the resident-node role', () => {
    const fixture = makeFixture();
    const second = makeNodeBinding(fixture, 2, 'replacement-node');
    expect(() =>
      createDeploymentHead({
        deploymentInstanceId: fixture.deploymentInstanceId,
        providerScope: fixture.providerScope,
        incarnationId: fixture.incarnationId,
        generation: 8,
        phase: 'READY',
        settledDeploymentRevisionId:
          fixture.deploymentRevision.deploymentRevisionId,
        targetDeploymentRevisionId:
          fixture.deploymentRevision.deploymentRevisionId,
        resourceBindings: [...fixture.bindings, second],
        activeOperation: null,
        lastOperation: completedOperation(2, 'create', [
          ...fixture.bindings,
          second,
        ]),
      }),
    ).toThrow(/bind each capability role at most once/);
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
      resourceBindings: fixture.bindings,
      activeOperation: active,
      lastOperation: completedOperation(1, 'create', fixture.bindings),
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
      resourceBindings: fixture.bindings,
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
      lastOperation: completedOperation(1, 'create', fixture.bindings),
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
        successor(previous, {
          runtimeRoleId: 'AROA0987654321EXAMPLE',
          sequence: 2,
        }),
      ),
    ).toThrow(/runtimeRoleId cannot change/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, {
          runtimeRoleBindingId: fixture.node.bindingId,
          sequence: 2,
        }),
      ),
    ).toThrow(/runtimeRoleBindingId cannot change/);
    expect(() =>
      validateDeploymentServiceHealthReceiptSuccessor(
        previous,
        successor(previous, { ownerGeneration: 3, sequence: 2 }),
      ),
    ).toThrow(/ownerGeneration cannot change within one session/);
  });
});
