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
    await ledger.appendActivityAttemptLog({ ...scope, frame });
  };
}

export default createDurableActivityLogSink;
