import { describe, expect, it } from '@jest/globals';

import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION,
  createAwsSingleNodeHostActivationAuthorityRecord,
  isAwsSingleNodeHostActivationAuthorityRecordForRequest,
  isAwsSingleNodeHostActivationRequestAuthorizedByHead,
  validateAwsSingleNodeHostActivationAuthorityRecord,
  validateAwsSingleNodeHostActivationHeadRecord,
} from '../../src/core/runtime/deployment-aws-host-activation-authority-contract.js';
import {
  getDeploymentControlHeadRecordKey,
  getDeploymentControlHostActivationAuthorityRecordKey,
} from '../../src/core/runtime/deployment-control-table.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentResourceBinding } from '../../src/core/runtime/deployment-resource-binding.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  makeReconcileFixture,
  reidentifyRequest,
  semanticId,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @param {Readonly<AnyRecord>} head @returns {Readonly<AnyRecord>} */
function headRecord(head) {
  return Object.freeze({
    record_key: getDeploymentControlHeadRecordKey(head.deploymentInstanceId),
    storage_schema_version:
      AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION,
    record_kind: 'deployment-head',
    document_id: head.headId,
    document: head,
  });
}

/** @param {Readonly<AnyRecord>} head @param {AnyRecord} overrides @returns {Readonly<AnyRecord>} */
function recreateHead(head, overrides) {
  const input = /** @type {AnyRecord} */ (clone(head));
  delete input.schemaVersion;
  delete input.kind;
  delete input.headId;
  if (input.activeOperation !== null) delete input.activeOperation.operationId;
  if (input.lastOperation !== null) delete input.lastOperation.operationId;
  const merged = { ...input, ...overrides };
  if (merged.activeOperation !== null) {
    merged.activeOperation = { ...merged.activeOperation };
    delete merged.activeOperation.operationId;
  }
  if (merged.lastOperation !== null) {
    merged.lastOperation = { ...merged.lastOperation };
    delete merged.lastOperation.operationId;
  }
  return createDeploymentHead(merged);
}

/**
 * Rebuild a strict head and its complete content-addressed binding graph under
 * a changed identity or selected provider resource.
 * @param {Readonly<AnyRecord>} head
 * @param {AnyRecord} [options]
 * @returns {Readonly<AnyRecord>}
 */
function rebindHead(head, options = {}) {
  const deploymentInstanceId =
    options.deploymentInstanceId ?? head.deploymentInstanceId;
  const providerScope = options.providerScope ?? head.providerScope;
  const incarnationId = options.incarnationId ?? head.incarnationId;
  const providerChanges = options.providerChanges ?? {};
  const pending = [...head.resourceBindings];
  const rebuilt = new Map();
  while (pending.length > 0) {
    const index = pending.findIndex((binding) =>
      binding.dependencyBindings.every((/** @type {AnyRecord} */ dependency) =>
        rebuilt.has(dependency.resourceKey),
      ),
    );
    if (index < 0) {
      throw new Error('Binding fixture graph could not be rebuilt.');
    }
    const serialized = /** @type {AnyRecord} */ (clone(pending[index]));
    pending.splice(index, 1);
    delete serialized.bindingId;
    serialized.deploymentInstanceId = deploymentInstanceId;
    serialized.incarnationId = incarnationId;
    serialized.providerScopeId = providerScope.providerScopeId;
    serialized.dependencyBindings = serialized.dependencyBindings.map(
      (/** @type {AnyRecord} */ dependency) => ({
        resourceKey: dependency.resourceKey,
        bindingId: rebuilt.get(dependency.resourceKey).bindingId,
      }),
    );
    if (Object.hasOwn(providerChanges, serialized.resourceKey)) {
      serialized.providerResourceId = providerChanges[serialized.resourceKey];
    }
    rebuilt.set(
      serialized.resourceKey,
      createDeploymentResourceBinding(serialized),
    );
  }
  return recreateHead(head, {
    deploymentInstanceId,
    providerScope,
    incarnationId,
    resourceBindings: [...rebuilt.values()],
  });
}

/** @param {Readonly<AnyRecord>} request @param {(value: AnyRecord) => void} mutate @returns {Readonly<AnyRecord>} */
function changeRequest(request, mutate) {
  const changed = /** @type {AnyRecord} */ (clone(request));
  mutate(changed);
  return reidentifyRequest(changed);
}

