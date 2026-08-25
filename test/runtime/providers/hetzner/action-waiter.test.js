import { describe, expect, it, jest } from '@jest/globals';
import {
  createHetznerActionWaiter,
  HetznerActionFailedError,
  HetznerActionTimeoutError,
} from '../../../../src/core/runtime/providers/hetzner/action-waiter.js';

function action(overrides = {}) {
  return Object.freeze({
    id: 17,
    status: 'success',
    command: 'create_server',
    progress: 100,
    error: null,
    started: null,
    finished: null,
    ...overrides,
  });
}

describe('Hetzner exact-ID action waiter', () => {
  it('returns an already successful exact action without waiting', async () => {
    const getAction = jest.fn(async (_id) => action());
    const wait = jest.fn(async () => {});
    const waiter = createHetznerActionWaiter({ getAction, wait });

    await expect(waiter.waitForAction(17)).resolves.toEqual(action());
    expect(getAction).toHaveBeenCalledTimes(1);
    expect(getAction).toHaveBeenCalledWith(17);
    expect(wait).not.toHaveBeenCalled();
    expect(Object.isFrozen(waiter)).toBe(true);
  });

  it('polls only the exact action and uses the injected clock and wait', async () => {
    let currentTime = 1_000;
    const responses = [
      action({ status: 'running', progress: 10 }),
      action({ status: 'running', progress: 80 }),
      action(),
    ];
    const getAction = jest.fn(async () => responses.shift());
    const wait = jest.fn(async (/** @type {number} */ delayMs) => {
      currentTime += delayMs;
    });
    const waiter = createHetznerActionWaiter({
      getAction,
      now: () => currentTime,
      wait,
      timeoutMs: 10_000,
      pollIntervalMs: 250,
    });

    await expect(waiter.waitForAction(17)).resolves.toMatchObject({
      id: 17,
      status: 'success',
    });
    expect(getAction.mock.calls).toEqual([[17], [17], [17]]);
    expect(wait.mock.calls).toEqual([[250], [250]]);
  });

  it('raises a safe terminal error without reflecting provider detail', async () => {
    const unsafeDetail = 'credential=hcloud-secret';
    const waiter = createHetznerActionWaiter({
      getAction: async () =>
        action({
          status: 'error',
          error: {
            code: 'resource_limit_exceeded',
            message: unsafeDetail,
          },
        }),
    });

    const failure = await waiter.waitForAction(17).catch((error) => error);
    expect(failure).toBeInstanceOf(HetznerActionFailedError);
    expect(failure).toMatchObject({
      code: 'HETZNER_ACTION_FAILED',
      actionId: 17,
      providerCode: 'resource_limit_exceeded',
    });
    expect(JSON.stringify(failure)).not.toContain(unsafeDetail);
    expect(failure.message).not.toContain(unsafeDetail);
  });

  it('times out at the deadline without another provider read', async () => {
    let currentTime = 100;
    const getAction = jest.fn(async () =>
      action({ status: 'running', progress: 50 }),
    );
    const wait = jest.fn(async (/** @type {number} */ delayMs) => {
      currentTime += delayMs;
    });
    const waiter = createHetznerActionWaiter({
      getAction,
      now: () => currentTime,
      wait,
      timeoutMs: 400,
      pollIntervalMs: 250,
    });

    await expect(waiter.waitForAction(17)).rejects.toBeInstanceOf(
      HetznerActionTimeoutError,
    );
    expect(getAction).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls).toEqual([[250], [150]]);
  });

  it.each([
    ['a mismatched action ID', action({ id: 18 })],
    ['an unknown action status', action({ status: 'queued' })],
    ['a malformed terminal error', action({ status: 'error', error: {} })],
  ])('fails closed for %s', async (_name, response) => {
    const waiter = createHetznerActionWaiter({
      getAction: async () => response,
    });
    await expect(waiter.waitForAction(17)).rejects.toThrow(
      'Hetzner action waiter received an invalid action.',
    );
  });

  it('rejects invalid factory options and provider IDs before effects', async () => {
    expect(() =>
      createHetznerActionWaiter({ getAction: async () => action(), extra: 1 }),
    ).toThrow('Hetzner action waiter options are invalid.');
    const getAction = jest.fn(async () => action());
    const waiter = createHetznerActionWaiter({ getAction });
    await expect(waiter.waitForAction(0)).rejects.toThrow(
      'Hetzner action waiter received an invalid action.',
    );
    expect(getAction).not.toHaveBeenCalled();
  });
});
