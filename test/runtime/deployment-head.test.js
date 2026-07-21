import { describe, expect, it } from '@jest/globals';

import {
  createDeploymentHead,
  getDeploymentOperationId,
  validateDeploymentHead,
} from '../../src/core/runtime/deployment-head.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
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
  return semanticId('wda2', 'wharfie:test:deployment-action:v2', { index });
}

/** @param {string} kind @param {number} index @returns {string} */
function planId(kind, index = 1) {
  return semanticId('wpl2', 'wharfie:test:deployment-plan:v2', {
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
 * @param {{deploymentInstanceId?: string, incarnationId?: string, providerScopeId?: string}} [overrides] - Identity overrides.
 * @returns {Readonly<Record<string, any>>} - Exact managed binding.
 */
function binding(resourceKey, index, overrides = {}) {
  return createDeploymentResourceBinding({
    schemaVersion: 1,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId:
      overrides.deploymentInstanceId || DEPLOYMENT_INSTANCE_ID,
    incarnationId: overrides.incarnationId || INCARNATION_ID,
    resourceKey,
    capability: {
      kind: resourceKey === 'artifact' ? 'artifact-storage' : 'resident-node',
      version: 1,
    },
    management: 'managed',
    providerType: resourceKey === 'artifact' ? 's3-object' : 'ec2-instance',
    providerResourceId: `provider-resource-${resourceKey}`,
    providerScopeId:
      overrides.providerScopeId || PROVIDER_SCOPE.providerScopeId,
    ownershipNonce: nonce(index),
    createdByActionId: actionId(index),
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
      schemaVersion: 1,
      kind: 'deploymentHead',
      headId: expect.stringMatching(/^wdh1_[A-Za-z0-9_-]{43}$/),
      generation: 4,
      phase: 'CONVERGING',
      activeOperation: {
        operationId: expect.stringMatching(/^wdo1_[A-Za-z0-9_-]{43}$/),
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
          resourceBindings: [binding('artifact', 2)],
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
      'wdo1',
      'wharfie:test:deployment-operation:v1',
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