describe('AWS single-node host activation authority storage contract', () => {
  it('creates and strictly validates one canonical frozen request record', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const record = createAwsSingleNodeHostActivationAuthorityRecord(request);

    expect(record).toEqual({
      record_key: getDeploymentControlHostActivationAuthorityRecordKey(
        request.deploymentInstanceId,
      ),
      storage_schema_version: 1,
      record_kind: AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND,
      document_id: request.requestId,
      document: request,
    });
    expectDeepFrozen(record);
    expect(
      validateAwsSingleNodeHostActivationAuthorityRecord(clone(record)),
    ).toEqual(record);
    expect(
      isAwsSingleNodeHostActivationAuthorityRecordForRequest(record, request),
    ).toBe(true);
  });

  it('rejects authority and head records whose exact physical identity is forged', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const authority = createAwsSingleNodeHostActivationAuthorityRecord(request);
    const currentHead = headRecord(fixture.head);

    for (const candidate of [
      { ...clone(authority), extra: true },
      {
        ...clone(authority),
        record_key: 'host-activation-authority/v1/wdi1_bad',
      },
      { ...clone(authority), document_id: request.authorizedHeadId },
      { ...clone(authority), record_kind: 'deployment-head' },
      { ...clone(authority), storage_schema_version: 2 },
      {
        ...clone(authority),
        document: {
          ...clone(authority.document),
          oversized: 'x'.repeat(129 * 1024),
        },
      },
    ]) {
      expect(() =>
        validateAwsSingleNodeHostActivationAuthorityRecord(candidate),
      ).toThrow();
    }
    for (const candidate of [
      { ...clone(currentHead), extra: true },
      { ...clone(currentHead), record_key: authority.record_key },
      { ...clone(currentHead), document_id: request.requestId },
      { ...clone(currentHead), record_kind: authority.record_kind },
      { ...clone(currentHead), storage_schema_version: 2 },
    ]) {
      expect(() =>
        validateAwsSingleNodeHostActivationHeadRecord(candidate),
      ).toThrow();
    }

    let accessorInvoked = false;
    const accessor = clone(authority);
    Object.defineProperty(accessor, 'document', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return authority.document;
      },
    });
    const symbolRecord = clone(authority);
    Object.defineProperty(symbolRecord, Symbol('provider-secret'), {
      enumerable: true,
      value: 'must-not-be-ignored',
    });
    expect(() =>
      validateAwsSingleNodeHostActivationAuthorityRecord(accessor),
    ).toThrow();
    expect(accessorInvoked).toBe(false);
    expect(() =>
      validateAwsSingleNodeHostActivationAuthorityRecord(symbolRecord),
    ).toThrow();
  });

  it('recognizes the minted frontier, higher running/blocked generations, and its READY successor', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const running = recreateHead(fixture.head, {
      generation: fixture.head.generation + 1,
    });
    const blocked = recreateHead(fixture.head, {
      generation: fixture.head.generation + 2,
      activeOperation: {
        ...fixture.head.activeOperation,
        status: 'blocked',
      },
    });

    expect(
      validateAwsSingleNodeHostActivationHeadRecord(
        clone(headRecord(fixture.head)),
      ).document,
    ).toEqual(fixture.head);
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        request,
        fixture.head,
      ),
    ).toBe(true);
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(request, running),
    ).toBe(true);
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(request, blocked),
    ).toBe(true);
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        request,
        fixture.readyHead,
      ),
    ).toBe(true);
  });

  it('refuses lower generations, same-generation replacement, and a partial frontier', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const lowerGeneration = recreateHead(fixture.head, {
      generation: fixture.head.generation - 1,
    });
    const sameGenerationReplacement = recreateHead(fixture.head, {
      activeOperation: {
        ...fixture.head.activeOperation,
        status: 'blocked',
      },
    });
    const finalIntent =
      fixture.head.activeOperation.intents[
        fixture.head.activeOperation.intents.length - 1
      ];
    const partialFrontier = recreateHead(fixture.head, {
      generation: fixture.head.generation + 1,
      resourceBindings: fixture.head.resourceBindings.filter(
        (/** @type {AnyRecord} */ binding) =>
          binding.createdByActionId !== finalIntent.actionId,
      ),
      activeOperation: {
        ...fixture.head.activeOperation,
        status: 'running',
        nextActionIndex: fixture.head.activeOperation.intents.length - 1,
        intents: fixture.head.activeOperation.intents.map(
          (/** @type {AnyRecord} */ intent, /** @type {number} */ index) =>
            index === fixture.head.activeOperation.intents.length - 1
              ? { ...intent, status: 'pending', ownershipNonce: null }
              : intent,
        ),
      },
    });

    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        request,
        lowerGeneration,
      ),
    ).toBe(false);
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        request,
        sameGenerationReplacement,
      ),
    ).toBe(false);
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        request,
        partialFrontier,
      ),
    ).toBe(false);
  });

  it('refuses a different active operation even when the completed predecessor still matches', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const reconcile = makeReconcileFixture(fixture);

    expect(reconcile.head.lastOperation.operationId).toBe(
      request.deploymentOperationId,
    );
    expect(reconcile.head.activeOperation.operationId).not.toBe(
      request.deploymentOperationId,
    );
    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        request,
        reconcile.head,
      ),
    ).toBe(false);
  });

  it('refuses READY with the wrong revision or operation and every destroyed successor', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const wrongRevision = semanticId(
      'wdr1',
      'wharfie:test:authority-wrong-ready-revision:v1',
      { requestId: request.requestId },
    );
    const readyWrongRevision = recreateHead(fixture.readyHead, {
      settledDeploymentRevisionId: wrongRevision,
      targetDeploymentRevisionId: wrongRevision,
    });
    const readyWrongOperation = recreateHead(fixture.readyHead, {
      lastOperation: {
        ...fixture.readyHead.lastOperation,
        planId: semanticId(
          'wpl3',
          'wharfie:test:authority-wrong-ready-plan:v1',
          { requestId: request.requestId },
        ),
      },
    });
    const destroyed = recreateHead(fixture.readyHead, {
      generation: fixture.readyHead.generation + 1,
      phase: 'DESTROYED',
      settledDeploymentRevisionId: null,
      targetDeploymentRevisionId: null,
      resourceBindings: fixture.readyHead.resourceBindings.filter(
        (/** @type {AnyRecord} */ binding) => binding.onDestroy === 'retain',
      ),
      activeOperation: null,
      lastOperation: {
        kind: 'destroy',
        planId: semanticId('wpl3', 'wharfie:test:authority-destroyed-plan:v1', {
          requestId: request.requestId,
        }),
        intents: fixture.intents,
      },
    });

    for (const head of [readyWrongRevision, readyWrongOperation, destroyed]) {
      expect(
        isAwsSingleNodeHostActivationRequestAuthorizedByHead(request, head),
      ).toBe(false);
    }
  });

  it('refuses cross-deployment, cross-scope, and cross-incarnation heads', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const otherScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '210987654321',
      region: 'us-east-1',
    });
    const heads = [
      rebindHead(fixture.head, {
        deploymentInstanceId: semanticId(
          'wdi1',
          'wharfie:test:authority-other-deployment:v1',
          { requestId: request.requestId },
        ),
      }),
      rebindHead(fixture.head, { providerScope: otherScope }),
      rebindHead(fixture.head, {
        incarnationId: semanticId(
          'wic1',
          'wharfie:test:authority-other-incarnation:v1',
          { requestId: request.requestId },
        ),
      }),
    ];

    for (const head of heads) {
      expect(
        isAwsSingleNodeHostActivationRequestAuthorizedByHead(request, head),
      ).toBe(false);
    }
  });

  it.each([
    [
      'artifact binding',
      (/** @type {AnyRecord} */ request) => {
        request.artifact.bindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-artifact-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'runtime-role binding',
      (/** @type {AnyRecord} */ request) => {
        request.runtimeRoleBindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-runtime-role-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'runtime-role provider',
      (/** @type {AnyRecord} */ request) => {
        request.runtimeRoleId = 'AROA000000000000OTHER';
      },
    ],
    [
      'node binding',
      (/** @type {AnyRecord} */ request) => {
        request.nodeBindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-node-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'node provider',
      (/** @type {AnyRecord} */ request) => {
        request.nodeProviderResourceId = 'i-00000000000000002';
      },
    ],
    [
      'application volume binding',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[0].volumeBindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-application-volume-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'application volume provider',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[0].volumeProviderResourceId = 'vol-00000000000000003';
      },
    ],
    [
      'control volume binding',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[1].volumeBindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-control-volume-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'control volume provider',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[1].volumeProviderResourceId = 'vol-00000000000000004';
      },
    ],
    [
      'application attachment binding',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[0].attachmentBindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-application-attachment-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'application attachment provider',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[0].attachmentProviderResourceId = semanticId(
          'wva1',
          'wharfie:test:authority-application-attachment-provider:v1',
          request.requestId,
        );
      },
    ],
    [
      'control attachment binding',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[1].attachmentBindingId = semanticId(
          'wrb2',
          'wharfie:test:authority-control-attachment-binding:v1',
          request.requestId,
        );
      },
    ],
    [
      'control attachment provider',
      (/** @type {AnyRecord} */ request) => {
        request.volumes[1].attachmentProviderResourceId = semanticId(
          'wva1',
          'wharfie:test:authority-control-attachment-provider:v1',
          request.requestId,
        );
      },
    ],
  ])('refuses %s drift', (_label, mutate) => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const changed = changeRequest(request, mutate);

    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        changed,
        fixture.head,
      ),
    ).toBe(false);
  });

  it('refuses an artifact provider replacement in the current binding graph', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const changed = rebindHead(fixture.head, {
      providerChanges: {
        artifact: 'arn:aws:s3:::forged-artifact-provider/object',
      },
    });

    expect(
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(request, changed),
    ).toBe(false);
  });
});
