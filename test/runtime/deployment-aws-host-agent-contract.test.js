import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION,
  createAwsSingleNodeHostActivationReceipt,
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationReceipt,
  validateAwsSingleNodeHostActivationReceiptContext,
  validateAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationRequestContext,
} from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import {
  IDS,
  clone,
  expectDeepFrozen,
  expectRejectionWithoutSecret,
  makeFixture,
  makeHealthReceipt,
  makeReconcileFixture,
  reidentifyReceipt,
  reidentifyRequest,
  reverseObjectKeys,
  semanticId,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

describe('AWS single-node host activation request', () => {
  it('derives one canonical deeply frozen request from the all-settled active frontier', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const { requestId: _requestId, ...payload } = request;

    expect(AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_SCHEMA_VERSION).toBe(2);
    expect(request).toMatchObject({
      schemaVersion: 2,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_KIND,
      planId: fixture.plan.planId,
      deploymentOperationId: fixture.head.activeOperation.operationId,
      authorizedHeadId: fixture.head.headId,
      authorizedHeadGeneration: fixture.head.generation,
      nodeBindingId: fixture.node.bindingId,
      nodeProviderResourceId: fixture.node.providerResourceId,
      runtimeRoleBindingId: fixture.runtimeRole.bindingId,
      runtimeRoleId: fixture.runtimeRole.providerResourceId,
      artifact: {
        bindingId: fixture.artifactBinding.bindingId,
        versionId: fixture.managedArtifact.versionId,
        etag: fixture.managedArtifact.etag,
        contentLength: fixture.managedArtifact.contentLength,
      },
      volumes: [
        {
          capabilityKind: 'application-state',
          volumeProviderResourceId: IDS.applicationVolume,
          sizeBytes: 8 * 1024 ** 3,
          createdWithoutSnapshot: true,
          requestedDeviceName: '/dev/sdf',
        },
        {
          capabilityKind: 'control-state',
          volumeProviderResourceId: IDS.controlVolume,
          sizeBytes: 8 * 1024 ** 3,
          createdWithoutSnapshot: true,
          requestedDeviceName: '/dev/sdg',
        },
      ],
    });
    expect(request.requestId).toBe(
      createCanonicalJsonSha256Id({
        domain: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
        prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
        value: payload,
      }),
    );
    expectDeepFrozen(request);

    const reordered = createAwsSingleNodeHostActivationRequest(
      reverseObjectKeys(fixture.requestContext),
    );
    expect(reordered).toEqual(request);

    const candidate = clone(request);
    const validated = validateAwsSingleNodeHostActivationRequest(candidate);
    expect(validated).toEqual(request);
    expect(validated).not.toBe(candidate);
    expect(validated.artifact).not.toBe(candidate.artifact);
    expectDeepFrozen(validated);
    candidate.artifact.versionId = 'changed-after-validation';
    expect(validated.artifact.versionId).toBe(
      fixture.managedArtifact.versionId,
    );
    expect(
      validateAwsSingleNodeHostActivationRequestContext(
        clone(request),
        fixture.requestContext,
      ),
    ).toEqual(request);
  });

  it('rejects exact-shape extensions without echoing secret-looking values', () => {
    expect.hasAssertions();
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const secret = 'Bearer host-boundary-do-not-echo';
    const topLevel = reidentifyRequest({ ...request, credentials: secret });
    const nestedArtifact = reidentifyRequest({
      ...request,
      artifact: { ...request.artifact, credentials: secret },
    });
    const nestedVolume = reidentifyRequest({
      ...request,
      volumes: [
        { ...request.volumes[0], credentials: secret },
        request.volumes[1],
      ],
    });

    for (const candidate of [topLevel, nestedArtifact, nestedVolume]) {
      expectRejectionWithoutSecret(
        () => validateAwsSingleNodeHostActivationRequest(candidate),
        secret,
      );
    }
    expectRejectionWithoutSecret(
      () =>
        createAwsSingleNodeHostActivationRequest({
          ...fixture.requestContext,
          credentials: secret,
        }),
      secret,
    );
  });

  it.each([
    'volumeBindingId',
    'volumeProviderResourceId',
    'attachmentBindingId',
    'attachmentProviderResourceId',
  ])('rejects cross-role %s aliases', (identityKey) => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const candidate = /** @type {AnyRecord} */ (clone(request));
    candidate.volumes[1][identityKey] = candidate.volumes[0][identityKey];

    expect(() =>
      validateAwsSingleNodeHostActivationRequest(reidentifyRequest(candidate)),
    ).toThrow(
      new RegExp(
        `distinct ${identityKey} values across application-state and control-state`,
      ),
    );
  });

  it.each([
    ['sizeBytes', 0, /positive safe integer/],
    ['sizeBytes', Number.MAX_SAFE_INTEGER + 1, /positive safe integer/],
    ['createdWithoutSnapshot', false, /must be literal true/],
  ])(
    'rejects invalid standalone volume %s values',
    (field, value, expectedError) => {
      const fixture = makeFixture();
      const request = createAwsSingleNodeHostActivationRequest(
        fixture.requestContext,
      );
      const candidate = /** @type {AnyRecord} */ (clone(request));
      candidate.volumes[0][field] = value;

      expect(() =>
        validateAwsSingleNodeHostActivationRequest(
          reidentifyRequest(candidate),
        ),
      ).toThrow(expectedError);
    },
  );

  it('rejects the reidentified v1 request schema', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );

    expect(() =>
      validateAwsSingleNodeHostActivationRequest(
        reidentifyRequest({ ...request, schemaVersion: 1 }),
      ),
    ).toThrow(/schemaVersion must be the integer 2/);
  });

  it('does not mint new privileged authority from a blocked frontier', () => {
    const fixture = makeFixture();
    const blockedHead = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: fixture.incarnationId,
      generation: fixture.head.generation + 1,
      phase: 'CONVERGING',
      settledDeploymentRevisionId: null,
      targetDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      resourceBindings: fixture.bindings,
      activeOperation: {
        kind: 'create',
        planId: fixture.plan.planId,
        status: 'blocked',
        nextActionIndex: fixture.plan.actions.length,
        intents: fixture.intents,
      },
      lastOperation: null,
    });

    expect(() =>
      createAwsSingleNodeHostActivationRequest({
        ...fixture.requestContext,
        head: blockedHead,
      }),
    ).toThrow(/all-settled frontier/);
  });

  it('binds a resident reconcile request to its active operation and create predecessor', () => {
    const fixture = makeFixture();
    const reconcile = makeReconcileFixture(fixture);
    const request = createAwsSingleNodeHostActivationRequest(
      reconcile.requestContext,
    );

    expect(request).toMatchObject({
      planId: reconcile.plan.planId,
      deploymentOperationId: reconcile.head.activeOperation.operationId,
      authorizedHeadId: reconcile.head.headId,
      authorizedHeadGeneration: reconcile.head.generation,
      deploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
      artifactId: fixture.deploymentRevision.artifactId,
    });
    expect(request.deploymentOperationId).not.toBe(
      fixture.head.activeOperation.operationId,
    );
    expect(
      validateAwsSingleNodeHostActivationRequestContext(
        clone(request),
        reconcile.requestContext,
      ),
    ).toEqual(request);
  });

  it('rejects READY minting and absent or incorrect reconcile predecessors', () => {
    const fixture = makeFixture();
    expect(() =>
      createAwsSingleNodeHostActivationRequest({
        ...fixture.requestContext,
        head: fixture.readyHead,
      }),
    ).toThrow(/all-settled frontier/);

    const reconcile = makeReconcileFixture(fixture);
    for (const settledPlan of [null, reconcile.plan]) {
      expect(() =>
        createAwsSingleNodeHostActivationRequest({
          ...reconcile.requestContext,
          settledPlan,
        }),
      ).toThrow();
    }

    const missing = /** @type {AnyRecord} */ (clone(reconcile.requestContext));
    delete missing.settledPlan;
    expect(() => createAwsSingleNodeHostActivationRequest(missing)).toThrow(
      /settledPlan is required/,
    );
  });

  it('detects stale identifiers and reidentified context forgeries', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const stale = /** @type {AnyRecord} */ (clone(request));
    stale.planId = semanticId(
      'wpl3',
      'wharfie:test:host-activation-forged-plan:v1',
      { seed: 1 },
    );
    expect(() => validateAwsSingleNodeHostActivationRequest(stale)).toThrow(
      /requestId does not match/,
    );

    const forgeries = [
      (/** @type {AnyRecord} */ candidate) => {
        candidate.planId = semanticId(
          'wpl3',
          'wharfie:test:host-activation-forged-plan:v1',
          { seed: 2 },
        );
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.deploymentOperationId = semanticId(
          'wdo2',
          'wharfie:test:host-activation-forged-operation:v1',
          { seed: 2 },
        );
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.authorizedHeadId = semanticId(
          'wdh2',
          'wharfie:test:host-activation-forged-head:v1',
          { seed: 2 },
        );
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.nodeProviderResourceId = 'i-00000000000000002';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.runtimeRoleId = 'AROA1234567890FORGED1';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.artifact.versionId = 'other-opaque-version';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.volumes[0].volumeProviderResourceId = 'vol-00000000000000003';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.volumes[0].sizeBytes += 1;
      },
    ];

    for (const mutate of forgeries) {
      const candidate = clone(request);
      mutate(candidate);
      const reidentified = reidentifyRequest(candidate);
      expect(validateAwsSingleNodeHostActivationRequest(reidentified)).toEqual(
        reidentified,
      );
      expect(() =>
        validateAwsSingleNodeHostActivationRequestContext(
          reidentified,
          fixture.requestContext,
        ),
      ).toThrow(/does not match its exact context/);
    }
  });
});

