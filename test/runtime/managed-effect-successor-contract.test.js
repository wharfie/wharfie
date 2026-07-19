/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';

import {
  MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID,
  MANAGED_EFFECT_SUCCESSOR_INTENT,
  MANAGED_EFFECT_SUCCESSOR_POLICY,
  assertInitialManagedEffectSuccessorRetryEligible,
  createManagedEffectSuccessorAuthorization,
  createManagedEffectSuccessorRequestDigest,
  normalizeManagedEffectSuccessorAuthorization,
  normalizeManagedEffectSuccessorContract,
  normalizeManagedEffectSuccessorPolicy,
  normalizeManagedEffectSuccessorSource,
  normalizeManagedEffectSuccessorTarget,
} from '../../src/core/lib/ledger/managed-effect-successor-contract.js';

const APP_ID = 'successor-app';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const STORE_ID = `was_${'B'.repeat(43)}`;

function sourceFixture() {
  return {
    runId: 'source-run',
    invocationId: 'source-invocation',
    attemptId: 'source-attempt',
    effectId: 'source-effect',
    uncertaintyEventId: 'uncertainty-event',
    uncertaintySequence: 7,
    reconciliationEventId: 'reconciliation-event',
    reconciliationSequence: 8,
    reconciliationId: 'reconciliation-request',
    disposition: 'NOT_APPLIED',
  };
}

function destinationFixture() {
  return {
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'vanilla',
      storeId: STORE_ID,
      tableName: 'wharfie-application-state-v2',
      namespace: APP_ID,
    },
  };
}

function contractFixture() {
  return {
    adapter: {
      id: 'application-state-put-if-absent',
      version: 2,
    },
    destination: destinationFixture(),
    verifier: {
      kind: 'application-state-put-if-absent-receipt',
      version: 2,
    },
    substantiatedReplayProperties: ['idempotent', 'transactional'],
  };
}

