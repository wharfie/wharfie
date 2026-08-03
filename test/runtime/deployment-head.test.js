import { describe, expect, it } from '@jest/globals';

import {
  DEPLOYMENT_HEAD_ID_PREFIX,
  DEPLOYMENT_OPERATION_ID_PREFIX,
  createDeploymentHead,
  getDeploymentOperationId,
  validateDeploymentHead,
} from '../../src/core/runtime/deployment-head.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { DEPLOYMENT_PLAN_ID_PREFIX } from '../../src/core/runtime/deployment-plan.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

const PROVIDER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
});
const DEPLOYMENT_INSTANCE_ID = semanticId(
  'wdi1',
  'wharfie:test:deployment-instance:v1',
  { deployment: 'production' },
);
const INCARNATION_ID = createDeploymentIncarnationId(Buffer.alloc(32, 1));
const SETTLED_REVISION_ID = semanticId(
  'wdr1',
  'wharfie:test:deployment-revision:v1',
  { revision: 1 },
);
const TARGET_REVISION_ID = semanticId(
  'wdr1',
  'wharfie:test:deployment-revision:v1',
  { revision: 2 },
);

/** @param {number} index @returns {string} */
function actionId(index) {
  return semanticId(
    DEPLOYMENT_ACTION_ID_PREFIX,
    'wharfie:test:deployment-action:v3',
    { index },
  );
}

/** @param {string} kind @param {number} index @returns {string} */
function planId(kind, index = 1) {
  return semanticId(DEPLOYMENT_PLAN_ID_PREFIX, 'wharfie:test:deployment-plan', {
    kind,
    index,
  });
}

/** @param {number} index @returns {string} */
function nonce(index) {
  return createOwnershipNonce(Buffer.alloc(32, index));
}

/**
 * @param {string} resourceKey - Logical resource.
 * @param {number} index - Action/nonce seed.
 * @param {Record<string, any>} [overrides] - Exact field overrides.
 * @returns {Readonly<Record<string, any>>} - Exact managed binding.
 */
function binding(resourceKey, index, overrides = {}) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId:
      overrides.deploymentInstanceId || DEPLOYMENT_INSTANCE_ID,
    incarnationId: overrides.incarnationId || INCARNATION_ID,
    resourceKey,
    capability: {
      kind:
        overrides.capabilityKind ||
        (resourceKey === 'artifact' ? 'artifact-storage' : 'resident-node'),
      version: 1,
    },
    role: {
      kind:
        overrides.roleKind || (resourceKey === 'artifact' ? 'object' : 'node'),
      version: 1,
    },
    management: 'managed',
    ownershipMode: overrides.ownershipMode || 'direct',
    onDestroy: overrides.onDestroy || 'purge',
    dependencyBindings: overrides.dependencyBindings || [],
    providerType: resourceKey === 'artifact' ? 's3-object' : 'ec2-instance',
    providerResourceId: `provider-resource-${resourceKey}`,
    providerScopeId:
      overrides.providerScopeId || PROVIDER_SCOPE.providerScopeId,
    ownershipNonce: nonce(index),
    createdByActionId: actionId(index),
  });
}

/**
 * @param {string} resourceKey - Unique external resource address.
 * @param {Record<string, any>} [overrides] - Exact field overrides.
 * @returns {Readonly<Record<string, any>>} - Exact external binding.
 */
function externalBinding(resourceKey, overrides = {}) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
    incarnationId: INCARNATION_ID,
    resourceKey,
    capability: { kind: 'networking', version: 1 },
    role: { kind: overrides.roleKind || resourceKey, version: 1 },
    management: 'external',
    ownershipMode: 'external',
    onDestroy: 'retain',
    dependencyBindings: [],
    providerType: 'external-resource',
    providerResourceId: `provider-resource-${resourceKey}`,
    providerScopeId: PROVIDER_SCOPE.providerScopeId,
  });
}

/**
 * @param {'create'|'update'|'reconcile'|'destroy'} kind - Operation kind.
 * @param {Record<string, any>} [overrides] - Operation overrides.
 * @returns {Record<string, any>} - Operation input without its derived ID.
 */