describe('AWS single-node host activation receipt', () => {
  it('creates one canonical success receipt and validates it across finalization', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const serviceHealthReceipt = makeHealthReceipt(fixture);
    const receipt = createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt,
    });
    const { receiptId: _receiptId, ...payload } = receipt;

    expect(receipt).toEqual({
      artifactVersionId: request.artifact.versionId,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_KIND,
      receiptId: receipt.receiptId,
      requestId: request.requestId,
      schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_SCHEMA_VERSION,
      serviceHealthReceipt,
    });
    expect(receipt.receiptId).toBe(
      createCanonicalJsonSha256Id({
        domain: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
        prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
        value: payload,
      }),
    );
    expectDeepFrozen(receipt);
    expect(validateAwsSingleNodeHostActivationReceipt(clone(receipt))).toEqual(
      receipt,
    );

    for (const currentHead of [fixture.head, fixture.readyHead]) {
      expect(
        validateAwsSingleNodeHostActivationReceiptContext(receipt, {
          request,
          requestContext: fixture.requestContext,
          currentHead,
        }),
      ).toEqual(receipt);
    }
    expect(fixture.readyHead.lastOperation.operationId).toBe(
      fixture.head.activeOperation.operationId,
    );

    const destroyingHead = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: fixture.incarnationId,
      generation: fixture.readyHead.generation + 1,
      phase: 'DESTROYING',
      settledDeploymentRevisionId:
        fixture.deploymentRevision.deploymentRevisionId,
      targetDeploymentRevisionId: null,
      resourceBindings: fixture.bindings,
      activeOperation: {
        kind: 'destroy',
        planId: semanticId(
          'wpl3',
          'wharfie:test:host-activation-destroy-plan:v1',
          { headId: fixture.readyHead.headId },
        ),
        status: 'running',
        nextActionIndex: 0,
        intents: [
          {
            actionId: semanticId(
              'wda3',
              'wharfie:test:host-activation-destroy-action:v1',
              { headId: fixture.readyHead.headId },
            ),
            status: 'pending',
            ownershipNonce: null,
          },
        ],
      },
      lastOperation: fixture.readyHead.lastOperation,
    });
    expect(() =>
      validateAwsSingleNodeHostActivationReceiptContext(receipt, {
        request,
        requestContext: fixture.requestContext,
        currentHead: destroyingHead,
      }),
    ).toThrow(/cannot authorize health during destroy/);
  });

  it('rejects health authority that does not exactly match its request', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const mismatches = {
      nodeProviderResourceId: 'i-00000000000000002',
      runtimeRoleId: 'AROA1234567890FORGED1',
      deploymentOperationId: semanticId(
        'wdo2',
        'wharfie:test:host-activation-forged-health-operation:v1',
        { seed: 1 },
      ),
      authorizedHeadId: semanticId(
        'wdh2',
        'wharfie:test:host-activation-forged-health-head:v1',
        { seed: 1 },
      ),
    };

    for (const [field, replacement] of Object.entries(mismatches)) {
      const serviceHealthReceipt = makeHealthReceipt(fixture, {
        [field]: replacement,
      });
      expect(() =>
        createAwsSingleNodeHostActivationReceipt({
          request,
          serviceHealthReceipt,
        }),
      ).toThrow(/does not match its exact request/);
    }
  });

  it('rejects receipt extensions and stale identifiers without secret echo', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const receipt = createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt: makeHealthReceipt(fixture),
    });
    const secret = 'Bearer receipt-boundary-do-not-echo';
    const topLevel = reidentifyReceipt({
      ...receipt,
      credentials: secret,
    });
    const nestedHealth = reidentifyReceipt({
      ...receipt,
      serviceHealthReceipt: {
        ...receipt.serviceHealthReceipt,
        credentials: secret,
      },
    });

    for (const candidate of [topLevel, nestedHealth]) {
      expectRejectionWithoutSecret(
        () => validateAwsSingleNodeHostActivationReceipt(candidate),
        secret,
      );
    }

    const stale = /** @type {AnyRecord} */ (clone(receipt));
    stale.artifactVersionId = 'other-opaque-version';
    expect(() => validateAwsSingleNodeHostActivationReceipt(stale)).toThrow(
      /receiptId does not match/,
    );
  });

  it('rejects reidentified artifact and health forgeries against exact context', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const receipt = createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt: makeHealthReceipt(fixture),
    });
    const context = {
      request,
      requestContext: fixture.requestContext,
      currentHead: fixture.readyHead,
    };
    const forgedVersion = reidentifyReceipt({
      ...receipt,
      artifactVersionId: 'other-opaque-version',
    });
    expect(validateAwsSingleNodeHostActivationReceipt(forgedVersion)).toEqual(
      forgedVersion,
    );
    expect(() =>
      validateAwsSingleNodeHostActivationReceiptContext(forgedVersion, context),
    ).toThrow(/does not match its exact request/);

    const forgedHealth = reidentifyReceipt({
      ...receipt,
      serviceHealthReceipt: makeHealthReceipt(fixture, {
        nodeProviderResourceId: 'i-00000000000000002',
      }),
    });
    expect(validateAwsSingleNodeHostActivationReceipt(forgedHealth)).toEqual(
      forgedHealth,
    );
    expect(() =>
      validateAwsSingleNodeHostActivationReceiptContext(forgedHealth, context),
    ).toThrow(/does not match its exact request/);
  });
});
