import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
  validateDeploymentResourceBinding,
  validateProviderResourceId,
} from '../../src/core/runtime/deployment-resource-binding.js';

const INVALID_PROVIDER_RESOURCE_ID_MESSAGE = `providerResourceId must be a nonempty JSON-stable printable ASCII provider resource ID without spaces, quotes, or backslashes and must not exceed ${DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES} bytes.`;

/** @param {unknown} value @returns {Error} */
function captureProviderResourceIdError(value) {
  try {
    validateProviderResourceId(value);
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('Expected providerResourceId validation to fail.');
}

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

/** @param {number} index @returns {string} */
function actionId(index) {
  return semanticId(
    DEPLOYMENT_ACTION_ID_PREFIX,
    'wharfie:test:deployment-action:v3',
    { index },
  );
}

/**
 * @param {string} resourceKey - Unique durable resource address.
 * @param {number} index - Ownership seed.
 * @param {Record<string, any>} [overrides] - Exact field overrides.
 * @returns {Record<string, any>} - Managed Binding V2 input.
 */
function managedBindingInput(resourceKey, index, overrides = {}) {
  return {
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
    incarnationId: INCARNATION_ID,
    resourceKey,
    capability: { kind: 'networking', version: 1 },
    role: { kind: resourceKey, version: 1 },
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [],
    providerType: 'test-resource',
    providerResourceId: `provider-resource-${resourceKey}`,
    providerScopeId: PROVIDER_SCOPE.providerScopeId,
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, index)),
    createdByActionId: actionId(index),
    ...overrides,
  };
}

describe('deployment resource binding provider identity', () => {
  it('accepts ordinary AWS resource identities and the exact size boundary', () => {
    expect(DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES).toBe(1024);
    expect(validateProviderResourceId('i-0123456789abcdef0')).toBe(
      'i-0123456789abcdef0',
    );
    expect(
      validateProviderResourceId(
        'arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-demo/stack-id',
      ),
    ).toBe(
      'arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-demo/stack-id',
    );

    const maximumLengthId = 'x'.repeat(
      DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
    );
    expect(validateProviderResourceId(maximumLengthId)).toBe(maximumLengthId);
  });

  it.each([
    ['empty', ''],
    ['embedded space', 'resource id sentinel'],
    ['leading space', ' resource-id-sentinel'],
    ['trailing space', 'resource-id-sentinel '],
    ['non-ASCII', 'resource-id-sentinél'],
    ['quote', 'resource-id-"sentinel'],
    ['backslash', 'resource-id-\\sentinel'],
    ['control character', 'resource-id-\nsentinel'],
    [
      'over the size boundary',
      'x'.repeat(DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES + 1),
    ],
  ])('rejects %s without echoing the rejected value', (_label, value) => {
    const error = captureProviderResourceIdError(value);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(INVALID_PROVIDER_RESOURCE_ID_MESSAGE);
  });
});

