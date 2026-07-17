/* eslint-env jest */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createLambdaClient } from '../../../src/core/runtime/services/rpc-grpc.js';
import { startLambdaService } from '../../../src/core/runtime/services/lambda-service.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OTHER_REVISION_ID = `wrv1_${'B'.repeat(42)}Q`;

/** @type {{ close: () => void }[]} */
const clients = [];
/** @type {{ close: () => Promise<void> }[]} */
const services = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(services.splice(0).map(async (service) => service.close()));
});

/**
 * @param {(request: any) => Promise<any>} execute - Invocation implementation.
 * @returns {Promise<ReturnType<typeof createLambdaClient>>} - Bound client.
 */
async function startRevisionBoundClient(execute) {
  const service = await startLambdaService({
    host: '127.0.0.1',
    port: 0,
    revisionId: REVISION_ID,
    execute,
  });
  services.push(service);
  const client = createLambdaClient({ address: service.address });
  clients.push(client);
  return client;
}

describe('Lambda service direct Invoke (gRPC)', () => {
  it.each([
    ['null', null],
    ['string scalar', 'done'],
    ['number scalar', 17],
    ['boolean scalar', false],
    ['array', ['one', { two: 2 }]],
    ['object', { indexed: 2 }],
  ])(
    'returns an invocation %s result without changing its JSON shape',
    async (_name, expected) => {
      const execute = jest.fn(
        async (/** @type {any} */ request) => request.event.result,
      );
      const client = await startRevisionBoundClient(execute);

      await expect(
        client.invoke({
          functionName: 'rebuild-index',
          revisionId: REVISION_ID,
          event: { result: expected },
          context: { traceId: 'trace-1' },
        }),
      ).resolves.toEqual(expected);
      expect(execute).toHaveBeenCalledWith({
        functionName: 'rebuild-index',
        activity: 'rebuild-index',
        revisionId: REVISION_ID,
        event: { result: expected },
        context: { traceId: 'trace-1' },
      });
    },
  );

  it('rejects a missing revision before executing a revision-bound service', async () => {
    const execute = jest.fn(async () => ({ shouldNotRun: true }));
    const client = await startRevisionBoundClient(execute);

    await expect(
      client.invoke(
        /** @type {any} */ ({
          functionName: 'rebuild-index',
        }),
      ),
    ).rejects.toMatchObject({
      name: 'ActivityRevisionRequiredError',
      code: 'activity-revision-required',
      details: { expectedRevisionId: REVISION_ID },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a malformed or mismatched revision before executing', async () => {
    const execute = jest.fn(async () => ({ shouldNotRun: true }));
    const client = await startRevisionBoundClient(execute);

    await expect(
      client.invoke({
        functionName: 'rebuild-index',
        revisionId: 'latest',
      }),
    ).rejects.toMatchObject({
      name: 'ActivityRevisionInvalidError',
      code: 'activity-revision-invalid',
    });
    await expect(
      client.invoke({
        functionName: 'rebuild-index',
        revisionId: OTHER_REVISION_ID,
      }),
    ).rejects.toMatchObject({
      name: 'ActivityRevisionMismatchError',
      code: 'activity-revision-mismatch',
      details: {
        requestedRevisionId: OTHER_REVISION_ID,
        serviceRevisionId: REVISION_ID,
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves a stack-free executor error identity across gRPC', async () => {
    const execute = jest.fn(async () => {
      const error = new Error('provider rejected the invocation');
      error.name = 'ProviderRejectedError';
      Object.assign(error, {
        code: 'E_PROVIDER_REJECTED',
        details: { requestId: 'request-1' },
      });
      throw error;
    });
    const client = await startRevisionBoundClient(execute);

    await expect(
      client.invoke({
        functionName: 'rebuild-index',
        revisionId: REVISION_ID,
      }),
    ).rejects.toMatchObject({
      name: 'ProviderRejectedError',
      code: 'activity-invocation-failed',
      message: 'provider rejected the invocation',
      details: { requestId: 'request-1' },
    });
  });

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['non-finite number', Number.NaN],
    ['negative zero', -0],
    ['non-plain object', new Date(0)],
  ])(
    'rejects a non-transportable %s executor result',
    async (_name, result) => {
      const execute = jest.fn(async () => result);
      const client = await startRevisionBoundClient(execute);

      await expect(
        client.invoke({
          functionName: 'rebuild-index',
          revisionId: REVISION_ID,
        }),
      ).rejects.toMatchObject({
        name: 'ActivityInvocationValueError',
        code: 'activity-result-invalid',
        details: {},
      });
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('requires a revision when starting any Lambda service', async () => {
    await expect(
      // @ts-expect-error verifies the required runtime boundary too.
      startLambdaService({
        execute: async () => null,
      }),
    ).rejects.toThrow(/revisionId/i);
  });

  it('refuses divergent direct and queue revision bindings', async () => {
    await expect(
      startLambdaService({
        revisionId: REVISION_ID,
        execute: async () => undefined,
        poll: {
          queue: {},
          queueUrls: ['queue://one'],
          operationsStore: /** @type {any} */ ({}),
          appId: 'revision-bound-app',
          revisionId: OTHER_REVISION_ID,
        },
      }),
    ).rejects.toThrow(/does not match queue polling revision/i);
  });
});