function requestFixture() {
  return {
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: 'settings/theme',
      value: { dark: true, contrast: 'high' },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

function effectFixture() {
  return {
    ...contractFixture(),
    reconciliation: {
      verifier: {
        kind: 'application-state-put-if-absent-not-applied',
        version: 2,
      },
    },
  };
}

function authorizationFixture(overrides = {}) {
  return createManagedEffectSuccessorAuthorization({
    appId: APP_ID,
    revisionId: REVISION_ID,
    successorId: 'successor-request-1',
    reason: {
      code: 'operator-retry',
      details: { ticket: 'ops-42' },
    },
    source: sourceFixture(),
    contract: contractFixture(),
    request: requestFixture(),
    ...overrides,
  });
}

/** @param {any} value - Strict JSON test fixture. @returns {any} - Independent JSON clone. */
function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('managed-effect successor contract', () => {
  test('pins the public retry policy and deterministic authorization vectors', () => {
    const authorization = authorizationFixture();

    expect(MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID).toBe(
      'wharfie-effect-successor',
    );
    expect(MANAGED_EFFECT_SUCCESSOR_INTENT).toBe('retry');
    expect(MANAGED_EFFECT_SUCCESSOR_POLICY).toEqual({
      kind: 'application-state-put-if-absent-not-applied-retry',
      version: 1,
    });
    expect(createManagedEffectSuccessorRequestDigest(requestFixture())).toBe(
      'wsq_A8NvSFtgJ1Uud7QKx86Ysq4lJEKn1J--kiSriN1CKE4',
    );
    expect(authorization).toEqual({
      kind: 'effect-successor',
      intent: 'retry',
      successorId: 'successor-request-1',
      slotId: 'wss_jC70bVffcXy5r0GueyBTUvU4m4cxaCBX5D0rfqNZE0M',
      policy: {
        kind: 'application-state-put-if-absent-not-applied-retry',
        version: 1,
      },
      reason: {
        code: 'operator-retry',
        details: { ticket: 'ops-42' },
      },
      source: sourceFixture(),
      contract: contractFixture(),
      target: {
        runId: 'wsr_tLl5jBF83iq_WMUG18-j6JVQI7RG3-R3YBoV0QD_R-c',
        invocationId: 'wsi_k3PQKM3t-JZdd4dl5rfTsGoOIbvO_SEilSoKyyAyYHs',
        effectId: 'wse_Lw1VQA9bf14h3tnDIPZnQOCsV1pCpErG2R1-8KpHtb8',
        destinationEffectId: 'wfx_XM6OZdOER_uGKsTDHVByqNLFyBO8JJNLmeUauk1G988',
        revisionId: REVISION_ID,
        requestDigest: 'wsq_A8NvSFtgJ1Uud7QKx86Ysq4lJEKn1J--kiSriN1CKE4',
      },
    });

    expect(authorization.target.runId).not.toBe(authorization.source.runId);
    expect(authorization.target.invocationId).not.toBe(
      authorization.source.invocationId,
    );
    expect(authorization.target.effectId).not.toBe(
      authorization.source.effectId,
    );
  });

  test('canonical JSON ordering produces the same replay authorization', () => {
    const first = authorizationFixture();
    const reordered = authorizationFixture({
      reason: {
        details: { ticket: 'ops-42' },
        code: 'operator-retry',
      },
      contract: {
        substantiatedReplayProperties: ['idempotent', 'transactional'],
        verifier: {
          version: 2,
          kind: 'application-state-put-if-absent-receipt',
        },
        destination: {
          configuration: {
            namespace: APP_ID,
            tableName: 'wharfie-application-state-v2',
            storeId: STORE_ID,
            provider: 'vanilla',
          },
          bindingId: 'primary',
          version: 2,
          kind: 'application-state',
        },
        adapter: {
          version: 2,
          id: 'application-state-put-if-absent',
        },
      },
      request: {
        requestedReplayProperties: ['idempotent', 'transactional'],
        input: {
          value: { contrast: 'high', dark: true },
          key: 'settings/theme',
        },
        operation: 'put-if-absent',
        capability: 'application-state',
      },
    });

    expect(reordered).toEqual(first);
    expect(
      createManagedEffectSuccessorRequestDigest({
        requestedReplayProperties: ['idempotent', 'transactional'],
        input: {
          value: { contrast: 'high', dark: true },
          key: 'settings/theme',
        },
        operation: 'put-if-absent',
        capability: 'application-state',
      }),
    ).toBe(first.target.requestDigest);

    const changedRequest = authorizationFixture({
      request: {
        ...requestFixture(),
        input: { key: 'settings/theme', value: { dark: false } },
      },
    });
    expect(changedRequest.slotId).toBe(first.slotId);
    expect(changedRequest.target.requestDigest).not.toBe(
      first.target.requestDigest,
    );
    expect(changedRequest.target.runId).not.toBe(first.target.runId);
    expect(changedRequest.target.invocationId).not.toBe(
      first.target.invocationId,
    );
    expect(changedRequest.target.effectId).not.toBe(first.target.effectId);
    expect(changedRequest.target.destinationEffectId).not.toBe(
      first.target.destinationEffectId,
    );
  });

  test('accepts only the finite application-state V2 not-applied retry policy', () => {
    expect(() =>
      assertInitialManagedEffectSuccessorRetryEligible({
        effect: effectFixture(),
        request: requestFixture(),
      }),
    ).not.toThrow();
  });

  test.each([
    [
      'another adapter',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.effect.adapter.id = 'another-adapter';
      },
    ],
    [
      'another adapter version',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.effect.adapter.version = 3;
      },
    ],
    [
      'another operation',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.request.operation = 'put';
      },
    ],
    [
      'another positive verifier',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.effect.verifier.kind = 'application-state-other-receipt';
      },
    ],
    [
      'another negative verifier',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.effect.reconciliation.verifier.kind =
          'application-state-other-not-applied';
      },
    ],
    [
      'weaker substantiated replay properties',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.effect.substantiatedReplayProperties = ['idempotent'];
      },
    ],
    [
      'weaker requested replay properties',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.request.requestedReplayProperties = ['idempotent'];
      },
    ],
    [
      'reordered replay properties',
      (
        /** @type {{effect: Record<string, any>, request: Record<string, any>}} */ input,
      ) => {
        input.request.requestedReplayProperties = [
          'transactional',
          'idempotent',
        ];
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const input = {
      effect: effectFixture(),
      request: requestFixture(),
    };
    mutate(input);
    expect(() =>
      assertInitialManagedEffectSuccessorRetryEligible(input),
    ).toThrow();
  });

  test('normalizes exact policy, source, target, contract, and authorization shapes', () => {
    const authorization = authorizationFixture();

    expect(
      normalizeManagedEffectSuccessorPolicy({
        version: 1,
        kind: 'application-state-put-if-absent-not-applied-retry',
      }),
    ).toEqual(MANAGED_EFFECT_SUCCESSOR_POLICY);
    expect(normalizeManagedEffectSuccessorSource(sourceFixture())).toEqual(
      sourceFixture(),
    );
    expect(normalizeManagedEffectSuccessorTarget(authorization.target)).toEqual(
      authorization.target,
    );
    expect(normalizeManagedEffectSuccessorContract(contractFixture())).toEqual(
      contractFixture(),
    );
    expect(normalizeManagedEffectSuccessorAuthorization(authorization)).toEqual(
      authorization,
    );

    const callerSource = sourceFixture();
    const callerContract = contractFixture();
    const callerRequest = requestFixture();
    const callerReason = { code: 'operator-retry' };
    const cloned = authorizationFixture({
      source: callerSource,
      contract: callerContract,
      request: callerRequest,
      reason: callerReason,
    });
    callerSource.runId = 'mutated-source';
    callerContract.destination.configuration.namespace = 'mutated-app';
    callerRequest.input.value.dark = false;
    callerReason.code = 'mutated-reason';
    expect(cloned.source.runId).toBe('source-run');
    expect(cloned.contract.destination.configuration.namespace).toBe(APP_ID);
    expect(cloned.reason.code).toBe('operator-retry');
    expect(cloned.target.requestDigest).toBe(
      'wsq_A8NvSFtgJ1Uud7QKx86Ysq4lJEKn1J--kiSriN1CKE4',
    );
  });

  test.each([
    [
      'policy extra field',
      () =>
        normalizeManagedEffectSuccessorPolicy({
          ...MANAGED_EFFECT_SUCCESSOR_POLICY,
          extra: true,
        }),
    ],
    [
      'policy version',
      () =>
        normalizeManagedEffectSuccessorPolicy({
          ...MANAGED_EFFECT_SUCCESSOR_POLICY,
          version: 2,
        }),
    ],
    [
      'source missing field',
      () => {
        const source = sourceFixture();
        Reflect.deleteProperty(source, 'attemptId');
        return normalizeManagedEffectSuccessorSource(source);
      },
    ],
    [
      'source extra field',
      () =>
        normalizeManagedEffectSuccessorSource({
          ...sourceFixture(),
          extra: true,
        }),
    ],
    [
      'source nonpositive sequence',
      () =>
        normalizeManagedEffectSuccessorSource({
          ...sourceFixture(),
          uncertaintySequence: 0,
        }),
    ],
    [
      'source disposition',
      () =>
        normalizeManagedEffectSuccessorSource({
          ...sourceFixture(),
          disposition: 'COMPLETED',
        }),
    ],
    [
      'target extra field',
      () =>
        normalizeManagedEffectSuccessorTarget({
          ...authorizationFixture().target,
          extra: true,
        }),
    ],
    [
      'target revision',
      () =>
        normalizeManagedEffectSuccessorTarget({
          ...authorizationFixture().target,
          revisionId: 'revision-1',
        }),
    ],
    [
      'contract missing field',
      () => {
        const contract = contractFixture();
        Reflect.deleteProperty(contract, 'verifier');
        return normalizeManagedEffectSuccessorContract(contract);
      },
    ],
    [
      'contract descriptor extra field',
      () =>
        normalizeManagedEffectSuccessorContract({
          ...contractFixture(),
          adapter: { ...contractFixture().adapter, extra: true },
        }),
    ],
    [
      'contract replay-property order',
      () =>
        normalizeManagedEffectSuccessorContract({
          ...contractFixture(),
          substantiatedReplayProperties: ['transactional', 'idempotent'],
        }),
    ],
    [
      'authorization extra field',
      () =>
        normalizeManagedEffectSuccessorAuthorization({
          ...authorizationFixture(),
          extra: true,
        }),
    ],
    [
      'authorization intent',
      () =>
        normalizeManagedEffectSuccessorAuthorization({
          ...authorizationFixture(),
          intent: 'compensate',
        }),
    ],
    [
      'authorization non-object reason',
      () =>
        normalizeManagedEffectSuccessorAuthorization({
          ...authorizationFixture(),
          reason: 'operator-retry',
        }),
    ],
  ])('rejects malformed %s', (_label, normalize) => {
    expect(normalize).toThrow();
  });

  test.each(['runId', 'invocationId', 'effectId'])(
    'rejects a target that reuses the source %s',
    (field) => {
      const authorization = jsonClone(authorizationFixture());
      authorization.target[field] = authorization.source[field];
      expect(() =>
        normalizeManagedEffectSuccessorAuthorization(authorization),
      ).toThrow(/source|target|fresh|distinct|different/i);
    },
  );
});
