import { describe, expect, it, jest } from '@jest/globals';

import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS,
  createAwsSingleNodeHostRuntimeIdentityAdapter,
  validateAwsSingleNodeHostRuntimeIdentityEvidence,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  clone,
  expectDeepFrozen,
  expectRejectionWithoutSecret,
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

/**
 * @param {AnyRecord} value - Mutable JSON fixture.
 * @returns {Readonly<AnyRecord>} - Deeply frozen fixture.
 */
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      deepFreeze(/** @type {AnyRecord} */ (child));
    }
  }
  return Object.freeze(value);
}

/**
 * @param {Readonly<AnyRecord>} request - Exact V65 activation request.
 * @param {AnyRecord} [overrides] - Optional context replacements.
 * @returns {Readonly<AnyRecord>} - Exact V66 runtime-identity step context.
 */
function makeContext(request, overrides = {}) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        'runtime-identity',
      ),
      kind: 'runtime-identity',
      attemptGeneration: 0,
    },
    priorEvidence: {},
    ...overrides,
  });
}

/**
 * @param {Readonly<AnyRecord>} request - Exact activation request.
 * @param {AnyRecord} [overrides] - Optional STS response replacements.
 * @returns {Readonly<AnyRecord>} - Exact expected caller identity.
 */
function makeCallerIdentity(request, overrides = {}) {
  return deepFreeze({
    Account: request.providerScope.accountId,
    Arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
    UserId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
    $metadata: { httpStatusCode: 200, requestId: 'provider-request-id' },
    ...overrides,
  });
}

/**
 * @param {Readonly<AnyRecord>} request - Exact activation request.
 * @param {AnyRecord} [overrides] - Optional evidence replacements.
 * @returns {Readonly<AnyRecord>} - Exact expected durable identity evidence.
 */
function makeEvidence(request, overrides = {}) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: request.requestId,
    accountId: request.providerScope.accountId,
    arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
    userId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
    ...overrides,
  });
}

/**
 * @param {{
 *   request: Readonly<AnyRecord>,
 *   responses?: unknown[],
 *   maxAttempts?: number,
 *   attemptTimeoutMilliseconds?: number,
 *   waitForRetry?: (attempt: number) => unknown,
 * }} options - Harness behavior.
 * @returns {{adapter: Readonly<AnyRecord>, calls: Array<{receiver: unknown, input: AnyRecord, options: AnyRecord}>, waitForRetry: jest.Mock<(attempt: number) => unknown>}}
 */
