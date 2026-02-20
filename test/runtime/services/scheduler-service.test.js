/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';

import { startSchedulerService } from '../../../lambdas/lib/actor/runtime/services/scheduler-service.js';

describe('Scheduler service (cron, UTC)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires at expected UTC times', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-18T00:00:30.000Z'));

    const invoke = jest.fn(async () => {});
    const svc = await startSchedulerService({
      role: 'leader',
      triggers: [{ actor: 'alpha', cron: '*/2 * * * *' }],
      invoke,
    });

    try {
      expect(invoke).toHaveBeenCalledTimes(0);

      // Next match after 00:00:30Z for */2 minutes is 00:02:00Z.
      await jest.advanceTimersByTimeAsync(89_000);
      expect(invoke).toHaveBeenCalledTimes(0);

      await jest.advanceTimersByTimeAsync(1_000);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('alpha', {
        cron: '*/2 * * * *',
        scheduledTime: '2026-02-18T00:02:00.000Z',
      });

      await jest.advanceTimersByTimeAsync(120_000);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenNthCalledWith(2, 'alpha', {
        cron: '*/2 * * * *',
        scheduledTime: '2026-02-18T00:04:00.000Z',
      });
    } finally {
      await svc.stop();
    }
  });

  it('skips missed fires after restart (no backfill)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-18T00:00:30.000Z'));

    const invoke = jest.fn(async () => {});
    const svc = await startSchedulerService({
      role: 'leader',
      triggers: [{ actor: 'alpha', cron: '* * * * *' }],
      invoke,
    });

    // First fire at 00:01:00Z
    await jest.advanceTimersByTimeAsync(30_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('alpha', {
      cron: '* * * * *',
      scheduledTime: '2026-02-18T00:01:00.000Z',
    });

    // Stop (simulate restart / downtime)
    await svc.stop();

    // Jump forward 5 minutes while stopped: 00:06:00Z.
    await jest.advanceTimersByTimeAsync(300_000);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Restart: should NOT backfill 00:02..00:06.
    svc.start();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Next fire should be 00:07:00Z.
    await jest.advanceTimersByTimeAsync(59_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(2, 'alpha', {
      cron: '* * * * *',
      scheduledTime: '2026-02-18T00:07:00.000Z',
    });

    await svc.stop();
  });
});
