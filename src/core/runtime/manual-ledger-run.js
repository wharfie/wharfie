import { randomUUID } from 'node:crypto';

import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
} from '../lib/db/tables/execution-ledger.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
import { assertLogicalId } from './logical-id.js';
import { serializeActivityAttemptError } from './activity-attempt.js';

export const MANUAL_LEDGER_INVOCATION_ID = 'manual';

export const ManualLedgerRecoveryAction = Object.freeze({
  NONE: 'none',
  RELEASED_UNSTARTED_CLAIM: 'released-unstarted-claim',
  MARKED_STARTED_UNCERTAIN: 'marked-started-uncertain',
});

/**
 * @typedef {'none'|'released-unstarted-claim'|'marked-started-uncertain'} ManualLedgerRecoveryActionValue
 */

/**
 * @typedef {{found: boolean, mayExecute: boolean, action: ManualLedgerRecoveryActionValue, changed: boolean, outcome?: ReturnType<typeof outcomeFromState>}} ManualLedgerRecoveryResult
 */

const DEFAULT_ACTOR = Object.freeze({ kind: 'local', id: 'cli' });

/**
 * Create the durable identity behind a user-facing manual operation ID. The
 * app ID is part of the semantic input, so two apps can safely use the same
 * operator-provided ID in one shared control table.
 * @param {{appId: string, operationId: string}} options - Manual identity inputs.
 * @returns {string} - Stable opaque ledger run ID.
 */
export function createManualLedgerRunId(options) {
  assertLogicalId(options?.appId, 'appId');
  const operationId = assertLedgerOpaqueId(options?.operationId, 'operationId');
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:manual-ledger-run:v3',
    prefix: 'wlm',
    value: { appId: options.appId, operationId },
    valuePath: 'manual ledger run identity',
  });
}

/**
 * @param {Record<string, any>} run - Durable run projection.
 * @returns {'completed'|'failed'|'blocked'|'in-progress'} - User-visible outcome class.
 */
function dispositionForRun(run) {
  if (run.status === RunStatus.COMPLETED) return 'completed';
  if (run.status === RunStatus.FAILED || run.status === RunStatus.CANCELLED) {
    return 'failed';
  }
  if (run.status === RunStatus.BLOCKED) return 'blocked';
  return 'in-progress';
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {string} invocationId - Durable invocation identity.
 * @returns {Record<string, any>} - Current invocation projection.
 */
function getInvocation(view, invocationId) {
  const invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocationId,
  );
  if (!invocation) {
    throw new Error(
      `Execution ledger run ${view.run.runId} has no invocation ${invocationId}.`,
    );
  }
  return invocation;
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @returns {Record<string, any>} - Current generation's physical attempt.
 */
function getCurrentAttempt(view, invocation) {
  const attempt = view.attempts.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocation.invocationId &&
      candidate.generation === invocation.generation,
  );
  if (!attempt) {
    throw new Error(
      `Execution ledger run ${view.run.runId} has no attempt for invocation generation ${invocation.generation}.`,
    );
  }
  return attempt;
}

/**
 * @param {import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger - Ledger store.
 * @param {string} runId - Durable run identity.
 * @param {string} invocationId - Durable invocation identity.
 * @returns {Promise<{view: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>}>} - Verified current state.
 */