function operation(kind, overrides = {}) {
  return {
    kind,
    planId: planId(kind),
    status: 'running',
    nextActionIndex: 0,
    intents: [
      {
        actionId: actionId(9),
        status: 'pending',
        ownershipNonce: null,
      },
    ],
    ...overrides,
  };
}

/**
 * @param {'create'|'update'|'reconcile'|'destroy'} kind - Settled operation kind.
 * @param {Record<string, any>} [overrides] - Settlement overrides.
 * @returns {Record<string, any>} - Completed operation input.
 */
function completedOperation(kind, overrides = {}) {
  const active = operation(kind, overrides);
  return {
    kind: active.kind,
    planId: active.planId,
    intents: active.intents.map(
      (/** @type {Record<string, any>} */ intent) => ({
        ...intent,
        status: 'settled',
      }),
    ),
  };
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function createHeadInput(overrides = {}) {
  return {
    deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
    providerScope: PROVIDER_SCOPE,
    incarnationId: INCARNATION_ID,
    generation: 1,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: TARGET_REVISION_ID,
    resourceBindings: [],
    activeOperation: operation('create'),
    lastOperation: null,
    ...overrides,
  };
}

describe('deployment head', () => {
  it('creates a deeply frozen content-addressed head with sorted exact bindings', () => {
    const artifact = binding('artifact', 2);
    const substrate = binding('substrate', 3);
    const head = createDeploymentHead(
      createHeadInput({
        generation: 4,
        resourceBindings: [substrate, artifact],
        activeOperation: operation('create', {
          nextActionIndex: 2,
          intents: [
            {
              actionId: artifact.createdByActionId,
              status: 'settled',
              ownershipNonce: artifact.ownershipNonce,
            },
            {
              actionId: substrate.createdByActionId,
              status: 'settled',
              ownershipNonce: substrate.ownershipNonce,
            },
          ],
        }),
      }),
    );

    expect(head).toMatchObject({
      schemaVersion: 2,
      kind: 'deploymentHead',
      headId: expect.stringMatching(
        new RegExp(`^${DEPLOYMENT_HEAD_ID_PREFIX}_[A-Za-z0-9_-]{43}$`),
      ),
      generation: 4,
      phase: 'CONVERGING',
      activeOperation: {
        operationId: expect.stringMatching(
          new RegExp(`^${DEPLOYMENT_OPERATION_ID_PREFIX}_[A-Za-z0-9_-]{43}$`),
        ),
        kind: 'create',
      },
    });
    expect(
      head.resourceBindings.map(
        (/** @type {Record<string, any>} */ item) => item.resourceKey,
      ),
    ).toEqual(['artifact', 'substrate']);
    expect(validateDeploymentHead(clone(head))).toEqual(head);
    expect(Object.isFrozen(head)).toBe(true);
    expect(Object.isFrozen(head.providerScope)).toBe(true);
    expect(Object.isFrozen(head.resourceBindings)).toBe(true);
    expect(Object.isFrozen(head.activeOperation.intents[0])).toBe(true);
    expect(JSON.stringify(head)).not.toMatch(/createdAt|updatedAt|credential/i);
  });

  it('keeps operation identity stable across progress while changing head identity', () => {
    const first = createDeploymentHead(createHeadInput());
    const completed = createDeploymentHead(
      createHeadInput({
        generation: 2,
        activeOperation: operation('create', {
          nextActionIndex: 1,
          intents: [
            {
              actionId: actionId(9),
              status: 'settled',
              ownershipNonce: null,
            },
          ],
        }),
      }),
    );

    expect(completed.activeOperation.operationId).toBe(
      first.activeOperation.operationId,
    );
    expect(completed.headId).not.toBe(first.headId);
    expect(
      getDeploymentOperationId({
        deploymentInstanceId: first.deploymentInstanceId,
        incarnationId: first.incarnationId,
        kind: first.activeOperation.kind,
        planId: first.activeOperation.planId,
        intents: first.activeOperation.intents,
      }),
    ).toBe(first.activeOperation.operationId);
  });

  it('enforces the complete phase, operation, and revision matrix', () => {
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'READY',
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: SETTLED_REVISION_ID,
          activeOperation: null,
          lastOperation: completedOperation('create'),
        }),
      ),
    ).not.toThrow();
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'CONVERGING',
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: TARGET_REVISION_ID,
          activeOperation: operation('update'),
          lastOperation: completedOperation('create'),
        }),
      ),
    ).not.toThrow();
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'CONVERGING',
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: SETTLED_REVISION_ID,
          activeOperation: operation('reconcile'),
          lastOperation: completedOperation('create'),
        }),
      ),
    ).not.toThrow();
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'DESTROYING',
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: null,
          activeOperation: operation('destroy'),
          lastOperation: completedOperation('create'),
        }),
      ),
    ).not.toThrow();
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'DESTROYED',
          settledDeploymentRevisionId: null,
          targetDeploymentRevisionId: null,
          activeOperation: null,
          lastOperation: completedOperation('destroy'),
          resourceBindings: [binding('artifact', 2, { onDestroy: 'retain' })],
        }),
      ),
    ).not.toThrow();

    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'READY',
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: TARGET_REVISION_ID,
          activeOperation: null,
          lastOperation: completedOperation('create'),
        }),
      ),
    ).toThrow(/READY requires/i);
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: SETTLED_REVISION_ID,
          activeOperation: operation('update'),
          lastOperation: completedOperation('create'),
        }),
      ),
    ).toThrow(/update requires distinct/i);
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'DESTROYING',
          settledDeploymentRevisionId: SETTLED_REVISION_ID,
          targetDeploymentRevisionId: null,
          activeOperation: operation('reconcile'),
          lastOperation: completedOperation('create'),
        }),
      ),
    ).toThrow(/DESTROYING requires a destroy/i);
  });

  it('requires positive generations and exact instance, scope, and incarnation bindings', () => {
    expect(() =>
      createDeploymentHead(createHeadInput({ generation: 0 })),
    ).toThrow(/positive safe integer/i);

    const otherInstance = semanticId(
      'wdi1',
      'wharfie:test:deployment-instance:v1',
      { deployment: 'other' },
    );
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          resourceBindings: [
            binding('artifact', 2, {
              deploymentInstanceId: otherInstance,
            }),
          ],
        }),
      ),
    ).toThrow(/does not match the head instance/i);

    const otherIncarnation = createDeploymentIncarnationId(Buffer.alloc(32, 8));
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          resourceBindings: [
            binding('artifact', 2, { incarnationId: otherIncarnation }),
          ],
        }),
      ),
    ).toThrow(/does not match the head instance/i);

    const otherScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-west-2',
    });
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          resourceBindings: [
            binding('artifact', 2, {
              providerScopeId: otherScope.providerScopeId,
            }),
          ],
        }),
      ),
    ).toThrow(/does not match the head instance/i);
  });

  it('requires a strict ordered intent frontier and unique action ownership', () => {
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          activeOperation: operation('create', {
            nextActionIndex: 1,
            intents: [
              {
                actionId: actionId(1),
                status: 'intended',
                ownershipNonce: nonce(1),
              },
              {
                actionId: actionId(2),
                status: 'settled',
                ownershipNonce: nonce(2),
              },
            ],
          }),
        }),
      ),
    ).toThrow(/exactly separate settled, current, and pending/i);

    expect(() =>
      createDeploymentHead(
        createHeadInput({
          activeOperation: operation('create', {
            intents: [
              {
                actionId: actionId(1),
                status: 'intended',
                ownershipNonce: nonce(1),
              },
              {
                actionId: actionId(1),
                status: 'intended',
                ownershipNonce: nonce(2),
              },
            ],
          }),
        }),
      ),
    ).toThrow(/unique actionId/i);

    expect(() =>
      createDeploymentHead(
        createHeadInput({
          activeOperation: operation('create', {
            intents: [
              {
                actionId: actionId(1),
                status: 'intended',
                ownershipNonce: nonce(1),
              },
              {
                actionId: actionId(2),
                status: 'intended',
                ownershipNonce: nonce(1),
              },
            ],
          }),
        }),
      ),
    ).toThrow(/must not reuse an ownershipNonce/i);

    const finalInspectionBlocked = createDeploymentHead(
      createHeadInput({
        activeOperation: operation('create', {
          status: 'blocked',
          nextActionIndex: 1,
          intents: [
            {
              actionId: actionId(1),
              status: 'settled',
              ownershipNonce: null,
            },
          ],
        }),
      }),
    );
    expect(finalInspectionBlocked.activeOperation?.status).toBe('blocked');
  });

  it('cross-checks settled intent ownership against matching managed bindings', () => {
    const managed = binding('artifact', 2);
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          resourceBindings: [managed],
          activeOperation: operation('create', {
            intents: [
              {
                actionId: managed.createdByActionId,
                status: 'intended',
                ownershipNonce: managed.ownershipNonce,
              },
            ],
          }),
        }),
      ),
    ).toThrow(/settle matching managed binding ownership/i);

    expect(() =>
      createDeploymentHead(
        createHeadInput({
          resourceBindings: [managed],
          activeOperation: operation('create', {
            nextActionIndex: 1,
            intents: [
              {
                actionId: managed.createdByActionId,
                status: 'settled',
                ownershipNonce: nonce(7),
              },
            ],
          }),
        }),
      ),
    ).toThrow(/settle matching managed binding ownership/i);
  });

  it('accepts an exact dependency DAG with a managed direct ownership anchor', () => {
    const network = binding('network', 10, {
      capabilityKind: 'networking',
      roleKind: 'vpc',
    });
    const relationship = binding('network-relationship', 11, {
      capabilityKind: 'networking',
      roleKind: 'attachment',
      ownershipMode: 'derived',
      dependencyBindings: [
        { resourceKey: network.resourceKey, bindingId: network.bindingId },
      ],
    });

    const head = createDeploymentHead(
      createHeadInput({ resourceBindings: [relationship, network] }),
    );

    expect(
      head.resourceBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ item) => item.resourceKey,
      ),
    ).toEqual(['network', 'network-relationship']);
  });

  it('rejects dangling, inexact, duplicate-role, and unanchored dependency lineage', () => {
    const network = binding('network', 12, {
      capabilityKind: 'networking',
      roleKind: 'vpc',
    });
    const other = binding('other-network', 13, {
      capabilityKind: 'networking',
      roleKind: 'subnet',
    });
    const exactReference = {
      resourceKey: network.resourceKey,
      bindingId: network.bindingId,
    };
    const relationship = binding('relationship', 14, {
      capabilityKind: 'networking',
      roleKind: 'attachment',
      ownershipMode: 'derived',
      dependencyBindings: [exactReference],
    });

    expect(() =>
      createDeploymentHead(
        createHeadInput({ resourceBindings: [relationship] }),
      ),
    ).toThrow(/dangling dependency/i);

    const inexactRelationship = binding('inexact-relationship', 15, {
      capabilityKind: 'networking',
      roleKind: 'route',
      ownershipMode: 'derived',
      dependencyBindings: [
        { resourceKey: network.resourceKey, bindingId: other.bindingId },
      ],
    });
    expect(() =>
      createDeploymentHead(
        createHeadInput({
          resourceBindings: [network, other, inexactRelationship],
        }),
      ),
    ).toThrow(/does not reference the exact dependency/i);

    const duplicateRole = binding('duplicate-network', 16, {
      capabilityKind: 'networking',
      roleKind: 'vpc',
    });
    expect(() =>
      createDeploymentHead(
        createHeadInput({ resourceBindings: [network, duplicateRole] }),
      ),
    ).toThrow(/each capability role at most once/i);

    const external = externalBinding('external-network');
    const unanchored = binding('unanchored-relationship', 17, {
      capabilityKind: 'networking',
      roleKind: 'external-association',
      ownershipMode: 'derived',
      dependencyBindings: [
        {
          resourceKey: external.resourceKey,
          bindingId: external.bindingId,
        },
      ],
    });
    expect(() =>
      createDeploymentHead(
        createHeadInput({ resourceBindings: [external, unanchored] }),
      ),
    ).toThrow(/managed direct ownership anchor/i);
  });

  it('protects retained bindings from purge dependencies and destroyed heads from purge bindings', () => {
    const purge = binding('purge-parent', 18, {
      capabilityKind: 'networking',
      roleKind: 'vpc',
      onDestroy: 'purge',
    });
    const retained = binding('retained-child', 19, {
      capabilityKind: 'networking',
      roleKind: 'retained-relationship',
      ownershipMode: 'derived',
      onDestroy: 'retain',
      dependencyBindings: [
        { resourceKey: purge.resourceKey, bindingId: purge.bindingId },
      ],
    });
    expect(() =>
      createDeploymentHead(
        createHeadInput({ resourceBindings: [purge, retained] }),
      ),
    ).toThrow(/retained binding.*cannot depend on purge/i);

    expect(() =>
      createDeploymentHead(
        createHeadInput({
          phase: 'DESTROYED',
          settledDeploymentRevisionId: null,
          targetDeploymentRevisionId: null,
          activeOperation: null,
          lastOperation: completedOperation('destroy'),
          resourceBindings: [purge],
        }),
      ),
    ).toThrow(/DESTROYED can retain only/i);
  });

  it('supports 32 effects and rejects a 33rd binding or intent', () => {
    const bindings = Array.from({ length: 32 }, (_, index) =>
      binding(`resource-${String(index).padStart(2, '0')}`, index + 20, {
        roleKind: `role-${String(index).padStart(2, '0')}`,
      }),
    );
    expect(() =>
      createDeploymentHead(createHeadInput({ resourceBindings: bindings })),
    ).not.toThrow();
    expect(() =>
      createDeploymentHead(
        createHeadInput({ resourceBindings: [...bindings, bindings[0]] }),
      ),
    ).toThrow(/at most 32 bindings/i);

    const intents = Array.from({ length: 32 }, (_, index) => ({
      actionId: actionId(index + 60),
      status: 'pending',
      ownershipNonce: null,
    }));
    expect(() =>
      getDeploymentOperationId({
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        incarnationId: INCARNATION_ID,
        kind: 'create',
        planId: planId('create'),
        intents,
      }),
    ).not.toThrow();
    expect(() =>
      getDeploymentOperationId({
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        incarnationId: INCARNATION_ID,
        kind: 'create',
        planId: planId('create'),
        intents: [...intents, { ...intents[0], actionId: actionId(100) }],
      }),
    ).toThrow(/between 1 and 32 actions/i);
  });

  it('rejects noncanonical serialization, derived-ID tampering, and extra fields', () => {
    const head = createDeploymentHead(
      createHeadInput({
        resourceBindings: [binding('substrate', 3), binding('artifact', 2)],
        activeOperation: operation('create', {
          nextActionIndex: 2,
          intents: [
            {
              actionId: actionId(2),
              status: 'settled',
              ownershipNonce: nonce(2),
            },
            {
              actionId: actionId(3),
              status: 'settled',
              ownershipNonce: nonce(3),
            },
          ],
        }),
      }),
    );

    const unsorted = clone(head);
    unsorted.resourceBindings.reverse();
    expect(() => validateDeploymentHead(unsorted)).toThrow(
      /strictly sorted by unique resourceKey/i,
    );

    const operationChanged = clone(head);
    operationChanged.activeOperation.operationId = semanticId(
      DEPLOYMENT_OPERATION_ID_PREFIX,
      'wharfie:test:deployment-operation:v2',
      { changed: true },
    );
    expect(() => validateDeploymentHead(operationChanged)).toThrow(
      /operationId does not match/i,
    );

    const headChanged = /** @type {Record<string, any>} */ (clone(head));
    headChanged.generation += 1;
    expect(() => validateDeploymentHead(headChanged)).toThrow(
      /headId does not match/i,
    );

    const oldSchema = /** @type {Record<string, any>} */ (clone(head));
    oldSchema.schemaVersion = 1;
    expect(() => validateDeploymentHead(oldSchema)).toThrow(
      /schemaVersion must be the integer 2/i,
    );

    expect(() =>
      createDeploymentHead({
        ...createHeadInput(),
        createdAt: 123,
      }),
    ).toThrow(/createdAt is not supported/i);
    const serializedExtra = { ...clone(head), credentials: 'never-persist' };
    expect(() => validateDeploymentHead(serializedExtra)).toThrow(
      /credentials is not supported/i,
    );
  });
});