function makeAdapter(options) {
  /** @type {Array<{receiver: unknown, input: AnyRecord, options: AnyRecord}>} */
  const calls = [];
  const responses = [
    ...(options.responses ?? [makeCallerIdentity(options.request)]),
  ];
  const client = {
    async getCallerIdentity(
      /** @type {AnyRecord} */ input,
      /** @type {AnyRecord} */ callOptions,
    ) {
      calls.push({ receiver: this, input, options: callOptions });
      const response =
        responses.length === 0
          ? makeCallerIdentity(options.request)
          : responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const waitForRetry = jest.fn(options.waitForRetry ?? (() => undefined));
  const adapter = createAwsSingleNodeHostRuntimeIdentityAdapter({
    client,
    providerScope: options.request.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    attemptTimeoutMilliseconds: options.attemptTimeoutMilliseconds ?? 1_000,
    waitForRetry,
  });
  return { adapter, calls, waitForRetry };
}

describe('AWS single-node host runtime identity', () => {
  it('settles one exact live EC2 role session into frozen request-bound evidence', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const context = makeContext(request);
    const { adapter, calls } = makeAdapter({ request });

    const observation = await adapter.observe(context);

    expect(observation).toEqual({
      status: 'settled',
      evidence: makeEvidence(request),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({});
    expect(Object.isFrozen(calls[0].input)).toBe(true);
    expect(calls[0].options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(Object.isFrozen(calls[0].options)).toBe(true);
    expect(
      adapter.validateEvidence(clone(observation.evidence), context),
    ).toEqual(observation.evidence);
    expect(
      validateAwsSingleNodeHostRuntimeIdentityEvidence(
        clone(observation.evidence),
        context,
      ),
    ).toEqual(observation.evidence);
    expectDeepFrozen(observation);
  });

  it.each([
    [
      'account',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, { Account: '999999999999' }),
    ],
    [
      'partition',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, {
          Arn: `arn:aws-us-gov:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
        }),
    ],
    [
      'runtime role name',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, {
          Arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/wrong-runtime-role/${request.nodeProviderResourceId}`,
        }),
    ],
    [
      'ARN session',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, {
          Arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/i-11111111111111111`,
        }),
    ],
    [
      'principal kind',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, {
          Arn: `arn:${request.providerScope.partition}:iam::${request.providerScope.accountId}:role/${request.runtimeRoleName}`,
        }),
    ],
    [
      'UserId role',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, {
          UserId: `AROA9999999999EXAMPLE:${request.nodeProviderResourceId}`,
        }),
    ],
    [
      'UserId session',
      (/** @type {AnyRecord} */ request) =>
        makeCallerIdentity(request, {
          UserId: `${request.runtimeRoleId}:i-11111111111111111`,
        }),
    ],
  ])(
    'classifies a conclusive %s mismatch as conflict',
    async (_label, makeResponse) => {
      const fixture = makeFixture();
      const request = createAwsSingleNodeHostActivationRequest(
        fixture.requestContext,
      );
      const { adapter, calls } = makeAdapter({
        request,
        responses: [makeResponse(request)],
      });

      await expect(adapter.observe(makeContext(request))).resolves.toEqual({
        status: 'conflict',
      });
      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    null,
    [],
    {},
    { Account: '123456789012' },
    {
      Account: '123456789012',
      Arn: 'arn:aws:sts::123456789012:assumed-role/example/session',
      UserId: 1,
    },
    Object.create({
      Account: '123456789012',
      Arn: 'arn:aws:sts::123456789012:assumed-role/example/session',
      UserId: 'AROAEXAMPLE:session',
    }),
  ])(
    'classifies malformed provider identity as unknown: %#',
    async (response) => {
      const fixture = makeFixture();
      const request = createAwsSingleNodeHostActivationRequest(
        fixture.requestContext,
      );
      const { adapter } = makeAdapter({ request, responses: [response] });

      await expect(adapter.observe(makeContext(request))).resolves.toEqual({
        status: 'unknown',
      });
    },
  );

  it('contains accessor and proxy failures and never persists their secret detail', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const secret = 'Bearer response-getter-must-not-escape';
    let getterCalls = 0;
    const accessorResponse = {};
    for (const key of ['Account', 'Arn', 'UserId']) {
      Object.defineProperty(accessorResponse, key, {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error(secret);
        },
      });
    }
    const accessor = makeAdapter({
      request,
      responses: [accessorResponse],
    });
    const accessorResult = await accessor.adapter.observe(makeContext(request));
    expect(accessorResult).toEqual({ status: 'unknown' });
    expect(getterCalls).toBe(0);
    expect(JSON.stringify(accessorResult)).not.toContain(secret);

    const proxyResponse = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(secret);
        },
      },
    );
    const proxyClient = {
      async getCallerIdentity() {
        return proxyResponse;
      },
    };
    const proxyAdapter = createAwsSingleNodeHostRuntimeIdentityAdapter({
      client: proxyClient,
      providerScope: request.providerScope,
      maxAttempts: 1,
      attemptTimeoutMilliseconds: 1_000,
      waitForRetry: () => undefined,
    });
    const proxyResult = await proxyAdapter.observe(makeContext(request));
    expect(proxyResult).toEqual({ status: 'unknown' });
    expect(JSON.stringify(proxyResult)).not.toContain(secret);
  });

  it('retries transient reads within the bound and settles only from the later live response', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const { adapter, calls, waitForRetry } = makeAdapter({
      request,
      responses: [
        new Error('sensitive first STS failure'),
        new Error('sensitive second STS failure'),
        makeCallerIdentity(request),
      ],
      maxAttempts: 3,
    });

    await expect(adapter.observe(makeContext(request))).resolves.toEqual({
      status: 'settled',
      evidence: makeEvidence(request),
    });
    expect(calls).toHaveLength(3);
    expect(waitForRetry.mock.calls).toEqual([[1], [2]]);
  });

  it('retries malformed and stale identities before deciding the current live identity', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const malformedThenCurrent = makeAdapter({
      request,
      responses: [{}, makeCallerIdentity(request)],
      maxAttempts: 2,
    });
    await expect(
      malformedThenCurrent.adapter.observe(makeContext(request)),
    ).resolves.toMatchObject({ status: 'settled' });
    expect(malformedThenCurrent.calls).toHaveLength(2);

    const staleThenCurrent = makeAdapter({
      request,
      responses: [
        makeCallerIdentity(request, { Account: '999999999999' }),
        makeCallerIdentity(request),
      ],
      maxAttempts: 2,
    });
    await expect(
      staleThenCurrent.adapter.observe(makeContext(request)),
    ).resolves.toMatchObject({ status: 'settled' });
    expect(staleThenCurrent.calls).toHaveLength(2);
  });

  it('returns one redacted unknown result after retry exhaustion or failed retry wait', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const secret = 'Bearer must-not-escape-runtime-identity';
    const exhausted = makeAdapter({
      request,
      responses: [new Error(secret), new Error(secret)],
      maxAttempts: 2,
    });

    const exhaustedResult = await exhausted.adapter.observe(
      makeContext(request),
    );
    expect(exhaustedResult).toEqual({ status: 'unknown' });
    expect(JSON.stringify(exhaustedResult)).not.toContain(secret);
    expect(exhausted.calls).toHaveLength(2);
    expect(exhausted.waitForRetry).toHaveBeenCalledTimes(1);
    expectDeepFrozen(exhaustedResult);

    const failedWait = makeAdapter({
      request,
      responses: [new Error(secret), makeCallerIdentity(request)],
      maxAttempts: 2,
      waitForRetry: () => {
        throw new Error('sensitive retry wait failure');
      },
    });
    await expect(
      failedWait.adapter.observe(makeContext(request)),
    ).resolves.toEqual({ status: 'unknown' });
    expect(failedWait.calls).toHaveLength(1);
  });

  it('aborts and returns unknown when one provider read never settles', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {AbortSignal[]} */
    const signals = [];
    const adapter = createAwsSingleNodeHostRuntimeIdentityAdapter({
      client: {
        async getCallerIdentity(
          /** @type {AnyRecord} */ _input,
          /** @type {{abortSignal: AbortSignal}} */ options,
        ) {
          signals.push(options.abortSignal);
          return await new Promise(() => {});
        },
      },
      providerScope: request.providerScope,
      maxAttempts: 1,
      attemptTimeoutMilliseconds: 5,
      waitForRetry: () => undefined,
    });

    await expect(adapter.observe(makeContext(request))).resolves.toEqual({
      status: 'unknown',
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
  });

  it('performs a fresh STS read for every observation and does not cache identity', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const { adapter, calls } = makeAdapter({
      request,
      responses: [
        makeCallerIdentity(request),
        makeCallerIdentity(request, { Account: '999999999999' }),
      ],
    });
    const context = makeContext(request);

    await expect(adapter.observe(context)).resolves.toMatchObject({
      status: 'settled',
    });
    await expect(adapter.observe(context)).resolves.toEqual({
      status: 'conflict',
    });
    expect(calls).toHaveLength(2);
  });

  it('rejects a wrong bound scope or malformed step context before provider I/O', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {AnyRecord[]} */
    const calls = [];
    const adapter = createAwsSingleNodeHostRuntimeIdentityAdapter({
      client: {
        async getCallerIdentity(/** @type {AnyRecord} */ input) {
          calls.push(input);
          return makeCallerIdentity(request);
        },
      },
      providerScope: createAwsProviderScope({
        partition: request.providerScope.partition,
        accountId: request.providerScope.accountId,
        region: 'us-west-2',
      }),
      maxAttempts: 1,
      waitForRetry: () => undefined,
    });

    await expect(adapter.observe(makeContext(request))).rejects.toThrow(
      /scope|context|request/i,
    );
    expect(calls).toHaveLength(0);

    const valid = makeAdapter({ request });
    for (const context of [
      { ...makeContext(request), extra: true },
      makeContext(request, {
        priorEvidence: { 'earlier-step': { settled: true } },
      }),
      makeContext(request, {
        step: {
          kind: 'application-storage',
          intentId: getAwsSingleNodeHostActivationIntentId(
            request,
            'application-storage',
          ),
          attemptGeneration: 0,
        },
      }),
      makeContext(request, {
        step: {
          ...makeContext(request).step,
          intentId: getAwsSingleNodeHostActivationIntentId(
            request,
            'application-storage',
          ),
        },
      }),
      makeContext(request, {
        step: { ...makeContext(request).step, attemptGeneration: 1 },
      }),
    ]) {
      await expect(valid.adapter.observe(context)).rejects.toThrow();
    }
    expect(valid.calls).toHaveLength(0);
  });

  it('validates evidence purely against its exact request and rejects extensions without leaking them', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const context = makeContext(request);
    const evidence = makeEvidence(request);
    const validated = validateAwsSingleNodeHostRuntimeIdentityEvidence(
      clone(evidence),
      context,
    );

    expect(validated).toEqual(evidence);
    expectDeepFrozen(validated);
    for (const candidate of [
      { ...evidence, requestId: 'whaq1_invalid' },
      { ...evidence, accountId: '999999999999' },
      { ...evidence, arn: `${evidence.arn}-wrong` },
      { ...evidence, userId: `${evidence.userId}-wrong` },
    ]) {
      expect(() =>
        validateAwsSingleNodeHostRuntimeIdentityEvidence(candidate, context),
      ).toThrow();
    }

    const reconcile = makeReconcileFixture(fixture);
    const laterRequest = createAwsSingleNodeHostActivationRequest(
      reconcile.requestContext,
    );
    expect(() =>
      validateAwsSingleNodeHostRuntimeIdentityEvidence(
        evidence,
        makeContext(laterRequest),
      ),
    ).toThrow(/request|context|evidence/i);

    const secret = 'Bearer evidence-extension-must-not-echo';
    expectRejectionWithoutSecret(
      () =>
        validateAwsSingleNodeHostRuntimeIdentityEvidence(
          { ...evidence, credentials: secret },
          context,
        ),
      secret,
    );
  });

  it('snapshots and binds the exact narrow client method', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {unknown[]} */
    const receivers = [];
    const client = {
      async getCallerIdentity(/** @type {AnyRecord} */ _input) {
        receivers.push(this);
        return makeCallerIdentity(request);
      },
    };
    const original = client.getCallerIdentity;
    const adapter = createAwsSingleNodeHostRuntimeIdentityAdapter({
      client,
      providerScope: request.providerScope,
      maxAttempts: 1,
      attemptTimeoutMilliseconds: 1_000,
      waitForRetry: () => undefined,
    });
    client.getCallerIdentity = async () => {
      throw new Error('mutated client method must not be used');
    };

    await expect(adapter.observe(makeContext(request))).resolves.toMatchObject({
      status: 'settled',
    });
    expect(receivers).toEqual([client]);
    expect(original).not.toBe(client.getCallerIdentity);
  });

  it('pins bounded retry constants and rejects malformed factory capabilities', () => {
    expect(AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS).toBe(10);
    expect(
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS,
    ).toBe(10_000);
    expect(
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS,
    ).toBe(60_000);
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const client = {
      getCallerIdentity: async () => makeCallerIdentity(request),
    };
    const valid = {
      client,
      providerScope: request.providerScope,
      maxAttempts: 1,
      attemptTimeoutMilliseconds: 1_000,
      waitForRetry: () => undefined,
    };
    let clientAccessorCalls = 0;
    const accessorClient = {};
    Object.defineProperty(accessorClient, 'getCallerIdentity', {
      enumerable: true,
      get() {
        clientAccessorCalls += 1;
        return async () => makeCallerIdentity(request);
      },
    });

    for (const options of [
      null,
      { ...valid, extra: true },
      { ...valid, client: {} },
      { ...valid, client: { ...client, extra: true } },
      { ...valid, client: accessorClient },
      { ...valid, providerScope: {} },
      { ...valid, maxAttempts: 0 },
      {
        ...valid,
        maxAttempts: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS + 1,
      },
      { ...valid, attemptTimeoutMilliseconds: 0 },
      {
        ...valid,
        attemptTimeoutMilliseconds:
          AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS +
          1,
      },
      { ...valid, waitForRetry: null },
    ]) {
      expect(() =>
        createAwsSingleNodeHostRuntimeIdentityAdapter(options),
      ).toThrow();
    }
    expect(clientAccessorCalls).toBe(0);
  });
});