async function readCurrent(ledger, runId, invocationId) {
  const view = await ledger.rebuildRun(runId);
  if (!view) throw new Error(`Execution ledger run disappeared: ${runId}`);
  return { view, run: view.run, invocation: getInvocation(view, invocationId) };
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {string} invocationId - Durable invocation identity.
 * @param {boolean} [reused] - Whether the result came from retained state.
 * @returns {ReturnType<typeof outcomeFromState>} - Current public outcome.
 */
function outcomeFromView(view, invocationId, reused = true) {
  const invocation = getInvocation(view, invocationId);
  const attempt =
    invocation.generation === 0
      ? undefined
      : getCurrentAttempt(view, invocation);
  return outcomeFromState({ run: view.run, invocation, attempt, reused });
}

/**
 * @param {Record<string, any>} run - Current run projection.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @returns {boolean} - Whether state is runnable without asserting ownership.
 */
function mayExecuteFromState(run, invocation) {
  return (
    run.status === RunStatus.RUNNING &&
    invocation.status === InvocationStatus.RUNNABLE
  );
}

/**
 * @param {Record<string, any> | undefined} left - First attempt identity.
 * @param {Record<string, any>} right - Expected attempt identity.
 * @returns {boolean} - Whether both records name the same physical attempt.
 */
function isSameAttempt(left, right) {
  return (
    left?.attemptId === right.attemptId &&
    left?.fencingToken === right.fencingToken &&
    left?.generation === right.generation
  );
}

/**
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, reused?: boolean}} state - Durable state to expose.
 * @returns {{disposition: 'completed'|'failed'|'blocked'|'in-progress', reused: boolean, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, terminalSummary?: Record<string, any>, evidenceRef?: Record<string, any>}} - Public run outcome.
 */
function outcomeFromState({ run, invocation, attempt, reused = false }) {
  /** @type {{disposition: 'completed'|'failed'|'blocked'|'in-progress', reused: boolean, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, terminalSummary?: Record<string, any>, evidenceRef?: Record<string, any>}} */
  const result = {
    disposition: dispositionForRun(run),
    reused,
    run,
    invocation,
  };
  if (attempt) {
    result.attempt = attempt;
    if (attempt.terminal) result.terminalSummary = attempt.terminal;
    if (attempt.evidenceRef) result.evidenceRef = attempt.evidenceRef;
  }
  return result;
}

/**
 * Keep an uncertainty reason well within the first ledger slice's inline
 * payload cap even if a hostile local exception carries enormous metadata.
 * @param {string} phase - Failed lifecycle phase.
 * @param {unknown} error - Local error or rejection.
 * @returns {Record<string, any>} - Compact durable uncertainty reason.
 */
function uncertainReason(phase, error) {
  const serialized = serializeActivityAttemptError(
    error,
    'attempt-outcome-unknown',
  );
  return {
    kind: 'local-attempt-uncertain',
    phase,
    error: {
      code: serialized.code,
      name: serialized.name,
      message: serialized.message.slice(0, 4096),
    },
  };
}

/**
 * @param {string} attemptId - Physical attempt identity.
 * @returns {Record<string, any>} - Static reason for an operator-confirmed recovery.
 */
function preStartRecoveryReason(attemptId) {
  return {
    kind: 'operator-recovery-before-start',
    attemptId,
    message:
      'The operator confirmed the prior local runner stopped before dispatching this attempt.',
  };
}

/**
 * @param {string} attemptId - Physical attempt identity.
 * @returns {Record<string, any>} - Static reason for an operator-confirmed ambiguity decision.
 */
function startedRecoveryReason(attemptId) {
  return {
    kind: 'operator-recovery-after-start',
    attemptId,
    message:
      'The operator confirmed the prior local runner stopped after durable start; the physical outcome is unknown.',
  };
}

/**
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, attempt: Record<string, any>, expectedVersion: number, transitionId: string, actor: Record<string, any>, reason: Record<string, any>}} options - Uncertainty transition options.
 * @returns {Promise<{outcome: ReturnType<typeof outcomeFromState>, changed: boolean}>} - Blocked or already terminal outcome with transition ownership.
 */
async function markUncertainOrReadTerminalResult(options) {
  const {
    ledger,
    runId,
    invocationId,
    attempt,
    expectedVersion,
    transitionId,
    actor,
    reason,
  } = options;
  try {
    const result = await ledger.markAttemptUncertain({
      runId,
      invocationId,
      attemptId: attempt.attemptId,
      fencingToken: attempt.fencingToken,
      generation: attempt.generation,
      expectedVersion,
      transitionId,
      actor,
      coordinatorEpoch: 0,
      reason,
    });
    return {
      outcome: outcomeFromState({
        run: result.run,
        invocation: result.invocation,
        attempt: result.attempt,
      }),
      changed: result.applied,
    };
  } catch (markError) {
    const current = await readCurrent(ledger, runId, invocationId);
    const currentAttempt = getCurrentAttempt(current.view, current.invocation);
    if (
      current.run.status !== RunStatus.RUNNING ||
      current.invocation.status !== InvocationStatus.RUNNING ||
      currentAttempt.status !== AttemptStatus.STARTED
    ) {
      return {
        outcome: outcomeFromState({
          run: current.run,
          invocation: current.invocation,
          attempt: currentAttempt,
        }),
        changed: false,
      };
    }
    throw new AggregateError(
      [markError],
      `Could not durably record uncertainty for started attempt ${attempt.attemptId}.`,
    );
  }
}

/**
 * @param {Parameters<typeof markUncertainOrReadTerminalResult>[0]} options - Uncertainty transition options.
 * @returns {Promise<ReturnType<typeof outcomeFromState>>} - Blocked or already terminal outcome.
 */
async function markUncertainOrReadTerminal(options) {
  return (await markUncertainOrReadTerminalResult(options)).outcome;
}

/**
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, expectedAttempt: Record<string, any>, transitionId: string, actor: Record<string, any>, phase: string, error: unknown}} options - Failed local-dispatch state.
 * @returns {Promise<ReturnType<typeof outcomeFromState> | never>} - Blocked/terminal outcome, or rethrows a safely pre-start failure.
 */
async function settleDispatchFailure(options) {
  const {
    ledger,
    runId,
    invocationId,
    expectedAttempt,
    transitionId,
    actor,
    phase,
    error,
  } = options;
  const current = await readCurrent(ledger, runId, invocationId);
  const currentAttempt = getCurrentAttempt(current.view, current.invocation);

  // A stale worker must never repair whichever generation happens to be
  // current. If explicit recovery released this worker's unstarted claim and
  // another owner has already claimed a later generation, that later attempt
  // belongs to the new owner alone.
  if (
    currentAttempt.attemptId !== expectedAttempt.attemptId ||
    currentAttempt.fencingToken !== expectedAttempt.fencingToken ||
    currentAttempt.generation !== expectedAttempt.generation
  ) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: currentAttempt,
    });
  }

  if (currentAttempt.status === AttemptStatus.CLAIMED) {
    await ledger.abandonUnstartedAttempt({
      runId,
      invocationId,
      attemptId: currentAttempt.attemptId,
      fencingToken: currentAttempt.fencingToken,
      generation: currentAttempt.generation,
      expectedVersion: current.run.version,
      transitionId: `abandon:${currentAttempt.attemptId}`,
      actor,
      coordinatorEpoch: 0,
      reason: {
        kind: 'local-pre-start-failure',
        phase,
        message:
          'The local runtime did not receive this claimed attempt start frame.',
      },
    });
    throw error;
  }

  if (currentAttempt.status === AttemptStatus.STARTED) {
    return await markUncertainOrReadTerminal({
      ledger,
      runId,
      invocationId,
      attempt: currentAttempt,
      expectedVersion: current.run.version,
      transitionId,
      actor,
      reason: uncertainReason(phase, error),
    });
  }

  return outcomeFromState({
    run: current.run,
    invocation: current.invocation,
    attempt: currentAttempt,
  });
}

