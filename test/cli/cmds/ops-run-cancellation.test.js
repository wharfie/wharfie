/* eslint-env jest */

import { describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

import { createForegroundCancellation } from '../../../src/cli/cmds/ops_cmds/run.js';

describe('ops run foreground cancellation', () => {
  it.each(['SIGINT', 'SIGTERM'])(
    'turns the first %s into a structured cancellation and restores both signals',
    (receivedSignal) => {
      const processRef = new EventEmitter();
      const unrelatedSigint = jest.fn();
      processRef.on('SIGINT', unrelatedSigint);
      const cancellation = createForegroundCancellation(processRef);

      expect(processRef.listenerCount('SIGINT')).toBe(2);
      expect(processRef.listenerCount('SIGTERM')).toBe(1);

      processRef.emit(receivedSignal);

      expect(cancellation.signal.aborted).toBe(true);
      expect(cancellation.signal.reason).toMatchObject({
        name: 'CancellationRequested',
        code: 'operator-cancel-requested',
        details: { signal: receivedSignal },
      });
      expect(cancellation.signal.reason.message).toContain(receivedSignal);
      expect(processRef.listeners('SIGINT')).toEqual([unrelatedSigint]);
      expect(processRef.listenerCount('SIGTERM')).toBe(0);

      // EventEmitter returning false proves the other process signal is no
      // longer intercepted by this cancellation handle. A real process can
      // therefore apply its ordinary termination behavior.
      expect(processRef.emit('SIGTERM')).toBe(false);
      expect(cancellation.signal.reason.details.signal).toBe(receivedSignal);
    },
  );

  it('closes idempotently without aborting or removing unrelated listeners', () => {
    const processRef = new EventEmitter();
    const unrelatedSigint = jest.fn();
    processRef.on('SIGINT', unrelatedSigint);
    const cancellation = createForegroundCancellation(processRef);

    cancellation.close();
    cancellation.close();

    expect(cancellation.signal.aborted).toBe(false);
    expect(processRef.listeners('SIGINT')).toEqual([unrelatedSigint]);
    expect(processRef.listenerCount('SIGTERM')).toBe(0);
    processRef.emit('SIGINT');
    expect(unrelatedSigint).toHaveBeenCalledTimes(1);
    expect(cancellation.signal.aborted).toBe(false);
  });
});
