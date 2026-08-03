import { describe, expect, it, jest } from '@jest/globals';

import {
  createAwsSingleNodeHostActivationReceipt,
  createAwsSingleNodeHostActivationRequest,
} from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { createAwsSingleNodeHostActivationAuthorityRecord } from '../../src/core/runtime/deployment-aws-host-activation-authority-contract.js';
import {
  AwsSingleNodeHostActivationAuthorityIntegrityError,
  AwsSingleNodeHostActivationAuthorityUnavailableError,
  createAwsSingleNodeHostActivationAuthorityAdapter,
} from '../../src/core/runtime/deployment-aws-host-activation-authority.js';
import {
  getDeploymentControlHeadRecordKey,
  getDeploymentControlHostActivationAuthorityRecordKey,
} from '../../src/core/runtime/deployment-control-table.js';
import {
  expectDeepFrozen,
  makeFixture,
  makeHealthReceipt,
  makeReconcileFixture,
  semanticId,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @param {Readonly<AnyRecord>} head @returns {Readonly<AnyRecord>} */
function headRecord(head) {
  return Object.freeze({
    record_key: getDeploymentControlHeadRecordKey(head.deploymentInstanceId),
    storage_schema_version: 1,
    record_kind: 'deployment-head',
    document_id: head.headId,
    document: head,
  });
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {Map<string, unknown>} records
 * @param {AnyRecord} [options]
 * @returns {{adapter: Readonly<AnyRecord>, getControlRecord: jest.Mock<(input: AnyRecord, callOptions: AnyRecord) => Promise<unknown>>}}
 */
function createHarness(fixture, records, options = {}) {
  const getControlRecord = jest.fn(
    async (
      /** @type {AnyRecord} */ input,
      /** @type {AnyRecord} */ _callOptions,
    ) => (records.has(input.recordKey) ? records.get(input.recordKey) : null),
  );
  const adapter = createAwsSingleNodeHostActivationAuthorityAdapter({
    client: Object.freeze({ getControlRecord }),
    providerScope: fixture.providerScope,
    deploymentInstanceId: fixture.deploymentInstanceId,
    ...options,
  });
  return { adapter, getControlRecord };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} request @returns {Map<string, unknown>} */
function currentRecords(fixture, request) {
  return new Map([
    [
      getDeploymentControlHostActivationAuthorityRecordKey(
        fixture.deploymentInstanceId,
      ),
      createAwsSingleNodeHostActivationAuthorityRecord(request),
    ],
    [
      getDeploymentControlHeadRecordKey(fixture.deploymentInstanceId),
      headRecord(fixture.head),
    ],
  ]);
}

describe('AWS single-node host activation live authority adapter', () => {
  it('reads the immutable request first and current head last for every literal authorization', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const receipt = createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt: makeHealthReceipt(fixture),
    });
    const authorityKey = getDeploymentControlHostActivationAuthorityRecordKey(
      fixture.deploymentInstanceId,
    );
    const headKey = getDeploymentControlHeadRecordKey(
      fixture.deploymentInstanceId,
    );
    const { adapter, getControlRecord } = createHarness(
      fixture,
      currentRecords(fixture, request),
    );

    await expect(
      adapter.readAuthorizedRequest({
        deploymentInstanceId: request.deploymentInstanceId,
        requestId: request.requestId,
      }),
    ).resolves.toEqual(request);
    for (const input of [
      { request, purpose: 'claim', step: null, receipt: null },
      {
        request,
        purpose: 'dispatch',
        step: 'runtime-identity',
        receipt: null,
      },
      { request, purpose: 'settle', step: null, receipt: null },
      { request, purpose: 'replay', step: null, receipt },
    ]) {
      await expect(adapter.authorizeRequest(input)).resolves.toBe(true);
    }

    expect(Object.isFrozen(adapter)).toBe(true);
    expect(getControlRecord).toHaveBeenCalledTimes(10);
    expect(
      getControlRecord.mock.calls.map(([input]) => input.recordKey),
    ).toEqual([
      authorityKey,
      headKey,
      authorityKey,
      headKey,
      authorityKey,
      headKey,
      authorityKey,
      headKey,
      authorityKey,
      headKey,
    ]);
    for (const [input, options] of getControlRecord.mock.calls) {
      expect(input).toEqual({
        recordKey: input.recordKey === authorityKey ? authorityKey : headKey,
      });
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.keys(options)).toEqual(['abortSignal']);
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(Object.isFrozen(options)).toBe(true);
    }
    const authorized = await adapter.readAuthorizedRequest({
      deploymentInstanceId: request.deploymentInstanceId,
      requestId: request.requestId,
    });
    expectDeepFrozen(authorized);
  });

  it('treats absence, request supersession, head absence, and receipt mismatch as ordinary refusal', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const authorityKey = getDeploymentControlHostActivationAuthorityRecordKey(
      fixture.deploymentInstanceId,
    );
    const cases = [
      new Map(),
      new Map([[authorityKey, null]]),
      (() => {
        const reconcile = makeReconcileFixture(fixture);
        const successor = createAwsSingleNodeHostActivationRequest(
          reconcile.requestContext,
        );
        return new Map([
          [
            authorityKey,
            createAwsSingleNodeHostActivationAuthorityRecord(successor),
          ],
        ]);
      })(),
      new Map([
        [
          authorityKey,
          createAwsSingleNodeHostActivationAuthorityRecord(request),
        ],
      ]),
    ];

    for (const records of cases) {
      const { adapter } = createHarness(fixture, records);
      await expect(
        adapter.authorizeRequest({
          request,
          purpose: 'claim',
          step: null,
          receipt: null,
        }),
      ).resolves.toBe(false);
    }
    const reconcile = makeReconcileFixture(fixture);
    const otherRequest = createAwsSingleNodeHostActivationRequest(
      reconcile.requestContext,
    );
    const mismatchedReceipt = createAwsSingleNodeHostActivationReceipt({
      request: otherRequest,
      serviceHealthReceipt: makeHealthReceipt(fixture, {
        deploymentOperationId: reconcile.head.activeOperation.operationId,
        authorizedHeadId: reconcile.head.headId,
        authorizedHeadGeneration: reconcile.head.generation,
      }),
    });
    const { adapter, getControlRecord } = createHarness(
      fixture,
      currentRecords(fixture, request),
    );
    await expect(
      adapter.authorizeRequest({
        request,
        purpose: 'replay',
        step: null,
        receipt: mismatchedReceipt,
      }),
    ).resolves.toBe(false);
    expect(getControlRecord).not.toHaveBeenCalled();
  });

  it('rejects malformed envelopes before I/O and returns null for a different bound deployment', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const { adapter, getControlRecord } = createHarness(
      fixture,
      currentRecords(fixture, request),
    );

    for (const input of [
      null,
      { request, purpose: 'claim', step: null },
      { request, purpose: 'unknown', step: null, receipt: null },
      { request, purpose: 'dispatch', step: null, receipt: null },
      { request, purpose: 'claim', step: 'runtime-identity', receipt: null },
      { request, purpose: 'claim', step: null, receipt: null, extra: true },
    ]) {
      await expect(adapter.authorizeRequest(input)).rejects.toThrow();
    }
    expect(getControlRecord).not.toHaveBeenCalled();
    await expect(
      adapter.readAuthorizedRequest({
        deploymentInstanceId: semanticId(
          'wdi1',
          'wharfie:test:other-authority-deployment:v1',
          { requestId: request.requestId },
        ),
        requestId: request.requestId,
      }),
    ).resolves.toBeNull();
    expect(getControlRecord).not.toHaveBeenCalled();
  });

  it('maps malformed stored items to one redacted integrity error', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const records = currentRecords(fixture, request);
    records.set(
      getDeploymentControlHeadRecordKey(fixture.deploymentInstanceId),
      { providerSecret: 'do-not-leak-provider-secret' },
    );
    const { adapter } = createHarness(fixture, records);

    let failure;
    try {
      await adapter.authorizeRequest({
        request,
        purpose: 'claim',
        step: null,
        receipt: null,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      AwsSingleNodeHostActivationAuthorityIntegrityError,
    );
    expect(failure).toMatchObject({
      name: 'AwsSingleNodeHostActivationAuthorityIntegrityError',
      code: 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_INTEGRITY_FAILED',
      message: 'AWS single-node host activation authority storage is invalid.',
    });
    expect(failure).not.toHaveProperty('cause');
    expect(String(failure)).not.toContain('provider-secret');
  });

  it('bounds each read, aborts it, and maps raw failure to one redacted unavailable error', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const rawFailure = createHarness(fixture, new Map());
    rawFailure.getControlRecord.mockRejectedValueOnce(
      new Error('raw-provider-secret'),
    );
    await expect(
      rawFailure.adapter.authorizeRequest({
        request,
        purpose: 'claim',
        step: null,
        receipt: null,
      }),
    ).rejects.toMatchObject({
      name: 'AwsSingleNodeHostActivationAuthorityUnavailableError',
      code: 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_UNAVAILABLE',
      message: 'AWS single-node host activation authority is unavailable.',
    });

    /** @type {AbortSignal|undefined} */
    let signal;
    /** @type {Promise<unknown>} */
    const never = new Promise(() => undefined);
    const getControlRecord = jest.fn(
      (/** @type {AnyRecord} */ _input, /** @type {AnyRecord} */ options) => {
        signal = options.abortSignal;
        return never;
      },
    );
    const adapter = createAwsSingleNodeHostActivationAuthorityAdapter({
      client: Object.freeze({ getControlRecord }),
      providerScope: fixture.providerScope,
      deploymentInstanceId: fixture.deploymentInstanceId,
      attemptTimeoutMilliseconds: 5,
    });
    jest.useFakeTimers();
    try {
      const decision = adapter.authorizeRequest({
        request,
        purpose: 'claim',
        step: null,
        receipt: null,
      });
      const decisionFailure = decision.then(
        () => {
          throw new Error('Expected authority decision to fail.');
        },
        (/** @type {unknown} */ error) => error,
      );
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5);
      await expect(decisionFailure).resolves.toBeInstanceOf(
        AwsSingleNodeHostActivationAuthorityUnavailableError,
      );
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
