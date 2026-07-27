import {
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
} from '../lib/ledger/execution-ledger-contract.js';

/**
 * Retry only an opaque operational rejection that may represent response
 * loss. Contract, budget, fence, and corruption failures are already
 * definitive. A generic provider error remains ambiguous even when it is
 * named AbortError: this call has no pre-dispatch cancellation contract, and
 * the exact replay is what discovers whether the first append committed.
 * @param {unknown} error - First append rejection.
 * @returns {boolean} - Whether one exact immediate retry is allowed.
 */
function isRetryableActivityLogAppendError(error) {
  return (
    error instanceof Error &&
    !(error instanceof TypeError) &&
    !(error instanceof RangeError) &&
    !(error instanceof ExecutionLedgerConflictError) &&
    !(error instanceof ExecutionLedgerProjectionError)
  );
}

/**
 * Build the host-owned component sink for one durably STARTED physical
 * attempt. Non-log frames remain ordering barriers but are not duplicated
 * into the auxiliary log store.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, attempt: Readonly<Record<string, any>>}} options - Exact durable attempt authority.
 * @returns {(frame: Readonly<Record<string, any>>) => Promise<void>} - Ordered component sink.
 */
export function createDurableActivityLogSink(options) {
  const ledger = options.ledger;
  const attempt = options.attempt;
  const scope = Object.freeze({
    appId: attempt.appId,
    revisionId: attempt.revisionId,
    activityId: attempt.activityId,
    runId: attempt.runId,
    invocationId: attempt.invocationId,
    attemptId: attempt.attemptId,
    fencingToken: attempt.fencingToken,
    generation: attempt.generation,
    coordinatorEpoch: attempt.coordinatorEpoch,
  });

  return async (frame) => {
    if (frame.type !== 'log') return;
    if (typeof ledger.appendActivityAttemptLog !== 'function') {
      throw new TypeError(
        'Durable activity logging requires ledger.appendActivityAttemptLog.',
      );
    }
    const request = Object.freeze({ ...scope, frame });
    try {
      await ledger.appendActivityAttemptLog(request);
    } catch (error) {
      if (!isRetryableActivityLogAppendError(error)) throw error;
      await ledger.appendActivityAttemptLog(request);
    }
  };
}

export default createDurableActivityLogSink;