/**
 * Reconcile one existing local manual run without reading, compiling, or
 * dispatching its application source. This exists so an operator can make a
 * begun attempt visibly uncertain even after the current source revision has
 * changed or no longer builds.
 *
 * `mayExecute` means only that no pre-existing started attempt blocks a later
 * execution decision. It is not a coordinator lease and never authorizes a
 * caller to dispatch a changed revision.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId?: string, actor?: {kind: string, id: string}}} options - Existing run recovery request.
 * @returns {Promise<ManualLedgerRecoveryResult>} - Recovered durable state.
 */
export async function recoverManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('recoverManualLedgerActivity requires options.');
  }
  if (!options.ledger) {
    throw new TypeError('recoverManualLedgerActivity requires ledger.');
  }
  const ledger = options.ledger;
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  const invocationId =
    options.invocationId === undefined
      ? MANUAL_LEDGER_INVOCATION_ID
      : assertLedgerOpaqueId(options.invocationId, 'invocationId');
  const actor = options.actor || DEFAULT_ACTOR;
  const view = await ledger.rebuildRun(runId);
  if (!view) {
    return {
      found: false,
      mayExecute: false,
      action: ManualLedgerRecoveryAction.NONE,
      changed: false,
    };
  }

  const invocation = getInvocation(view, invocationId);
  if (invocation.status === InvocationStatus.RUNNABLE) {
    return {
      found: true,
      mayExecute: mayExecuteFromState(view.run, invocation),
      action: ManualLedgerRecoveryAction.NONE,
      changed: false,
      outcome: outcomeFromView(view, invocationId),
    };
  }
  if (invocation.status === InvocationStatus.RUNNING) {
    const attempt = getCurrentAttempt(view, invocation);
    if (attempt.status === AttemptStatus.CLAIMED) {
      try {
        const released = await ledger.abandonUnstartedAttempt({
          runId,
          invocationId,
          attemptId: attempt.attemptId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
          expectedVersion: view.run.version,
          transitionId: `recover-abandon:${attempt.attemptId}`,
          actor,
          coordinatorEpoch: 0,
          reason: preStartRecoveryReason(attempt.attemptId),
        });
        const current = await readCurrent(ledger, runId, invocationId);
        return {
          found: true,
          mayExecute: mayExecuteFromState(current.run, current.invocation),
          action: released.applied
            ? ManualLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM
            : ManualLedgerRecoveryAction.NONE,
          changed: released.applied,
          outcome: outcomeFromView(current.view, invocationId),
        };
      } catch (error) {
        // If a concurrent actor moved the original claim, do not turn a
        // recoverer into a stale owner. A confirmed recovery must still mark
        // that same physical attempt uncertain if it crossed the durable
        // STARTED boundary; it must never touch a newer generation.
        const current = await readCurrent(ledger, runId, invocationId);
        const currentAttempt =
          current.invocation.generation === 0
            ? undefined
            : getCurrentAttempt(current.view, current.invocation);
        if (
          current.run.status === RunStatus.RUNNING &&
          current.invocation.status === InvocationStatus.RUNNING &&
          currentAttempt?.status === AttemptStatus.CLAIMED &&
          isSameAttempt(currentAttempt, attempt)
        ) {
          throw error;
        }
        if (
          current.run.status === RunStatus.RUNNING &&
          current.invocation.status === InvocationStatus.RUNNING &&
          currentAttempt?.status === AttemptStatus.STARTED &&
          isSameAttempt(currentAttempt, attempt)
        ) {
          const recovered = await markUncertainOrReadTerminalResult({
            ledger,
            runId,
            invocationId,
            attempt: currentAttempt,
            expectedVersion: current.run.version,
            transitionId: `recover-uncertain:${currentAttempt.attemptId}`,
            actor,
            reason: startedRecoveryReason(currentAttempt.attemptId),
          });
          return {
            found: true,
            mayExecute: false,
            action: recovered.changed
              ? ManualLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN
              : ManualLedgerRecoveryAction.NONE,
            changed: recovered.changed,
            outcome: recovered.outcome,
          };
        }
        return {
          found: true,
          mayExecute: mayExecuteFromState(current.run, current.invocation),
          action: ManualLedgerRecoveryAction.NONE,
          changed: false,
          outcome: outcomeFromView(current.view, invocationId),
        };
      }
    }
    if (attempt.status === AttemptStatus.STARTED) {
      const recovered = await markUncertainOrReadTerminalResult({
        ledger,
        runId,
        invocationId,
        attempt,
        expectedVersion: view.run.version,
        transitionId: `recover-uncertain:${attempt.attemptId}`,
        actor,
        reason: startedRecoveryReason(attempt.attemptId),
      });
      return {
        found: true,
        mayExecute: false,
        action: recovered.changed
          ? ManualLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN
          : ManualLedgerRecoveryAction.NONE,
        changed: recovered.changed,
        outcome: recovered.outcome,
      };
    }
    return {
      found: true,
      mayExecute: false,
      action: ManualLedgerRecoveryAction.NONE,
      changed: false,
      outcome: outcomeFromView(view, invocationId),
    };
  }

  return {
    found: true,
    mayExecute: false,
    action: ManualLedgerRecoveryAction.NONE,
    changed: false,
    outcome: outcomeFromView(view, invocationId),
  };
}