describe('deployment resource binding V2', () => {
  it('content-addresses exact role, lifecycle, ownership, and sorted dependency lineage', () => {
    const alpha = createDeploymentResourceBinding(
      managedBindingInput('alpha', 1),
    );
    const zeta = createDeploymentResourceBinding(
      managedBindingInput('zeta', 2),
    );
    const relationship = createDeploymentResourceBinding(
      managedBindingInput('relationship', 3, {
        role: { kind: 'attachment', version: 1 },
        ownershipMode: 'derived',
        dependencyBindings: [
          { resourceKey: zeta.resourceKey, bindingId: zeta.bindingId },
          { resourceKey: alpha.resourceKey, bindingId: alpha.bindingId },
        ],
      }),
    );

    expect(relationship).toMatchObject({
      schemaVersion: 2,
      bindingId: expect.stringMatching(/^wrb2_[A-Za-z0-9_-]{43}$/),
      role: { kind: 'attachment', version: 1 },
      ownershipMode: 'derived',
      onDestroy: 'purge',
    });
    expect(relationship.dependencyBindings).toEqual([
      { resourceKey: alpha.resourceKey, bindingId: alpha.bindingId },
      { resourceKey: zeta.resourceKey, bindingId: zeta.bindingId },
    ]);
    expect(validateDeploymentResourceBinding(clone(relationship))).toEqual(
      relationship,
    );
    expect(Object.isFrozen(relationship)).toBe(true);
    expect(Object.isFrozen(relationship.role)).toBe(true);
    expect(Object.isFrozen(relationship.dependencyBindings[0])).toBe(true);
  });

  it('requires managed ownership receipts and isolates external references', () => {
    const managed = managedBindingInput('external-reference', 4);
    const withoutManagedReceipt = { ...managed };
    delete withoutManagedReceipt.ownershipNonce;
    delete withoutManagedReceipt.createdByActionId;
    const external = createDeploymentResourceBinding({
      ...withoutManagedReceipt,
      management: 'external',
      ownershipMode: 'external',
      onDestroy: 'retain',
    });

    expect(external.ownershipMode).toBe('external');
    expect(external).not.toHaveProperty('ownershipNonce');
    expect(external).not.toHaveProperty('createdByActionId');
    expect(() =>
      createDeploymentResourceBinding({
        ...managed,
        management: 'external',
        ownershipMode: 'external',
      }),
    ).toThrow(/not supported for external/i);
    expect(() =>
      createDeploymentResourceBinding({
        ...withoutManagedReceipt,
        management: 'external',
        ownershipMode: 'external',
        dependencyBindings: [
          {
            resourceKey: 'dependency',
            bindingId: semanticId(
              'wrb2',
              'wharfie:test:deployment-resource-binding:v2',
              { dependency: true },
            ),
          },
        ],
      }),
    ).toThrow(/external resources cannot carry dependency/i);
  });

  it('rejects invalid role, ownership, action-version, and dependency contracts', () => {
    const dependency = createDeploymentResourceBinding(
      managedBindingInput('dependency', 5),
    );
    const dependencyReference = {
      resourceKey: dependency.resourceKey,
      bindingId: dependency.bindingId,
    };

    expect(() =>
      createDeploymentResourceBinding(
        managedBindingInput('derived', 6, {
          ownershipMode: 'derived',
        }),
      ),
    ).toThrow(/requires dependency binding lineage/i);
    expect(() =>
      createDeploymentResourceBinding(
        managedBindingInput('invalid-role', 6, {
          role: { kind: 'role', version: 2 },
        }),
      ),
    ).toThrow(/role.version must be the integer 1/i);
    expect(() =>
      createDeploymentResourceBinding(
        managedBindingInput('old-action', 6, {
          createdByActionId: semanticId(
            'wda2',
            'wharfie:test:deployment-action:v2',
            { index: 6 },
          ),
        }),
      ),
    ).toThrow(/createdByActionId/i);
    expect(() =>
      createDeploymentResourceBinding(
        managedBindingInput('duplicate-dependency', 6, {
          ownershipMode: 'derived',
          dependencyBindings: [dependencyReference, dependencyReference],
        }),
      ),
    ).toThrow(/unique resourceKey/i);
    expect(() =>
      createDeploymentResourceBinding(
        managedBindingInput('self', 6, {
          ownershipMode: 'derived',
          dependencyBindings: [{ ...dependencyReference, resourceKey: 'self' }],
        }),
      ),
    ).toThrow(/own resourceKey/i);
    expect(() =>
      createDeploymentResourceBinding(
        managedBindingInput('old-schema', 6, { schemaVersion: 1 }),
      ),
    ).toThrow(/schemaVersion must be the integer 2/i);
  });

  it('rejects noncanonical serialized dependency ordering', () => {
    const alpha = createDeploymentResourceBinding(
      managedBindingInput('alpha-serialized', 7),
    );
    const zeta = createDeploymentResourceBinding(
      managedBindingInput('zeta-serialized', 8),
    );
    const relationship = createDeploymentResourceBinding(
      managedBindingInput('serialized-relationship', 9, {
        ownershipMode: 'derived',
        dependencyBindings: [
          { resourceKey: alpha.resourceKey, bindingId: alpha.bindingId },
          { resourceKey: zeta.resourceKey, bindingId: zeta.bindingId },
        ],
      }),
    );
    const unsorted = clone(relationship);
    unsorted.dependencyBindings.reverse();

    expect(() => validateDeploymentResourceBinding(unsorted)).toThrow(
      /strictly sorted by unique resourceKey/i,
    );
  });
});