/**
 * Create, claim, and execute exactly one manual activity through the
 * append-only ledger. A normal repeat never steals a RUNNING attempt because
 * coordinator leases do not exist yet; recovery is a separate operator action
 * that never accepts or compiles current application source.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, appId: string, revisionId: string, activityId: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}, createFencingToken?: () => string, executeAttempt: (startFrame: Readonly<Record<string, any>>) => Promise<Readonly<Record<string, any>>>}} options - Bound manual activity execution.
 * @returns {Promise<ReturnType<typeof outcomeFromState>>} - Durable terminal, blocked, or in-progress result.
 */
export async function runManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('runManualLedgerActivity requires options.');
  }
  if (!options.ledger) {
    throw new TypeError('runManualLedgerActivity requires ledger.');
  }
  if (typeof options.executeAttempt !== 'function') {
    throw new TypeError('runManualLedgerActivity requires executeAttempt.');
  }
  if (Object.prototype.hasOwnProperty.call(options, 'recover')) {
    throw new TypeError(
      'runManualLedgerActivity.recover is not supported; use recoverManualLedgerActivity before a separate execution decision.',
    );
  }
  if (
    options.createFencingToken !== undefined &&
    typeof options.createFencingToken !== 'function'
  ) {
    throw new TypeError(
      'runManualLedgerActivity.createFencingToken must be a function when provided.',
    );
  }

  const ledger = options.ledger;
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  assertLogicalId(options.appId, 'appId');
  assertLogicalId(options.activityId, 'activityId');
  const invocationId = MANUAL_LEDGER_INVOCATION_ID;
  const actor = options.actor || DEFAULT_ACTOR;
  const createFencingToken =
    options.createFencingToken || (() => `local-${randomUUID()}`);

  const created = await ledger.createManualRun({
    runId,
    appId: options.appId,
    revisionId: options.revisionId,
    invocationId,
    activityId: options.activityId,
    ...(Object.prototype.hasOwnProperty.call(options, 'input')
      ? { input: options.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
      ? { callerMetadata: options.callerMetadata }
      : {}),
    transitionId: 'create',
    actor,
    coordinatorEpoch: 0,
  });

  const current = await readCurrent(ledger, runId, invocationId);
  if (current.invocation.status === InvocationStatus.UNCERTAIN) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: !created.applied,
    });
  }
  if (
    current.invocation.status === InvocationStatus.COMPLETED ||
    current.invocation.status === InvocationStatus.FAILED ||
    current.invocation.status === InvocationStatus.CANCELLED
  ) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: true,
    });
  }

  if (current.invocation.status === InvocationStatus.RUNNING) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: !created.applied,
    });
  }

  if (current.invocation.status !== InvocationStatus.RUNNABLE) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      reused: !created.applied,
    });
  }

  const fencingToken = assertLedgerOpaqueId(
    createFencingToken(),
    'local fencing token',
  );
  const claim = await ledger.claimInvocation({
    runId,
    invocationId,
    fencingToken,
    expectedGeneration: current.invocation.generation,
    expectedVersion: current.run.version,
    transitionId: `claim:${current.invocation.generation + 1}`,
    actor,
    coordinatorEpoch: 0,
  });
  if (!claim.attempt) {
    throw new Error(`Execution ledger claim has no attempt: ${runId}`);
  }
  const attempt = claim.attempt;
  // Claim receipts are idempotency evidence, not a delivery lease. A replayed
  // claim may belong to a different process, and the post-write read may have
  // already observed recovery or a newer generation. Only the caller that
  // actually appended a still-live CLAIMED transition can advance it to
  // STARTED.
  if (
    !claim.applied ||
    claim.run.status !== RunStatus.RUNNING ||
    claim.invocation.status !== InvocationStatus.RUNNING ||
    attempt.status !== AttemptStatus.CLAIMED
  ) {
    const current = await readCurrent(ledger, runId, invocationId);
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: true,
    });
  }

  /** @type {any} */
  let started;
  try {
    started = await ledger.markAttemptStarted({
      runId,
      invocationId,
      attemptId: attempt.attemptId,
      fencingToken,
      generation: attempt.generation,
      expectedVersion: claim.run.version,
      transitionId: `start:${attempt.attemptId}`,
      actor,
      coordinatorEpoch: 0,
    });
    if (!started.dispatchAuthorized) {
      return await settleDispatchFailure({
        ledger,
        runId,
        invocationId,
        expectedAttempt: attempt,
        transitionId: `uncertain:${attempt.attemptId}`,
        actor,
        phase: 'start-replay',
        error: new Error(
          'The durable attempt-start receipt was replayed; physical dispatch cannot be confirmed.',
        ),
      });
    }
    const evidence = await options.executeAttempt(started.startFrame);
    const terminalRequest = {
      runId,
      invocationId,
      attemptId: attempt.attemptId,
      fencingToken,
      generation: attempt.generation,
      expectedVersion: started.run.version,
      transitionId: `terminal:${attempt.attemptId}`,
      evidence,
      actor,
      coordinatorEpoch: 0,
    };
    let terminal;
    try {
      terminal = await ledger.commitVerifiedAttemptTerminal(terminalRequest);
    } catch (firstCommitError) {
      try {
        terminal = await ledger.commitVerifiedAttemptTerminal(terminalRequest);
      } catch (secondCommitError) {
        return await settleDispatchFailure({
          ledger,
          runId,
          invocationId,
          expectedAttempt: attempt,
          transitionId: `uncertain:${attempt.attemptId}`,
          actor,
          phase: 'terminal-commit',
          error: new AggregateError(
            [firstCommitError, secondCommitError],
            'Could not confirm the durable activity terminal.',
          ),
        });
      }
    }
    return outcomeFromState({
      run: terminal.run,
      invocation: terminal.invocation,
      attempt: terminal.attempt,
      reused: !created.applied,
    });
  } catch (error) {
    return await settleDispatchFailure({
      ledger,
      runId,
      invocationId,
      expectedAttempt: attempt,
      transitionId: `uncertain:${attempt.attemptId}`,
      actor,
      phase: started ? 'runtime-dispatch' : 'start-dispatch',
      error,
    });
  }
}

export default {
  MANUAL_LEDGER_INVOCATION_ID,
  ManualLedgerRecoveryAction,
  createManualLedgerRunId,
  recoverManualLedgerActivity,
  runManualLedgerActivity,
};
