import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  createPackageTarball,
  NPM_COMMAND,
  readJson,
  REPO_ROOT,
  runCommand,
} from './package-verification.js';
import {
  attachSeaInspector,
  spawnInspectorPausedProcess,
} from './sea-inspector.js';

const RESIDENT_SERVICE_TIMEOUT_MS = 20_000;
const RESIDENT_SERVICE_POLL_INTERVAL_MS = 50;
const CRASH_RECOVERY_TIMEOUT_MS = 60_000;
const CRASH_RECOVERY_POLL_INTERVAL_MS = 100;
const CRASH_RECOVERY_MIN_RESPONSE_BYTES = 512 * 1024;
const CRASH_RECOVERY_TERMINAL_PADDING_EFFECTS = 20;
const SEA_CRASH_EFFECT_ID = 'persist-portable-state';
const SEA_CRASH_ADAPTER_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/effects/builtin-catalog.js',
  anchor: 'assertOptionalAbortSignal(input.signal);',
});
const SEA_CRASH_DESTINATION_WRITE_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/lib/db/tables/application-state.js',
  anchor: 'const identity = await assertStoreIdentity(input.storeId);',
  occurrence: 1,
});
const SEA_CRASH_DESTINATION_TRANSACTION_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/lib/db/tables/application-state.js',
  // This condition occurs only in the fresh put-if-absent transaction. It
  // excludes store initialization and reconciliation's negative closure, so
  // one successor adapter delivery yields exactly one observable write.
  anchor: 'resolutionAbsentCondition(input.destinationEffectId),',
  occurrence: 1,
});
const SEA_ACTIVITY_DISPATCH_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/durable-activity-host.js',
  anchor: 'return await invokeManifestActivityAttemptWithStart({',
});
const SEA_WORKFLOW_CLAIMED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/workflow-ledger-run.js',
  // The exact claim result is authoritative; no STARTED request exists yet.
  anchor: 'let startRequest = {',
});
const SEA_WORKFLOW_DISPATCH_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/durable-workflow-host.js',
  // STARTED is durably readable before this authored-activity handoff.
  anchor: 'await invokeManifestActivityAttemptWithStart({',
});
const SEA_WORKFLOW_EVIDENCE_RETURNED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/workflow-ledger-run.js',
  // A complete component transcript is in host memory, but the workflow
  // terminal transition has not published or referenced it yet.
  anchor: 'let terminalCursor = cursorGuard(started.workflowCursor);',
});
const SEA_WORKFLOW_TERMINAL_COMMITTED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/workflow-ledger-run.js',
  // The compound terminal and its verified readback are complete; the
  // resident loop cannot observe or claim the successor until this returns.
  anchor: 'return outcomeFromCurrent(current, { dispatched: true });',
});
const SEA_WORKFLOW_RECOVERY_RETURNED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/operator/execution-ledger-operator.js',
  // The mutating service has closed and relinquished ownership; the public
  // command has not yet constructed or emitted its redacted response.
  anchor: 'createExecutionLedgerRecoveryOperatorView(',
});
const SEA_WORKFLOW_RECONCILIATION_RETURNED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/operator/execution-ledger-operator.js',
  // The mutating service has closed and relinquished ownership; the public
  // command has not yet constructed or emitted its redacted response.
  anchor: 'createExecutionLedgerReconciliationOperatorView(',
});
const SEA_APP_CLI_DISPATCH_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/resources/builds/packaged-app-entry.js',
  anchor: 'await runDeveloperCli(developerCliModule, {',
});
const SEA_EFFECT_RESOLUTION_WRITE_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/lib/db/tables/application-state.js',
  anchor: 'receiptAbsentCondition(input.destinationEffectId),',
});
const SEA_EFFECT_DESTINATION_RESOLVED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/operator/execution-ledger-operator.js',
  anchor: 'let resolution;',
});
const SEA_EFFECT_EVIDENCE_PUBLISHED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
  anchor: 'const reconciliation = {',
  // The first reconciliation object belongs to the dedicated successor
  // lifecycle. This matrix verifies ordinary effect reconciliation.
  occurrence: 2,
});
const SEA_EFFECT_LEDGER_RECONCILED_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/runtime/operator/execution-ledger-operator.js',
  anchor: 'const current = await options.ledger.rebuildRun(options.runId);',
});
const SEA_RECOVERY_CANCELLATION_REASON = Object.freeze({
  kind: 'managed-effect-cancelled-before-start',
  phase: 'before-durable-effect-start',
  message:
    'The retained request never crossed the durable adapter-dispatch boundary before runner exclusion.',
});
const SEA_RECOVERY_UNCERTAINTY_REASON = Object.freeze({
  kind: 'managed-effect-recovery-outcome-unknown',
  phase: 'after-runner-exclusion',
  message:
    'The retained effect was started, but its destination exposed no permanent verifier-backed outcome receipt.',
});
const SEA_STOPPED_ATTEMPT_RECOVERY_REASON = Object.freeze({
  kind: 'operator-recovery-after-start',
  phase: 'after-runner-exclusion',
  message:
    'The prior runner stopped after durable attempt start; its physical activity outcome is unknown.',
});
const SEA_WORKFLOW_ID = 'portable-linear';
const SEA_TIMER_SIGNAL_WORKFLOW_ID = 'portable-timer-signal';
const SEA_WORKFLOW_ACTIVITY_ID = 'workflow-step';
const SEA_CRASH_CASES = Object.freeze([
  {
    boundary: 'request-payload-published',
    label: 'managed-effect request payload publication',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      anchor:
        "const requestDigest = createTransitionRequestDigest('effect-requested', {",
      occurrence: 2,
    },
    runVersion: 3,
    effectBefore: null,
    effectVersionBefore: null,
    effectAfter: null,
    effectVersionAfter: null,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 0,
    destinationState: false,
    orphanPayloadsBefore: 1,
    orphanPayloadsAfter: 1,
    eventEffects: [],
  },
  {
    boundary: 'request-transaction-committed',
    label: 'managed-effect request transaction',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/managed-effect.js',
      anchor: 'delivery = delivery ?? (await readDelivery());',
    },
    runVersion: 4,
    effectBefore: 'PENDING',
    effectVersionBefore: 1,
    effectAfter: 'CANCELLED',
    effectVersionAfter: 2,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'cancelled-before-start',
    adapterEntries: 0,
    destinationState: false,
    orphanPayloadsBefore: 0,
    orphanPayloadsAfter: 0,
    eventEffects: [{ effectId: SEA_CRASH_EFFECT_ID, status: 'CANCELLED' }],
  },
  {
    boundary: 'start-transaction-committed',
    label: 'managed-effect start transaction',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/managed-effect.js',
      anchor: 'outcome = await adapter.execute({',
    },
    runVersion: 5,
    effectBefore: 'STARTED',
    effectVersionBefore: 2,
    effectAfter: 'UNCERTAIN',
    effectVersionAfter: 3,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'outcome-uncertain',
    adapterEntries: 0,
    destinationState: false,
    orphanPayloadsBefore: 0,
    orphanPayloadsAfter: 0,
    eventEffects: [{ effectId: SEA_CRASH_EFFECT_ID, status: 'UNCERTAIN' }],
  },
  {
    boundary: 'destination-transaction-committed',
    label: 'application-state destination transaction',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/effects/builtin-catalog.js',
      anchor: 'return createApplicationStateOutcomeFromReceipt(receipt);',
    },
    runVersion: 5,
    effectBefore: 'STARTED',
    effectVersionBefore: 2,
    effectAfter: 'COMPLETED',
    effectVersionAfter: 3,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'outcome-recovered',
    adapterEntries: 1,
    destinationState: true,
    orphanPayloadsBefore: 0,
    orphanPayloadsAfter: 0,
    eventEffects: [{ effectId: SEA_CRASH_EFFECT_ID, status: 'COMPLETED' }],
  },
  {
    boundary: 'outcome-payload-published',
    label: 'managed-effect outcome payload publication',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      anchor: 'const eventType = candidateOutcome.ok',
    },
    runVersion: 5,
    effectBefore: 'STARTED',
    effectVersionBefore: 2,
    effectAfter: 'COMPLETED',
    effectVersionAfter: 3,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'outcome-recovered',
    adapterEntries: 1,
    destinationState: true,
    orphanPayloadsBefore: 1,
    orphanPayloadsAfter: 0,
    eventEffects: [{ effectId: SEA_CRASH_EFFECT_ID, status: 'COMPLETED' }],
  },
  {
    boundary: 'outcome-ledger-committed',
    label: 'managed-effect outcome transaction',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/managed-effect.js',
      anchor: 'const terminal = await readDelivery();',
    },
    runVersion: 6,
    effectBefore: 'COMPLETED',
    effectVersionBefore: 3,
    effectAfter: 'COMPLETED',
    effectVersionAfter: 3,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 1,
    destinationState: true,
    orphanPayloadsBefore: 0,
    orphanPayloadsAfter: 0,
    eventEffects: [],
  },
  {
    boundary: 'host-effect-response-accepted',
    label: 'host effect response before worker delivery',
    breakpoint: {
      sourceSuffix: 'src/core/lib/code-execution/worker.js',
      anchor: 'attempt.effectRequests.delete(effectId);',
      occurrence: 1,
    },
    runVersion: 6,
    effectBefore: 'COMPLETED',
    effectVersionBefore: 3,
    effectAfter: 'COMPLETED',
    effectVersionAfter: 3,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 1,
    destinationState: true,
    orphanPayloadsBefore: 0,
    orphanPayloadsAfter: 0,
    eventEffects: [],
  },
  {
    boundary: 'user-continuation-fsynced',
    label: 'authored user continuation after effect delivery',
    breakpoint: null,
    runVersion: 6,
    effectBefore: 'COMPLETED',
    effectVersionBefore: 3,
    effectAfter: 'COMPLETED',
    effectVersionAfter: 3,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 1,
    destinationState: true,
    orphanPayloadsBefore: 0,
    orphanPayloadsAfter: 0,
    eventEffects: [],
  },
]);
const SEA_MIXED_SETTLEMENT_EFFECT_SPECS = Object.freeze([
  {
    effectId: '01-pending',
    state: /** @type {const} */ ('PENDING'),
  },
  {
    effectId: '02-receipt',
    state: /** @type {const} */ ('STARTED_RECEIPT'),
  },
  {
    effectId: '03-absent',
    state: /** @type {const} */ ('STARTED_ABSENT'),
  },
  {
    effectId: '04-terminal',
    state: /** @type {const} */ ('TERMINAL'),
  },
]);
const SEA_MIXED_SETTLEMENT_CRASH_CASES = Object.freeze([
  {
    boundary: 'recovered-outcome-published',
    label: 'mixed-effect recovered outcome payload publication',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      anchor: 'const digestDecisions = prepared.map((item) => ({',
    },
    settledAtBoundary: false,
  },
  {
    boundary: 'compound-transaction-committed',
    label: 'mixed-effect compound settlement transaction',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      anchor: 'const next = await readVerifiedRun(input.runId);',
    },
    settledAtBoundary: true,
  },
  {
    boundary: 'recovery-helper-returned',
    label: 'mixed-effect recovery helper return before operator readback',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/operator/execution-ledger-operator.js',
      // This unique guard runs after ordinary mixed-effect recovery and
      // application-state cleanup, but before the operator readback.
      anchor: 'if (!recovery) {',
    },
    settledAtBoundary: true,
  },
]);
const SEA_EFFECT_RECONCILIATION_SPECS = Object.freeze([
  {
    effectId: '01-late-receipt',
    state: /** @type {const} */ ('STARTED_ABSENT'),
  },
  {
    effectId: '02-resolution-before-ledger',
    state: /** @type {const} */ ('STARTED_ABSENT'),
  },
  {
    effectId: '03-payload-before-ledger',
    state: /** @type {const} */ ('STARTED_ABSENT'),
  },
  {
    effectId: '04-ledger-before-response',
    state: /** @type {const} */ ('STARTED_ABSENT'),
  },
]);
const SEA_EFFECT_RECONCILIATION_CRASH_CASES = Object.freeze([
  {
    effectId: '02-resolution-before-ledger',
    reconciliationId: 'sea-resolution-before-ledger',
    label: 'effect destination resolution before ledger reconciliation',
    breakpoint: SEA_EFFECT_DESTINATION_RESOLVED_BREAKPOINT,
    ledgerCommittedAtBoundary: false,
  },
  {
    effectId: '03-payload-before-ledger',
    reconciliationId: 'sea-payload-before-ledger',
    label: 'effect evidence payload publication before ledger append',
    breakpoint: SEA_EFFECT_EVIDENCE_PUBLISHED_BREAKPOINT,
    payloadPublishedAtBoundary: true,
    ledgerCommittedAtBoundary: false,
  },
  {
    effectId: '04-ledger-before-response',
    reconciliationId: 'sea-ledger-before-response',
    label: 'effect ledger reconciliation before operator response',
    breakpoint: SEA_EFFECT_LEDGER_RECONCILED_BREAKPOINT,
    ledgerCommittedAtBoundary: true,
  },
]);
const SEA_SUCCESSOR_SOURCE_EFFECT_ID = 'successor-source-effect';
const SEA_SUCCESSOR_CRASH_CASES = Object.freeze([
  {
    boundary: 'successor-target-request-published',
    label: 'successor target-request payload publication',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      // This is the first statement after the immutable target request is
      // published and before the atomic source/target transaction is built.
      anchor: 'const sourceSequence = state.head.sequence + 1;',
    },
    adapterEntries: 0,
    applicationStateWrites: 0,
    authorizationCommitted: false,
    target: null,
    destinationApplied: false,
    orphanPayloads: 1,
  },
  {
    boundary: 'successor-authorization-committed',
    label: 'atomic successor authorization and target creation',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      // The cross-partition transaction has returned; the following readback
      // has not yet influenced control flow or authorized adapter entry.
      anchor: 'const [acceptedSource, acceptedTarget] = await Promise.all([',
    },
    adapterEntries: 0,
    applicationStateWrites: 0,
    authorizationCommitted: true,
    target: {
      run: 'RUNNING',
      invocation: 'RUNNABLE',
      attempt: null,
      effect: null,
      events: ['effect-successor-run-created'],
    },
    destinationApplied: false,
    orphanPayloads: 0,
  },
  {
    boundary: 'successor-atomic-start-committed',
    label: 'atomic successor start before adapter entry',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/managed-effect-successor.js',
      anchor: 'if (!started.dispatchAuthorized) {',
    },
    adapterEntries: 0,
    applicationStateWrites: 0,
    authorizationCommitted: true,
    target: {
      run: 'RUNNING',
      invocation: 'RUNNING',
      attempt: 'STARTED',
      effect: 'STARTED',
      events: ['effect-successor-run-created', 'effect-successor-started'],
    },
    destinationApplied: false,
    orphanPayloads: 0,
  },
  {
    boundary: 'successor-destination-committed',
    label: 'successor destination transaction before terminal publication',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/effects/builtin-catalog.js',
      anchor: 'return createApplicationStateOutcomeFromReceipt(receipt);',
    },
    adapterEntries: 1,
    applicationStateWrites: 1,
    authorizationCommitted: true,
    target: {
      run: 'RUNNING',
      invocation: 'RUNNING',
      attempt: 'STARTED',
      effect: 'STARTED',
      events: ['effect-successor-run-created', 'effect-successor-started'],
    },
    destinationApplied: true,
    orphanPayloads: 0,
  },
  {
    boundary: 'successor-terminal-payloads-published',
    label: 'successor terminal payload publication before ledger append',
    breakpoint: {
      sourceSuffix: 'src/core/lib/db/tables/execution-ledger.js',
      // This dedicated digest declaration runs after both outcome and terminal
      // evidence payloads have been published, but before any receipt read or
      // ledger append. Its transition-specific name keeps the source-map
      // boundary stable as unrelated transitions are added to this module.
      anchor:
        'const successorTerminalRequestDigest = createTransitionRequestDigest(',
    },
    adapterEntries: 1,
    applicationStateWrites: 1,
    authorizationCommitted: true,
    target: {
      run: 'RUNNING',
      invocation: 'RUNNING',
      attempt: 'STARTED',
      effect: 'STARTED',
      events: ['effect-successor-run-created', 'effect-successor-started'],
    },
    destinationApplied: true,
    orphanPayloads: 2,
  },
  {
    boundary: 'successor-atomic-terminal-committed',
    label: 'atomic successor terminal before operator response',
    breakpoint: {
      sourceSuffix: 'src/core/runtime/operator/execution-ledger-operator.js',
      // The first occurrence is retained-target replay. Fresh execution reaches
      // this second read only after executeManagedEffectSuccessorRun returns.
      anchor: 'const sourceView = await ledger.rebuildRun(current.run.runId);',
      occurrence: 2,
    },
    adapterEntries: 1,
    applicationStateWrites: 1,
    authorizationCommitted: true,
    target: {
      run: 'COMPLETED',
      invocation: 'COMPLETED',
      attempt: 'COMPLETED',
      effect: 'COMPLETED',
      events: [
        'effect-successor-run-created',
        'effect-successor-started',
        'effect-successor-terminal',
      ],
    },
    destinationApplied: true,
    preexistingBusiness: true,
    orphanPayloads: 0,
  },
]);

/** @typedef {{code: number | null, signal: string | null}} ResidentServiceExit */

/**
 * @param {number} milliseconds - Delay duration.
 * @returns {Promise<void>} - Resolves after the requested duration.
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Spawn a resident SEA while retaining bounded diagnostics for a failed
 * lifecycle assertion. This is deliberately asynchronous: ledger-service
 * does not terminate until it receives a signal.
 * @param {string} command - Copied SEA executable path.
 * @param {{cwd: string, env: Record<string, string>, args?: string[], consumeStdout?: boolean}} options - Child process options.
 * @returns {{child: import('node:child_process').ChildProcess, exited: Promise<ResidentServiceExit>, getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} - Resident process handle.
 */
function spawnResidentService(command, options) {
  const child = spawn(command, options.args || [], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  /** @type {ResidentServiceExit | null} */
  let exitResult = null;
  if (options.consumeStdout === false) {
    // Leaving the pipe paused creates an external response-delivery boundary:
    // the child can commit durable work, but an oversized response cannot
    // drain before the verifier sends SIGKILL.
    child.stdout?.pause();
  } else {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-64 * 1024);
    });
  }
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024);
  });
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      stderr = `${stderr}${error instanceof Error ? error.message : String(error)}`;
      exitResult = { code: null, signal: null };
      resolve(exitResult);
    });
    child.once('exit', (code, signal) => {
      exitResult = { code, signal: signal || null };
      resolve(exitResult);
    });
  });
  return {
    child,
    exited,
    getExit: () => exitResult,
    getOutput: () => ({ stdout, stderr }),
  };
}

/**
 * @param {{getOutput: () => {stdout: string, stderr: string}}} service - Resident process handle.
 * @param {string} message - Failure context.
 * @returns {Error} - Diagnostic-rich failure.
 */
function residentServiceError(service, message) {
  const output = service.getOutput();
  return new Error(
    [
      message,
      output.stdout ? `stdout:\n${output.stdout}` : '',
      output.stderr ? `stderr:\n${output.stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/**
 * @param {Promise<T>} promise - Operation to bound.
 * @param {number} timeoutMs - Maximum wait duration.
 * @param {string} label - Failure label.
 * @returns {Promise<T>} - Completed result.
 * @template T
 */
async function waitWithTimeout(promise, timeoutMs, label) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {{child: import('node:child_process').ChildProcess, exited: Promise<ResidentServiceExit>, getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Resident process handle.
 * @param {'SIGKILL'|'SIGTERM'} signal - Signal to send.
 * @returns {Promise<ResidentServiceExit>} - Process exit result.
 */
async function signalResidentService(service, signal) {
  if (!service.getExit()) {
    const delivered = service.child.kill(signal);
    if (!delivered && !service.getExit()) {
      throw residentServiceError(
        service,
        `Could not send ${signal} to the resident SEA process.`,
      );
    }
  }
  return await waitWithTimeout(
    service.exited,
    RESIDENT_SERVICE_TIMEOUT_MS,
    `resident SEA process after ${signal}`,
  );
}

/**
 * Start reading a deliberately paused stdout only far enough to prove the
 * packaged response has begun. One byte is consumed; the stream is then left
 * paused so the oversized remainder continues to backpressure the child.
 * @param {{child: import('node:child_process').ChildProcess, getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Output-blocked relocated SEA.
 * @returns {Promise<Buffer>} - The first response byte.
 */
async function waitForPausedStdoutByte(service) {
  const stdout = service.child.stdout;
  if (!stdout) {
    throw residentServiceError(
      service,
      'Output-blocked relocated SEA has no readable stdout pipe.',
    );
  }
  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      stdout.removeListener('readable', readFirstByte);
      stdout.removeListener('error', rejectFromStream);
      service.child.removeListener('exit', rejectFromExit);
      stdout.pause();
    };
    const rejectWith = (error) => {
      cleanup();
      reject(error);
    };
    const rejectFromStream = (error) => {
      rejectWith(
        residentServiceError(
          service,
          `Could not read the relocated SEA response boundary: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    };
    const rejectFromExit = () => {
      rejectWith(
        residentServiceError(
          service,
          `Relocated SEA exited before the response boundary was observed. Exit: ${JSON.stringify(service.getExit())}.`,
        ),
      );
    };
    const readFirstByte = () => {
      const byte = stdout.read(1);
      if (byte !== null) {
        cleanup();
        resolve(Buffer.from(byte));
        return;
      }
      stdout.once('readable', readFirstByte);
    };
    const timer = setTimeout(
      () =>
        rejectWith(
          residentServiceError(
            service,
            `Relocated SEA emitted no response byte within ${CRASH_RECOVERY_TIMEOUT_MS}ms after its durable commit.`,
          ),
        ),
      CRASH_RECOVERY_TIMEOUT_MS,
    );
    stdout.once('error', rejectFromStream);
    service.child.once('exit', rejectFromExit);
    readFirstByte();
  });
}

/**
 * Force cleanup without replacing the primary verifier error.
 * @param {{child: import('node:child_process').ChildProcess, exited: Promise<ResidentServiceExit>, getExit: () => ResidentServiceExit | null} | undefined} service - Optional resident process handle.
 * @returns {Promise<void>} - Best-effort cleanup completion.
 */
async function stopResidentServiceForCleanup(service) {
  if (!service) return;
  try {
    if (!service.getExit()) {
      service.child.kill('SIGKILL');
      await waitWithTimeout(
        service.exited,
        RESIDENT_SERVICE_TIMEOUT_MS,
        'resident SEA cleanup',
      );
    }
  } catch {
    // The outer verifier error remains the useful failure. CI worker teardown
    // will reap a pathological child that ignored SIGKILL.
  } finally {
    service.child.stdout?.destroy();
    service.child.stderr?.destroy();
  }
}

/**
 * Load a host-side durable lifecycle reader from the installed tarball. The
 * observer is intentionally not part of the clean process environment; it
 * only reads the control store written by the copied standalone SEA.
 * @param {{installedPackageRoot: string, controlPath: string, tableName: string, appId: string}} options - Observer inputs.
 * @returns {Promise<{serviceId: string, getSessionEndpoint: (sessionId: string, sessionRoot: string) => string, read: () => Promise<Record<string, any> | null>, readOwnership: () => Promise<Record<string, any> | null>}>} - Lifecycle observer.
 */
async function createInstalledLedgerLifecycleObserver(options) {
  const adapterModule = await import(
    pathToFileURL(
      path.join(
        options.installedPackageRoot,
        'src',
        'core',
        'lib',
        'db',
        'adapters',
        'lmdb.js',
      ),
    ).href
  );
  const lifecycleModule = await import(
    pathToFileURL(
      path.join(
        options.installedPackageRoot,
        'src',
        'core',
        'lib',
        'db',
        'tables',
        'ledger-service-lifecycle.js',
      ),
    ).href
  );
  const localSessionModule = await import(
    pathToFileURL(
      path.join(
        options.installedPackageRoot,
        'src',
        'core',
        'runtime',
        'local-service-session.js',
      ),
    ).href
  );
  const serviceId = lifecycleModule.createLedgerServiceId({
    appId: options.appId,
  });
  return {
    serviceId,
    getSessionEndpoint: (sessionId, sessionRoot) =>
      localSessionModule.getLocalServiceSessionEndpoint({
        serviceId,
        sessionId,
        sessionRoot,
      }),
    read: async () => {
      const db = adapterModule.default({
        path: options.controlPath,
        readOnly: true,
      });
      try {
        const lifecycle = lifecycleModule.createLedgerServiceLifecycle({
          db,
          tableName: options.tableName,
        });
        return await lifecycle.get({ serviceId });
      } finally {
        await db.close();
      }
    },
    readOwnership: async () => {
      const db = adapterModule.default({
        path: options.controlPath,
        readOnly: true,
      });
      try {
        const ownership = lifecycleModule.createLedgerServiceOwnership({
          db,
          tableName: options.tableName,
        });
        return await ownership.getOwnership({ serviceId });
      } finally {
        await db.close();
      }
    },
  };
}

/**
 * Load the installed ledger implementation used to seed and observe exact-run
 * operator fixtures. The moved SEA still performs every operation under test;
 * this host helper only prepares independently verifiable durable state.
 * @param {{installedPackageRoot: string, controlPath: string, tableName: string, payloadPath: string, applicationStatePath: string, revisionId: string}} options - Installed-package fixture inputs.
 * @returns {Promise<{payloadStoreId: string, createDestinationEffectId: (appId: string, runId: string, effectId: string) => string, createRunId: (appId: string, idempotencyKey: string) => string, createWorkflowRunId: (appId: string, idempotencyKey: string) => string, createCompletedWorkflowEvidence: (runId: string, result: unknown) => Promise<Record<string, any>>, listReadyWork: (appId: string, revisionId: string, observedAt?: number) => Promise<Record<string, any>[]>, createClaimedRun: (appId: string, idempotencyKey: string) => Promise<string>, createApplicationStateRecoveryBatchRun: (appId: string, idempotencyKey: string, effectSpecs: {effectId: string, state: 'PENDING'|'STARTED_RECEIPT'|'STARTED_ABSENT'|'TERMINAL'}[], fixtureOptions?: {actor?: {kind: string, id: string}}) => Promise<{runId: string, attemptId: string, storeId: string, payloadStoreId: string, effects: {effectId: string, initialStatus: string, destinationEffectId: string, requestKey: string, receiptPresent: boolean, recoveryAction?: string, recoveredStatus?: string}[], secrets: string[]}>, materializeApplicationStateReceipt: (appId: string, runId: string, effectId: string) => Promise<Readonly<Record<string, any>>>, readApplicationStateDestination: (appId: string, destinationEffectId: string, logicalKey: string) => Promise<{receipt: Record<string, any> | null, resolution: Record<string, any> | null, business: Record<string, any> | null}>, readApplicationStateReceipt: (appId: string, destinationEffectId: string) => Promise<Record<string, any> | null>, readApplicationStateReceipts: (appId: string, destinationEffectIds: string[]) => Promise<Map<string, Record<string, any> | null>>, writeApplicationStateExternalValue: (appId: string, logicalKey: string, value: Record<string, any>, suffix: string) => Promise<{destinationEffectId: string, value: Record<string, any>, outcome: Record<string, any>}>, readExecutionPayload: (reference: Record<string, any>) => Promise<any>, readManagedEffectDelivery: (runId: string, effectId: string) => Promise<Record<string, any> | null>, readRawLedgerRunRows: (runId: string) => Promise<Record<string, any>[]>, listRunDirectory: (appId: string) => Promise<Record<string, any>[]>, readSuccessorIdentity: (appId: string, successorId: string) => Promise<Record<string, any> | null>, readRun: (runId: string) => Promise<Record<string, any> | null>, createManagedEffectSuccessorAuthorization: (options: Record<string, any>) => Record<string, any>, encodeCanonicalJsonPayload: (value: unknown) => Buffer, createExecutionPayloadReference: (options: {bytes: Buffer, payloadSchema: string, storeId: string}) => Record<string, any>, ApplicationStateAdapterDescriptor: Record<string, any>, ApplicationStateReconciliationVerifierDescriptor: Record<string, any>, AttemptStatus: Record<string, string>, EffectStatus: Record<string, string>, InvocationStatus: Record<string, string>, RunStatus: Record<string, string>}>} - Exact-run fixture API.
 */
async function createInstalledExecutionLedgerFixture(options) {
  const installedModule = async (/** @type {string} */ relativePath) =>
    await import(
      pathToFileURL(path.join(options.installedPackageRoot, relativePath)).href
    );
  const [
    adapterModule,
    ledgerModule,
    payloadModule,
    manualModule,
    dbConfigModule,
    applicationStateTableModule,
    ledgerContractModule,
    applicationStateEffectModule,
    builtinCatalogModule,
    dbBaseModule,
    runDirectoryModule,
    contentIdModule,
    successorContractModule,
    executionPayloadModule,
    recordKeyModule,
    workflowContractModule,
    activityProtocolModule,
  ] = await Promise.all([
    installedModule('src/core/lib/db/adapters/lmdb.js'),
    installedModule('src/core/lib/db/tables/execution-ledger.js'),
    installedModule('src/core/lib/payload-store/local.js'),
    installedModule('src/core/runtime/manual-ledger-run.js'),
    installedModule('src/core/lib/config/db.js'),
    installedModule('src/core/lib/db/tables/application-state.js'),
    installedModule('src/core/lib/ledger/execution-ledger-contract.js'),
    installedModule('src/core/runtime/effects/application-state.js'),
    installedModule('src/core/runtime/effects/builtin-catalog.js'),
    installedModule('src/core/lib/db/base.js'),
    installedModule('src/core/lib/ledger/run-directory.js'),
    installedModule('src/core/runtime/content-id.js'),
    installedModule('src/core/lib/ledger/managed-effect-successor-contract.js'),
    installedModule('src/core/runtime/execution-payload.js'),
    installedModule('src/core/lib/ledger/record-key.js'),
    installedModule('src/core/lib/ledger/workflow-execution-contract.js'),
    installedModule('src/core/runtime/activity-protocol.js'),
  ]);
  const payloadStoreId = `payload-${createHash('sha256')
    .update(path.resolve(options.payloadPath), 'utf8')
    .digest('hex')
    .slice(0, 55)}`;
  const createPayloadStore = () =>
    payloadModule.createLocalExecutionPayloadStore({
      path: options.payloadPath,
      storeId: payloadStoreId,
    });

  const openLedger = (/** @type {boolean} */ readOnly) => {
    const db = adapterModule.default({
      path: options.controlPath,
      readOnly,
    });
    return {
      db,
      ledger: ledgerModule.createExecutionLedger({
        db,
        tableName: options.tableName,
        payloadStore: createPayloadStore(),
        effectEvidenceVerifiers: [
          ...applicationStateEffectModule.APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
        ],
      }),
    };
  };

  const createRunId = (appId, idempotencyKey) =>
    manualModule.createManualLedgerRunId({ appId, idempotencyKey });
  const createWorkflowRunId = (appId, idempotencyKey) =>
    workflowContractModule.createWorkflowRunId({ appId, idempotencyKey });
  const seedClaimedRun = async (
    /** @type {Record<string, any>} */ ledger,
    /** @type {{appId: string, idempotencyKey: string, inputSecret: string, callerSecret: string, fencingToken: string, actor?: {kind: string, id: string}}} */ seed,
  ) => {
    const actor = seed.actor || { kind: 'local', id: 'sea-verifier' };
    const runId = createRunId(seed.appId, seed.idempotencyKey);
    const created = await ledger.createManualRun({
      runId,
      appId: seed.appId,
      revisionId: options.revisionId,
      invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'greet',
      input: { credential: seed.inputSecret },
      callerMetadata: { credential: seed.callerSecret },
      transitionId: 'create',
      actor,
    });
    const claimed = await ledger.claimInvocation({
      runId,
      invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: seed.fencingToken,
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim:1',
      actor,
    });
    return { runId, claimed };
  };
  const readApplicationStateReceipts = async (
    /** @type {string} */ appId,
    /** @type {string[]} */ destinationEffectIds,
  ) => {
    const applicationDb = await dbConfigModule.createApplicationStateDBClient(
      'lmdb',
      { path: options.applicationStatePath, readOnly: true },
    );
    try {
      const catalog =
        await builtinCatalogModule.createBuiltinManagedEffectRecoveryCatalog({
          db: applicationDb,
          appId,
          adapterName: 'lmdb',
        });
      const receipts = new Map();
      for (const destinationEffectId of destinationEffectIds) {
        receipts.set(
          destinationEffectId,
          await catalog.readReceipt(destinationEffectId),
        );
      }
      return receipts;
    } finally {
      await applicationDb.close();
    }
  };
  const writeApplicationStateExternalValue = async (
    /** @type {string} */ appId,
    /** @type {string} */ logicalKey,
    /** @type {Record<string, any>} */ value,
    /** @type {string} */ suffix,
  ) => {
    const identity = {
      runId: `sea-external-run-${suffix}`,
      invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
      attemptId: `sea-external-attempt-${suffix}`,
      effectId: `sea-external-effect-${suffix}`,
    };
    const request = {
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'effect-request',
      attemptId: identity.attemptId,
      sequence: 1,
      effectId: identity.effectId,
      capability: 'application-state',
      operation: 'put-if-absent',
      input: { key: logicalKey, value },
      requestedReplayProperties: ['idempotent', 'transactional'],
    };
    const applicationDb = await dbConfigModule.createApplicationStateDBClient(
      'lmdb',
      { path: options.applicationStatePath },
    );
    try {
      const catalog =
        await builtinCatalogModule.createBuiltinManagedEffectCatalog({
          db: applicationDb,
          appId,
          adapterName: 'lmdb',
        });
      const adapter = catalog.resolve(request);
      const destinationEffectId =
        ledgerContractModule.createManagedEffectDestinationId({
          appId,
          runId: identity.runId,
          invocationId: identity.invocationId,
          effectId: identity.effectId,
        });
      const outcome = await adapter.execute({
        destinationEffectId,
        destination: adapter.destination,
        identity,
        request,
      });
      return {
        destinationEffectId,
        value: JSON.parse(JSON.stringify(value)),
        outcome: JSON.parse(JSON.stringify(outcome)),
      };
    } finally {
      await applicationDb.close();
    }
  };
  const readRawLedgerRunRows = async (/** @type {string} */ runId) => {
    const { db } = openLedger(true);
    try {
      const rows = [];
      let startAfter;
      do {
        const page = await db.queryPage({
          tableName: options.tableName,
          consistentRead: true,
          keyConditions: [
            {
              keyType: dbBaseModule.KEY_TYPE.PRIMARY,
              conditionType: dbBaseModule.CONDITION_TYPE.EQUALS,
              propertyName: 'run_id',
              propertyValue: runId,
            },
            {
              keyType: dbBaseModule.KEY_TYPE.SORT,
              conditionType: dbBaseModule.CONDITION_TYPE.BEGINS_WITH,
              propertyName: 'sort_key',
              propertyValue: recordKeyModule.EXECUTION_LEDGER_SORT_KEY_PREFIX,
            },
          ],
          limit: 100,
          ...(startAfter === undefined ? {} : { startAfter }),
        });
        rows.push(...page.items);
        startAfter = page.nextStartAfter;
      } while (startAfter !== undefined);
      return rows;
    } finally {
      await db.close();
    }
  };
  const listRunDirectory = async (/** @type {string} */ appId) => {
    const { db, ledger } = openLedger(true);
    try {
      const items = [];
      let cursor;
      do {
        const page = await ledger.listRuns({
          appId,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return items;
    } finally {
      await db.close();
    }
  };
  const readSuccessorIdentity = async (
    /** @type {string} */ appId,
    /** @type {string} */ successorId,
  ) => {
    const { db } = openLedger(true);
    try {
      const scope = runDirectoryModule.createExecutionLedgerRunDirectoryScope({
        appId,
      });
      const sortKey = `successor-identity/v1/${contentIdModule.createCanonicalJsonSha256Id(
        {
          domain: 'wharfie:managed-effect-successor-public-id:v1',
          prefix: 'wsu',
          value: successorId,
          valuePath: 'managed effect successor public identity',
        },
      )}`;
      return (
        (await db.get({
          tableName: options.tableName,
          keyName: 'run_id',
          keyValue: scope.directoryId,
          sortKeyName: 'sort_key',
          sortKeyValue: sortKey,
          consistentRead: true,
        })) || null
      );
    } finally {
      await db.close();
    }
  };
  const listReadyWork = async (
    /** @type {string} */ appId,
    /** @type {string} */ revisionId,
    /** @type {number | undefined} */ observedAt = undefined,
  ) => {
    const { db, ledger } = openLedger(true);
    try {
      const items = [];
      let cursor;
      do {
        const page = await ledger.listReadyWork({
          appId,
          revisionId,
          limit: 100,
          ...(observedAt === undefined ? {} : { observedAt }),
          ...(cursor === undefined ? {} : { cursor }),
        });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return items;
    } finally {
      await db.close();
    }
  };
  const createCompletedWorkflowEvidence = async (
    /** @type {string} */ runId,
    /** @type {unknown} */ result,
  ) => {
    const beforeRun = await (async () => {
      const { db, ledger } = openLedger(true);
      try {
        return await ledger.rebuildRun(runId);
      } finally {
        await db.close();
      }
    })();
    assert.ok(beforeRun, `Workflow evidence run is unavailable: ${runId}`);
    const startedEvents = beforeRun.events.filter(
      (/** @type {Record<string, any>} */ event) =>
        event.type === 'workflow-activity-started',
    );
    assert.equal(
      startedEvents.length,
      1,
      'Workflow evidence fixture requires one exact STARTED event.',
    );
    const startedEvent = startedEvents[0];
    const claimEvent = beforeRun.events[startedEvent.sequence - 2];
    const startedAttempt = startedEvent.payload?.attempt;
    const claimCursor = claimEvent?.payload?.workflowCursor;
    assert.equal(claimEvent?.type, 'workflow-activity-claimed');
    assert.ok(startedAttempt && claimCursor);
    const beforeReady = await listReadyWork(
      beforeRun.run.appId,
      beforeRun.run.revisionId,
    );
    const beforeRows = await readRawLedgerRunRows(runId);
    const { db, ledger } = openLedger(true);
    /** @type {Record<string, any> | undefined} */
    let replay;
    try {
      replay = await ledger.markWorkflowActivityStarted({
        runId,
        invocationId: startedAttempt.invocationId,
        cursor: {
          version: claimCursor.version,
          continuationId: claimCursor.continuationId,
          stepId: claimCursor.stepId,
          stepIndex: claimCursor.stepIndex,
        },
        attemptId: startedAttempt.attemptId,
        fencingToken: startedAttempt.fencingToken,
        generation: startedAttempt.generation,
        expectedVersion: startedEvent.payload.run.version - 1,
        transitionId: startedEvent.transition_id,
        actor: startedEvent.actor,
        coordinatorEpoch: startedAttempt.coordinatorEpoch,
        observedAt: startedEvent.observed_at,
      });
    } finally {
      await db.close();
    }
    assert.ok(replay, 'STARTED receipt replay returned no durable receipt.');
    assert.equal(replay.applied, false);
    assert.equal(replay.dispatchAuthorized, false);
    assert.deepEqual(
      await (async () => {
        const { db: readDb, ledger: readLedger } = openLedger(true);
        try {
          return await readLedger.rebuildRun(runId);
        } finally {
          await readDb.close();
        }
      })(),
      beforeRun,
      'STARTED receipt replay changed workflow state.',
    );
    assert.deepEqual(
      await listReadyWork(beforeRun.run.appId, beforeRun.run.revisionId),
      beforeReady,
      'STARTED receipt replay changed workflow ready work.',
    );
    assert.deepEqual(
      await readRawLedgerRunRows(runId),
      beforeRows,
      'STARTED receipt replay changed physical workflow rows.',
    );
    const transcript =
      new activityProtocolModule.ActivityProtocolTranscriptValidator();
    const acceptedStart = transcript.acceptHostFrame(replay.startFrame);
    const terminal = transcript.acceptComponentFrame({
      protocol: activityProtocolModule.ACTIVITY_PROTOCOL_NAME,
      protocolVersion: activityProtocolModule.ACTIVITY_PROTOCOL_VERSION,
      type: 'completed',
      attemptId: acceptedStart.attemptId,
      sequence: 1,
      result,
    });
    return {
      status: terminal.type,
      start: acceptedStart,
      terminal,
      frames: [acceptedStart, terminal],
      transcript: transcript.snapshot(),
    };
  };
  return {
    payloadStoreId,
    createDestinationEffectId: (appId, runId, effectId) =>
      ledgerContractModule.createManagedEffectDestinationId({
        appId,
        runId,
        invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
        effectId,
      }),
    createRunId,
    createWorkflowRunId,
    createCompletedWorkflowEvidence,
    listReadyWork,
    createClaimedRun: async (appId, idempotencyKey) => {
      const { db, ledger } = openLedger(false);
      try {
        const seeded = await seedClaimedRun(ledger, {
          appId,
          idempotencyKey,
          inputSecret: 'sea-input-secret',
          callerSecret: 'sea-caller-secret',
          fencingToken: 'sea-fencing-secret',
        });
        return seeded.runId;
      } finally {
        await db.close();
      }
    },
    createApplicationStateRecoveryBatchRun: async (
      appId,
      idempotencyKey,
      effectSpecs,
      fixtureOptions = {},
    ) => {
      assert.ok(effectSpecs.length > 0);
      const actor = fixtureOptions.actor || {
        kind: 'local',
        id: 'sea-verifier',
      };
      const inputSecret = `sea-effect-input-secret-${idempotencyKey}`;
      const callerSecret = `sea-effect-caller-secret-${idempotencyKey}`;
      const fencingToken = `sea-effect-fencing-secret-${idempotencyKey}`;
      const secrets = [inputSecret, callerSecret, fencingToken];
      const { db, ledger } = openLedger(false);
      const applicationDb = await dbConfigModule.createApplicationStateDBClient(
        'lmdb',
        { path: options.applicationStatePath },
      );
      try {
        const catalog =
          await builtinCatalogModule.createBuiltinManagedEffectCatalog({
            db: applicationDb,
            appId,
            adapterName: 'lmdb',
          });
        const seeded = await seedClaimedRun(ledger, {
          appId,
          idempotencyKey,
          inputSecret,
          callerSecret,
          fencingToken,
          actor,
        });
        const started = await ledger.markAttemptStarted({
          runId: seeded.runId,
          invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
          attemptId: seeded.claimed.attempt.attemptId,
          fencingToken,
          generation: seeded.claimed.attempt.generation,
          expectedVersion: seeded.claimed.run.version,
          transitionId: `start:${seeded.claimed.attempt.attemptId}`,
          actor,
        });
        let currentRun = started.run;
        const effects = [];
        for (const [index, spec] of effectSpecs.entries()) {
          assert.match(spec.effectId, /^[A-Za-z0-9-]+$/);
          assert.ok(
            [
              'PENDING',
              'STARTED_RECEIPT',
              'STARTED_ABSENT',
              'TERMINAL',
            ].includes(spec.state),
          );
          const stateSecret = `sea-application-state-secret-${spec.effectId}`;
          const requestKey = `sea-recovery-key-${spec.effectId}`;
          secrets.push(stateSecret);
          const request = {
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'effect-request',
            attemptId: started.attempt.attemptId,
            sequence: index + 1,
            effectId: spec.effectId,
            capability: 'application-state',
            operation: 'put-if-absent',
            input: {
              key: requestKey,
              value: { credential: stateSecret },
            },
            requestedReplayProperties: ['idempotent', 'transactional'],
          };
          const adapter = catalog.resolve(request);
          const requested = await ledger.recordManagedEffectRequest({
            runId: seeded.runId,
            invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
            attemptId: started.attempt.attemptId,
            fencingToken,
            generation: started.attempt.generation,
            expectedVersion: currentRun.version,
            transitionId: `effect-request:${spec.effectId}`,
            request,
            adapter: adapter.descriptor,
            destination: adapter.destination,
            verifier: adapter.verifier,
            substantiatedReplayProperties:
              adapter.substantiatedReplayProperties,
            actor,
          });
          currentRun = requested.run;
          let effect = requested.effect;
          let receiptPresent = false;
          if (spec.state !== 'PENDING') {
            const effectStarted = await ledger.markManagedEffectStarted({
              runId: seeded.runId,
              invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
              attemptId: started.attempt.attemptId,
              effectId: spec.effectId,
              fencingToken,
              generation: started.attempt.generation,
              expectedVersion: currentRun.version,
              expectedEffectVersion: effect.version,
              transitionId: `effect-start:${spec.effectId}`,
              actor,
            });
            currentRun = effectStarted.run;
            effect = effectStarted.effect;
            if (spec.state !== 'STARTED_ABSENT') {
              const outcome = await adapter.execute({
                destinationEffectId: effect.destinationEffectId,
                destination: adapter.destination,
                identity: {
                  runId: seeded.runId,
                  invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
                  attemptId: started.attempt.attemptId,
                  effectId: spec.effectId,
                },
                request,
              });
              receiptPresent = true;
              if (spec.state === 'TERMINAL') {
                const committed = await ledger.commitManagedEffectOutcome({
                  runId: seeded.runId,
                  invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
                  attemptId: started.attempt.attemptId,
                  effectId: spec.effectId,
                  fencingToken,
                  generation: started.attempt.generation,
                  expectedVersion: currentRun.version,
                  expectedEffectVersion: effect.version,
                  transitionId: `effect-outcome:${spec.effectId}`,
                  outcome,
                  actor,
                });
                currentRun = committed.run;
                effect = committed.effect;
              }
            }
          }
          effects.push({
            effectId: spec.effectId,
            initialStatus: effect.status,
            destinationEffectId: effect.destinationEffectId,
            requestKey,
            receiptPresent,
            ...(spec.state === 'PENDING'
              ? {
                  recoveryAction: 'cancelled-before-start',
                  recoveredStatus: ledgerModule.EffectStatus.CANCELLED,
                }
              : spec.state === 'STARTED_RECEIPT'
                ? {
                    recoveryAction: 'outcome-recovered',
                    recoveredStatus: ledgerModule.EffectStatus.COMPLETED,
                  }
                : spec.state === 'STARTED_ABSENT'
                  ? {
                      recoveryAction: 'outcome-uncertain',
                      recoveredStatus: ledgerModule.EffectStatus.UNCERTAIN,
                    }
                  : {}),
          });
        }
        return {
          runId: seeded.runId,
          attemptId: started.attempt.attemptId,
          storeId: catalog.storeId,
          payloadStoreId,
          effects,
          secrets,
        };
      } finally {
        await applicationDb.close();
        await db.close();
      }
    },
    readApplicationStateReceipt: async (appId, destinationEffectId) =>
      (await readApplicationStateReceipts(appId, [destinationEffectId])).get(
        destinationEffectId,
      ) || null,
    writeApplicationStateExternalValue,
    materializeApplicationStateReceipt: async (appId, runId, effectId) => {
      const { db, ledger } = openLedger(true);
      let delivery;
      try {
        delivery = await ledger.readManagedEffectDelivery(
          runId,
          manualModule.MANUAL_LEDGER_INVOCATION_ID,
          effectId,
        );
      } finally {
        await db.close();
      }
      if (
        !delivery ||
        delivery.effect.status !== ledgerModule.EffectStatus.UNCERTAIN
      ) {
        throw new Error(
          `Late application-state receipt requires one retained UNCERTAIN effect: ${effectId}.`,
        );
      }
      const request = {
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'effect-request',
        attemptId: delivery.effect.requestedBy.attemptId,
        sequence: delivery.effect.requestedBy.protocolSequence,
        effectId: delivery.effect.effectId,
        capability: delivery.request.capability,
        operation: delivery.request.operation,
        input: delivery.request.input,
        requestedReplayProperties: delivery.request.requestedReplayProperties,
      };
      const applicationDb = await dbConfigModule.createApplicationStateDBClient(
        'lmdb',
        { path: options.applicationStatePath },
      );
      try {
        const catalog =
          await builtinCatalogModule.createBuiltinManagedEffectCatalog({
            db: applicationDb,
            appId,
            adapterName: 'lmdb',
          });
        const adapter = catalog.resolve(request);
        assert.deepEqual(adapter.destination, delivery.effect.destination);
        return await adapter.execute({
          destinationEffectId: delivery.effect.destinationEffectId,
          destination: delivery.effect.destination,
          identity: {
            runId,
            invocationId: delivery.effect.invocationId,
            attemptId: delivery.effect.startedBy.attemptId,
            effectId,
          },
          request,
        });
      } finally {
        await applicationDb.close();
      }
    },
    readApplicationStateDestination: async (
      appId,
      destinationEffectId,
      logicalKey,
    ) => {
      const applicationDb = await dbConfigModule.createApplicationStateDBClient(
        'lmdb',
        { path: options.applicationStatePath, readOnly: true },
      );
      try {
        const catalog =
          await builtinCatalogModule.createBuiltinManagedEffectRecoveryCatalog({
            db: applicationDb,
            appId,
            adapterName: 'lmdb',
          });
        const table = applicationStateTableModule.createApplicationStateTable({
          db: applicationDb,
          tableName: dbConfigModule.APPLICATION_STATE_TABLE_NAME,
        });
        const receipt = await catalog.readReceipt(destinationEffectId);
        const businessKey =
          applicationStateTableModule.createApplicationStateBusinessKey(
            appId,
            logicalKey,
          );
        const business = await table.readBusinessByPhysicalKey(
          businessKey.resourceId,
          businessKey.sortKey,
        );
        const resolution =
          await table.readNotAppliedResolution(destinationEffectId);
        return { receipt, resolution, business };
      } finally {
        await applicationDb.close();
      }
    },
    readApplicationStateReceipts,
    readExecutionPayload: async (reference) =>
      await createPayloadStore().readJson(reference),
    readManagedEffectDelivery: async (runId, effectId) => {
      const { db, ledger } = openLedger(true);
      try {
        return await ledger.readManagedEffectDelivery(
          runId,
          manualModule.MANUAL_LEDGER_INVOCATION_ID,
          effectId,
        );
      } finally {
        await db.close();
      }
    },
    readRawLedgerRunRows,
    listRunDirectory,
    readSuccessorIdentity,
    readRun: async (runId) => {
      const { db, ledger } = openLedger(true);
      try {
        return await ledger.rebuildRun(runId);
      } finally {
        await db.close();
      }
    },
    createManagedEffectSuccessorAuthorization:
      successorContractModule.createManagedEffectSuccessorAuthorization,
    encodeCanonicalJsonPayload:
      executionPayloadModule.encodeCanonicalJsonPayload,
    createExecutionPayloadReference:
      executionPayloadModule.createExecutionPayloadReference,
    ApplicationStateAdapterDescriptor:
      applicationStateEffectModule.APPLICATION_STATE_ADAPTER_DESCRIPTOR,
    ApplicationStateReconciliationVerifierDescriptor:
      applicationStateEffectModule.APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
    AttemptStatus: ledgerModule.AttemptStatus,
    EffectStatus: ledgerModule.EffectStatus,
    InvocationStatus: ledgerModule.InvocationStatus,
    RunStatus: ledgerModule.RunStatus,
  };
}

/**
 * Assert the effect/history surface has one exact public shape and contains no
 * retained destination or logical-request material.
 * @param {string} serialized - Exact CLI JSON output.
 * @param {{runId: string, storeId: string, effects: {effectId: string, destinationEffectId: string, requestKey: string}[], secrets: string[]}} fixture - Seeded retained effect set.
 * @param {Record<string, any>} view - Parsed operator view.
 * @param {{adapter: Record<string, any>, statuses: Map<string, string>}} expected - Public effect rows.
 */
function assertManagedEffectOperatorRedaction(
  serialized,
  fixture,
  view,
  expected,
) {
  for (const attempt of view.attempts) {
    assert.deepEqual(Object.keys(attempt).sort(), [
      'attemptId',
      'claimedAt',
      'generation',
      'invocationId',
      'lastSequence',
      'startedAt',
      'status',
      'updatedAt',
      'version',
    ]);
  }
  assert.equal(view.effects.length, fixture.effects.length);
  const rowsByEffectId = new Map(
    view.effects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  for (const effect of fixture.effects) {
    const row = rowsByEffectId.get(effect.effectId);
    assert.ok(row, `operator view omitted managed effect ${effect.effectId}`);
    assert.deepEqual(Object.keys(row).sort(), [
      'adapter',
      'createdAt',
      'effectId',
      'invocationId',
      'lastSequence',
      'status',
      'updatedAt',
      'version',
    ]);
    assert.equal(row.status, expected.statuses.get(effect.effectId));
    assert.deepEqual(row.adapter, expected.adapter);
  }
  for (const event of view.history) {
    assert.deepEqual(Object.keys(event).sort(), [
      'actor',
      'observedAt',
      'sequence',
      'type',
    ]);
  }
  for (const secret of [
    ...fixture.secrets,
    ...fixture.effects.flatMap((effect) => [
      effect.requestKey,
      effect.destinationEffectId,
    ]),
    fixture.storeId,
    'destinationEffectId',
    'destination',
    'evidence',
    'coordinatorEpoch',
    'invocationGeneration',
    '"fence"',
    'fencingToken',
  ]) {
    assert.equal(
      serialized.includes(secret),
      false,
      `managed-effect operator view disclosed ${secret}`,
    );
  }
}

/**
 * @param {{effects: {initialStatus: string}[]}} fixture - Seeded effect set.
 * @returns {string[]} - Exact event vocabulary before stopped recovery.
 */
function seededManagedEffectEventTypes(fixture) {
  const eventTypes = [
    'manual-run-created',
    'attempt-claimed',
    'attempt-started',
  ];
  for (const effect of fixture.effects) {
    eventTypes.push('effect-requested');
    if (effect.initialStatus !== 'PENDING') eventTypes.push('effect-started');
    if (effect.initialStatus === 'COMPLETED') {
      eventTypes.push('effect-completed');
    }
  }
  return eventTypes;
}

/**
 * Assert source and packaged pre-recovery inspection expose the same exact
 * schema-v4 mixed effect set without retained requests or destinations.
 * @param {string} serialized - Exact CLI JSON output.
 * @param {{runId: string, storeId: string, effects: {effectId: string, initialStatus: string, destinationEffectId: string, requestKey: string, receiptPresent: boolean, recoveryAction?: string, recoveredStatus?: string}[], secrets: string[]}} fixture - Seeded retained effect set.
 * @param {Record<string, any>} adapter - Expected public adapter descriptor.
 * @returns {Record<string, any>} - Parsed inspection view.
 */
function assertManagedEffectBatchInspectionView(serialized, fixture, adapter) {
  const view = JSON.parse(serialized);
  assert.deepEqual(Object.keys(view).sort(), [
    'attempts',
    'effects',
    'history',
    'integrity',
    'invocations',
    'kind',
    'run',
    'schemaVersion',
    'signalDeliveries',
    'signalWaits',
    'timers',
  ]);
  assert.equal(view.schemaVersion, 7);
  assert.equal(view.kind, 'wharfie.execution-ledger.run');
  assert.deepEqual(view.integrity, { verified: true });
  assert.equal(view.run.runId, fixture.runId);
  assert.equal(view.run.status, 'RUNNING');
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].status, 'RUNNING');
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].status, 'STARTED');
  assertManagedEffectOperatorRedaction(serialized, fixture, view, {
    adapter,
    statuses: new Map(
      fixture.effects.map((effect) => [effect.effectId, effect.initialStatus]),
    ),
  });
  const expectedEventTypes = seededManagedEffectEventTypes(fixture);
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.type),
    expectedEventTypes,
  );
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.actor),
    Array.from({ length: expectedEventTypes.length }, () => ({
      kind: 'local',
      id: 'sea-verifier',
    })),
  );
  return view;
}

/**
 * Assert one CLI recovery response remains both semantically complete and
 * operator-redacted.
 * @param {string} serialized - Exact CLI JSON output.
 * @param {{runId: string, storeId: string, effects: {effectId: string, initialStatus: string, destinationEffectId: string, requestKey: string, receiptPresent: boolean, recoveryAction?: string, recoveredStatus?: string}[], secrets: string[]}} fixture - Seeded retained effect set.
 * @param {{adapter: Record<string, any>, actor: Record<string, any>, recovery?: Record<string, any>}} expected - Recovery truth.
 * @returns {Record<string, any>} - Parsed recovery view.
 */
function assertManagedEffectBatchRecoveryView(serialized, fixture, expected) {
  const view = JSON.parse(serialized);
  assert.deepEqual(Object.keys(view).sort(), [
    'attempts',
    'effects',
    'history',
    'integrity',
    'invocations',
    'kind',
    'recovery',
    'run',
    'schemaVersion',
    'signalDeliveries',
    'signalWaits',
    'timers',
  ]);
  assert.equal(view.schemaVersion, 7);
  assert.equal(view.kind, 'wharfie.execution-ledger.recovery');
  assert.deepEqual(view.integrity, { verified: true });
  assert.equal(view.run.runId, fixture.runId);
  assert.equal(view.run.status, 'BLOCKED');
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].status, 'UNCERTAIN');
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].status, 'ABANDONED');
  const managedEffects = fixture.effects
    .filter((effect) => effect.recoveryAction)
    .map((effect) => ({
      effectId: effect.effectId,
      action: effect.recoveryAction,
      status: effect.recoveredStatus,
    }))
    .sort((left, right) => left.effectId.localeCompare(right.effectId));
  assert.deepEqual(
    view.recovery,
    expected.recovery || {
      action: 'settled-managed-effect-set',
      changed: true,
      managedEffects,
    },
  );
  assertManagedEffectOperatorRedaction(serialized, fixture, view, {
    adapter: expected.adapter,
    statuses: new Map(
      fixture.effects.map((effect) => [
        effect.effectId,
        effect.recoveredStatus || effect.initialStatus,
      ]),
    ),
  });
  const eventTypes = [
    ...seededManagedEffectEventTypes(fixture),
    'attempt-became-uncertain',
  ];
  const eventActors = [
    ...Array.from({ length: view.history.length - 1 }, () => ({
      kind: 'local',
      id: 'sea-verifier',
    })),
    expected.actor,
  ];
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.type),
    eventTypes,
  );
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.actor),
    eventActors,
  );
  return view;
}

/**
 * Assert one atomic stopped-attempt settlement without weakening terminal
 * sibling authority.
 * @param {Record<string, any>} before - Exact seeded run.
 * @param {Record<string, any>} after - Exact settled run.
 * @param {{payloadStoreId: string, effects: {effectId: string, initialStatus: string, recoveryAction?: string, recoveredStatus?: string}[]}} fixture - Seeded effect batch.
 * @param {Record<string, any>} actor - Expected settlement actor.
 * @param {{key: string, size: number, sha256: string} | undefined} recoveredPayloadFile - Exact recovered outcome payload bytes when the fixture includes receipt recovery.
 * @returns {Record<string, any>} - Compound settlement event.
 */
function assertSettledManagedEffectBatchRun(
  before,
  after,
  fixture,
  actor,
  recoveredPayloadFile,
) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.equal(before.invocations.length, 1);
  assert.equal(after.invocations.length, before.invocations.length);
  assert.equal(before.attempts.length, 1);
  assert.equal(after.attempts.length, before.attempts.length);
  assert.equal(after.effects.length, before.effects.length);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.equal(after.events.length, before.events.length + 1);
  const closure = after.events.at(-1);
  assert.equal(closure.type, 'attempt-became-uncertain');
  assert.deepEqual(closure.actor, actor);
  assert.equal(closure.sequence, before.head.sequence + 1);
  assert.equal(closure.observed_at, after.run.updatedAt);

  const expectedRun = {
    ...before.run,
    status: 'BLOCKED',
    version: before.run.version + 1,
    lastSequence: closure.sequence,
    updatedAt: closure.observed_at,
  };
  const expectedInvocation = {
    ...before.invocations[0],
    status: 'UNCERTAIN',
    uncertainty: SEA_STOPPED_ATTEMPT_RECOVERY_REASON,
    version: before.invocations[0].version + 1,
    lastSequence: closure.sequence,
    updatedAt: closure.observed_at,
  };
  const expectedAttempt = {
    ...before.attempts[0],
    status: 'ABANDONED',
    abandonment: SEA_STOPPED_ATTEMPT_RECOVERY_REASON,
    version: before.attempts[0].version + 1,
    lastSequence: closure.sequence,
    updatedAt: closure.observed_at,
  };
  assert.deepEqual(after.head, {
    ...before.head,
    version: before.head.version + 1,
    sequence: closure.sequence,
  });
  assert.deepEqual(after.run, expectedRun);
  assert.deepEqual(after.invocations[0], expectedInvocation);
  assert.deepEqual(after.attempts[0], expectedAttempt);
  assert.deepEqual(closure.payload.run, expectedRun);
  assert.deepEqual(closure.payload.invocation, expectedInvocation);
  assert.deepEqual(closure.payload.attempt, expectedAttempt);

  const beforeById = new Map(
    before.effects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  const afterById = new Map(
    after.effects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  assert.deepEqual(
    after.effects.map(
      (/** @type {Record<string, any>} */ effect) => effect.effectId,
    ),
    before.effects.map(
      (/** @type {Record<string, any>} */ effect) => effect.effectId,
    ),
  );
  const closureEffects = closure.payload.effects || [];
  assert.deepEqual(
    closureEffects.map(
      (/** @type {Record<string, any>} */ effect) => effect.effectId,
    ),
    fixture.effects
      .filter((effect) => effect.recoveryAction)
      .map((effect) => effect.effectId),
  );
  const closureById = new Map(
    closureEffects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  for (const expected of fixture.effects) {
    const prior = beforeById.get(expected.effectId);
    const retained = afterById.get(expected.effectId);
    assert.ok(prior, `seeded batch omitted ${expected.effectId}`);
    assert.ok(retained, `settled batch omitted ${expected.effectId}`);
    if (!expected.recoveryAction) {
      assert.deepEqual(
        retained,
        prior,
        `settlement rewrote terminal sibling ${expected.effectId}`,
      );
      assert.equal(closureById.has(expected.effectId), false);
      continue;
    }
    /** @type {Record<string, any>} */
    let intendedDelta;
    if (expected.recoveryAction === 'cancelled-before-start') {
      intendedDelta = {
        status: 'CANCELLED',
        cancellation: SEA_RECOVERY_CANCELLATION_REASON,
      };
    } else if (expected.recoveryAction === 'outcome-uncertain') {
      intendedDelta = {
        status: 'UNCERTAIN',
        uncertainty: SEA_RECOVERY_UNCERTAINTY_REASON,
      };
    } else {
      assert.equal(expected.recoveryAction, 'outcome-recovered');
      assert.ok(
        recoveredPayloadFile,
        'receipt recovery requires the exact recovered payload file',
      );
      const outcomeRef = retained.outcomeRef;
      assert.ok(outcomeRef, 'recovered effect omitted its outcome reference');
      assert.deepEqual(Object.keys(outcomeRef).sort(), [
        'digest',
        'kind',
        'mediaType',
        'payloadId',
        'payloadSchema',
        'schemaVersion',
        'size',
        'storage',
      ]);
      assert.equal(outcomeRef.schemaVersion, 1);
      assert.equal(outcomeRef.kind, 'executionPayloadReference');
      assert.equal(outcomeRef.mediaType, 'application/json');
      assert.equal(
        outcomeRef.payloadSchema,
        'wharfie.execution.managed-effect-outcome.v2',
      );
      assert.deepEqual(outcomeRef.digest, {
        algorithm: 'sha256',
        value: Buffer.from(recoveredPayloadFile.sha256, 'hex').toString(
          'base64url',
        ),
      });
      assert.equal(outcomeRef.size, recoveredPayloadFile.size);
      assert.deepEqual(outcomeRef.storage, {
        kind: 'wharfie.local-content-addressed.v1',
        storeId: fixture.payloadStoreId,
        key: recoveredPayloadFile.key,
      });
      intendedDelta = {
        status: 'COMPLETED',
        terminal: { ok: true },
        outcomeRef,
      };
    }
    const intended = {
      ...prior,
      ...intendedDelta,
      version: prior.version + 1,
      lastSequence: closure.sequence,
      updatedAt: closure.observed_at,
    };
    assert.equal(intended.status, expected.recoveredStatus);
    assert.deepEqual(retained, intended);
    assert.deepEqual(closureById.get(expected.effectId), intended);
  }
  return closure;
}

/**
 * Read exact receipt and business authority for every batch member.
 * @param {{readApplicationStateDestination: (appId: string, destinationEffectId: string, logicalKey: string) => Promise<{receipt: Record<string, any> | null, resolution: Record<string, any> | null, business: Record<string, any> | null}>}} ledgerFixture - Installed fixture reader.
 * @param {string} appId - Packaged application identity.
 * @param {{effects: {effectId: string, destinationEffectId: string, requestKey: string}[]}} batch - Seeded batch.
 * @returns {Promise<Record<string, any>>} - Stable destination snapshots by effect.
 */
async function readManagedEffectBatchDestinations(ledgerFixture, appId, batch) {
  return Object.fromEntries(
    await Promise.all(
      batch.effects.map(async (effect) => [
        effect.effectId,
        await ledgerFixture.readApplicationStateDestination(
          appId,
          effect.destinationEffectId,
          effect.requestKey,
        ),
      ]),
    ),
  );
}

/**
 * Read verified effect delivery authority for every batch member.
 * @param {{readManagedEffectDelivery: (runId: string, effectId: string) => Promise<Record<string, any> | null>}} ledgerFixture - Installed fixture reader.
 * @param {{runId: string, effects: {effectId: string}[]}} batch - Seeded batch.
 * @returns {Promise<Record<string, Record<string, any> | null>>} - Delivery snapshots by effect.
 */
async function readManagedEffectBatchDeliveries(ledgerFixture, batch) {
  return Object.fromEntries(
    await Promise.all(
      batch.effects.map(async (effect) => [
        effect.effectId,
        await ledgerFixture.readManagedEffectDelivery(
          batch.runId,
          effect.effectId,
        ),
      ]),
    ),
  );
}

/**
 * Prove one sibling's effect/request/attempt authority is unchanged while the
 * enclosing run and invocation legitimately advance for another effect.
 * @param {Record<string, any>} before - Delivery before aggregate advance.
 * @param {Record<string, any>} after - Delivery after aggregate advance.
 * @param {string} label - Assertion context.
 * @returns {void}
 */
function assertManagedEffectSiblingDeliveryStable(before, after, label) {
  assert.ok(before, `${label} has no prior delivery`);
  assert.ok(after, `${label} has no current delivery`);
  const beforeStable = { ...before };
  const afterStable = { ...after };
  delete beforeStable.run;
  delete beforeStable.invocation;
  delete afterStable.run;
  delete afterStable.invocation;
  assert.deepEqual(afterStable, beforeStable, label);
}

/**
 * Assert recovered delivery authority while preserving request and preterminal
 * sibling evidence exactly.
 * @param {{readExecutionPayload: (reference: Record<string, any>) => Promise<any>}} ledgerFixture - Installed fixture reader.
 * @param {{effects: {effectId: string}[]}} batch - Seeded batch.
 * @param {Record<string, Record<string, any> | null>} before - Seeded deliveries.
 * @param {Record<string, Record<string, any> | null>} after - Settled deliveries.
 * @param {string} recoveredOutcomeKey - Exact newly published payload key.
 * @returns {Promise<void>} - Resolves after delivery evidence verifies.
 */
async function assertSettledManagedEffectBatchDeliveries(
  ledgerFixture,
  batch,
  before,
  after,
  recoveredOutcomeKey,
) {
  for (const effect of batch.effects) {
    assert.ok(before[effect.effectId]);
    assert.ok(after[effect.effectId]);
    assert.deepEqual(
      after[effect.effectId].request,
      before[effect.effectId].request,
      `settlement rewrote request ${effect.effectId}`,
    );
  }

  for (const effectId of ['01-pending', '03-absent']) {
    const delivery = after[effectId];
    assert.equal(
      delivery.effect.status,
      effectId === '01-pending' ? 'CANCELLED' : 'UNCERTAIN',
    );
    assert.equal(delivery.outcome, undefined);
    assert.equal(delivery.resultFrame, undefined);
    assert.equal(
      Object.prototype.hasOwnProperty.call(delivery.effect, 'outcomeRef'),
      false,
    );
  }

  const recovered = after['02-receipt'];
  assert.equal(recovered.effect.status, 'COMPLETED');
  assert.equal(recovered.effect.outcomeRef.storage.key, recoveredOutcomeKey);
  assert.equal(recovered.outcome.ok, true);
  assert.equal(
    recovered.outcome.destinationEffectId,
    recovered.effect.destinationEffectId,
  );
  assert.equal(
    recovered.outcome.evidence.destinationEffectId,
    recovered.effect.destinationEffectId,
  );
  assert.deepEqual(recovered.resultFrame.result, { inserted: true });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await ledgerFixture.readExecutionPayload(recovered.effect.outcomeRef),
      ),
    ),
    JSON.parse(JSON.stringify(recovered.outcome)),
  );

  assert.deepEqual(
    terminalDeliveryAuthority(after['04-terminal']),
    terminalDeliveryAuthority(before['04-terminal']),
    'settlement rewrote existing terminal delivery authority',
  );
}

/**
 * Assert the singular V8 event advances only one uncertain effect while the
 * enclosing stopped attempt and every sibling remain exact retained history.
 * @param {Record<string, any>} before - Verified run immediately before reconciliation.
 * @param {Record<string, any>} after - Verified run immediately after reconciliation.
 * @param {{effects: {effectId: string}[]}} batch - Shared stopped-effect batch.
 * @param {{effectId: string, reconciliationId: string, status: 'COMPLETED'|'NOT_APPLIED', actor: Record<string, any>, reason: string, verifier: Record<string, any>}} expected - Exact reconciliation authority.
 * @returns {{event: Record<string, any>, effect: Record<string, any>, reconciliation: Record<string, any>}} - Verified appended authority.
 */
function assertUncertainManagedEffectReconciliationRun(
  before,
  after,
  batch,
  expected,
) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.equal(before.run.status, 'BLOCKED');
  assert.equal(after.run.status, 'BLOCKED');
  assert.equal(before.invocations.length, 1);
  assert.equal(after.invocations.length, 1);
  assert.equal(before.attempts.length, 1);
  assert.equal(after.attempts.length, 1);
  assert.equal(before.effects.length, batch.effects.length);
  assert.equal(after.effects.length, batch.effects.length);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.equal(after.events.length, before.events.length + 1);

  const event = after.events.at(-1);
  assert.equal(event.type, 'uncertain-effect-reconciled');
  assert.equal(
    event.transition_id,
    `reconcile-effect:${expected.reconciliationId}`,
  );
  assert.equal(event.sequence, before.head.sequence + 1);
  assert.deepEqual(event.actor, expected.actor);
  assert.deepEqual(after.head, {
    ...before.head,
    version: before.head.version + 1,
    sequence: event.sequence,
  });

  const expectedRun = {
    ...before.run,
    version: before.run.version + 1,
    lastSequence: event.sequence,
    updatedAt: event.observed_at,
  };
  const expectedInvocation = {
    ...before.invocations[0],
    version: before.invocations[0].version + 1,
    lastSequence: event.sequence,
    updatedAt: event.observed_at,
  };
  assert.deepEqual(after.run, expectedRun);
  assert.deepEqual(after.invocations[0], expectedInvocation);
  assert.deepEqual(
    after.attempts[0],
    before.attempts[0],
    `${expected.effectId} reconciliation rewrote its abandoned physical attempt`,
  );

  const beforeById = new Map(
    before.effects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  const afterById = new Map(
    after.effects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  assert.deepEqual(
    [...afterById.keys()],
    [...beforeById.keys()],
    `${expected.effectId} reconciliation reordered effect projections`,
  );
  for (const effect of batch.effects) {
    if (effect.effectId === expected.effectId) continue;
    assert.deepEqual(
      afterById.get(effect.effectId),
      beforeById.get(effect.effectId),
      `${expected.effectId} reconciliation rewrote sibling ${effect.effectId}`,
    );
  }

  const priorEffect = beforeById.get(expected.effectId);
  const effect = afterById.get(expected.effectId);
  assert.ok(priorEffect, `missing pre-reconciliation ${expected.effectId}`);
  assert.ok(effect, `missing reconciled ${expected.effectId}`);
  assert.equal(priorEffect.status, 'UNCERTAIN');
  const uncertaintyEvent = before.events.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.sequence === priorEffect.lastSequence,
  );
  assert.ok(
    uncertaintyEvent &&
      ['effect-became-uncertain', 'attempt-became-uncertain'].includes(
        uncertaintyEvent.type,
      ),
    `${expected.effectId} has no retained uncertainty event`,
  );

  const reconciliation = effect.reconciliation;
  assert.ok(reconciliation, `${expected.effectId} omitted reconciliation`);
  assert.deepEqual(Object.keys(reconciliation).sort(), [
    'attemptId',
    'coordinatorEpoch',
    'effectId',
    'evidenceRef',
    'fencingToken',
    'generation',
    'invocationId',
    'reason',
    'reconciliationId',
    'resolutionStatus',
    'uncertaintyEventId',
    'uncertaintySequence',
    'verifier',
  ]);
  assert.deepEqual(reconciliation, {
    reconciliationId: expected.reconciliationId,
    invocationId: priorEffect.invocationId,
    attemptId: before.attempts[0].attemptId,
    effectId: expected.effectId,
    generation: before.attempts[0].generation,
    coordinatorEpoch: before.attempts[0].coordinatorEpoch,
    fencingToken: before.attempts[0].fencingToken,
    uncertaintyEventId: uncertaintyEvent.event_id,
    uncertaintySequence: uncertaintyEvent.sequence,
    verifier: expected.verifier,
    evidenceRef: reconciliation.evidenceRef,
    resolutionStatus: expected.status,
    reason: {
      kind: 'operator-managed-effect-reconciliation',
      reconciliationId: expected.reconciliationId,
      message: expected.reason,
    },
  });
  assert.deepEqual(Object.keys(reconciliation.evidenceRef).sort(), [
    'digest',
    'kind',
    'mediaType',
    'payloadId',
    'payloadSchema',
    'schemaVersion',
    'size',
    'storage',
  ]);
  assert.equal(reconciliation.evidenceRef.schemaVersion, 1);
  assert.equal(reconciliation.evidenceRef.kind, 'executionPayloadReference');
  assert.equal(reconciliation.evidenceRef.mediaType, 'application/json');
  assert.equal(
    reconciliation.evidenceRef.payloadSchema,
    expected.status === 'COMPLETED'
      ? 'wharfie.execution.managed-effect-outcome.v2'
      : 'wharfie.execution.managed-effect-reconciliation-evidence.v1',
  );

  const intendedEffect = {
    ...priorEffect,
    status: expected.status,
    reconciliation,
    ...(expected.status === 'COMPLETED'
      ? {
          terminal: { ok: true },
          outcomeRef: reconciliation.evidenceRef,
        }
      : {}),
    version: priorEffect.version + 1,
    lastSequence: event.sequence,
    updatedAt: event.observed_at,
  };
  delete intendedEffect.uncertainty;
  assert.deepEqual(effect, intendedEffect);
  assert.deepEqual(event.fence, {
    coordinatorEpoch: before.attempts[0].coordinatorEpoch,
    invocationGeneration: before.attempts[0].generation,
  });
  assert.deepEqual(event.payload, {
    run: expectedRun,
    invocation: expectedInvocation,
    effect: intendedEffect,
    reconciliation,
  });
  return { event, effect, reconciliation };
}

/**
 * Assert the public response contains the exact safe effect disposition and
 * mirrors the verified raw event stream without exposing destination truth.
 * @param {string} serialized - Exact one-line packaged JSON response.
 * @param {{runId: string, storeId: string, effects: {effectId: string, destinationEffectId: string, requestKey: string}[], secrets: string[]}} batch - Shared retained batch.
 * @param {Record<string, any>} raw - Verified rebuilt run behind the response.
 * @param {{effectId: string, reconciliationId: string, status: string, changed: boolean, privateReason: string, adapter: Record<string, any>, extraSecrets?: string[]}} expected - Public and private authority.
 * @returns {Record<string, any>} - Parsed redacted view.
 */
function assertManagedEffectReconciliationView(
  serialized,
  batch,
  raw,
  expected,
) {
  const view = JSON.parse(serialized);
  assert.deepEqual(Object.keys(view).sort(), [
    'attempts',
    'effectReconciliation',
    'effects',
    'history',
    'integrity',
    'invocations',
    'kind',
    'run',
    'schemaVersion',
    'signalDeliveries',
    'signalWaits',
    'timers',
  ]);
  assert.equal(view.schemaVersion, 7);
  assert.equal(view.kind, 'wharfie.execution-ledger.effect-reconciliation');
  assert.deepEqual(view.integrity, { verified: true });
  assert.equal(view.run.runId, batch.runId);
  assert.equal(view.run.status, 'BLOCKED');
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].status, 'UNCERTAIN');
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].status, 'ABANDONED');
  assert.deepEqual(view.effectReconciliation, {
    reconciliationId: expected.reconciliationId,
    effectId: expected.effectId,
    status: expected.status,
    changed: expected.changed,
  });
  assertManagedEffectOperatorRedaction(serialized, batch, view, {
    adapter: expected.adapter,
    statuses: new Map(
      raw.effects.map((effect) => [effect.effectId, effect.status]),
    ),
  });
  assert.deepEqual(
    view.history,
    raw.events.map((/** @type {Record<string, any>} */ event) => ({
      sequence: event.sequence,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
    })),
  );
  for (const secret of [
    expected.privateReason,
    'resolutionDigest',
    'businessObservation',
    'contractDigest',
    'receiptDigest',
    'outcomeRef',
    'evidenceRef',
    'coordinatorEpoch',
    'invocationGeneration',
    '"fence"',
    ...(expected.extraSecrets || []),
  ]) {
    assert.equal(
      serialized.includes(secret),
      false,
      `${expected.effectId} reconciliation disclosed ${secret}`,
    );
  }
  return view;
}

/**
 * Bind one reconciliation reference to its exact immutable payload file and
 * destination record without relying on the redacted operator response.
 * @param {{readExecutionPayload: (reference: Record<string, any>) => Promise<any>, payloadStoreId: string}} fixture - Installed fixture payload reader.
 * @param {Record<string, any>} effect - Reconciled effect projection.
 * @param {{receipt: Record<string, any> | null, resolution: Record<string, any> | null, business: Record<string, any> | null}} destination - Exact physical destination snapshot.
 * @param {{files: {key: string, size: number, sha256: string}[]}} payloadStorage - Physical immutable payload snapshot.
 * @returns {Promise<Record<string, any>>} - Verified referenced payload.
 */
async function assertManagedEffectReconciliationPayload(
  fixture,
  effect,
  destination,
  payloadStorage,
) {
  const reference = effect.reconciliation.evidenceRef;
  const file = payloadStorage.files.find(
    (candidate) => candidate.key === reference.storage.key,
  );
  assert.ok(file, `${effect.effectId} reconciliation payload is not physical`);
  assert.deepEqual(reference.storage, {
    kind: 'wharfie.local-content-addressed.v1',
    storeId: fixture.payloadStoreId,
    key: file.key,
  });
  assert.equal(reference.size, file.size);
  assert.deepEqual(reference.digest, {
    algorithm: 'sha256',
    value: Buffer.from(file.sha256, 'hex').toString('base64url'),
  });
  const payload = JSON.parse(
    JSON.stringify(await fixture.readExecutionPayload(reference)),
  );
  const destinationStoreId = effect.destination.configuration.storeId;
  if (effect.status === 'COMPLETED') {
    assert.ok(destination.receipt);
    assert.ok(destination.business);
    assert.equal(destination.resolution, null);
    assert.equal(destination.receipt.store_id, destinationStoreId);
    assert.equal(destination.business.store_id, destinationStoreId);
    assert.equal(
      destination.receipt.business_resource_id,
      destination.business.resource_id,
    );
    assert.equal(
      destination.receipt.business_sort_key,
      destination.business.sort_key,
    );
    assert.equal(
      destination.receipt.business_record_digest,
      destination.business.record_digest,
    );
    if (destination.receipt.inserted) {
      assert.equal(
        destination.business.created_by_destination_effect_id,
        effect.destinationEffectId,
      );
      assert.equal(
        destination.business.contract_digest,
        destination.receipt.contract_digest,
      );
    } else {
      assert.notEqual(
        destination.business.created_by_destination_effect_id,
        effect.destinationEffectId,
      );
      assert.notEqual(
        destination.business.contract_digest,
        destination.receipt.contract_digest,
      );
    }
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.result, {
      inserted: destination.receipt.inserted,
    });
    assert.deepEqual(payload.evidence, {
      kind: 'application-state-put-if-absent-receipt',
      version: 2,
      destinationEffectId: effect.destinationEffectId,
      contractDigest: destination.receipt.contract_digest,
      receiptDigest: destination.receipt.receipt_digest,
      businessRecordDigest: destination.receipt.business_record_digest,
      disposition: destination.receipt.outcome_code,
    });
  } else {
    assert.equal(effect.status, 'NOT_APPLIED');
    assert.equal(destination.receipt, null);
    assert.equal(destination.business, null);
    assert.ok(destination.resolution);
    assert.equal(destination.resolution.store_id, destinationStoreId);
    assert.equal(
      destination.resolution.destination_effect_id,
      effect.destinationEffectId,
    );
    assert.deepEqual(destination.resolution.business_observation, {
      kind: 'absent',
    });
    assert.deepEqual(payload, {
      kind: 'application-state-put-if-absent-not-applied',
      version: 2,
      destinationEffectId: effect.destinationEffectId,
      contractDigest: destination.resolution.contract_digest,
      resolutionDigest: destination.resolution.resolution_digest,
      businessObservation: destination.resolution.business_observation,
      disposition: 'not-applied',
    });
  }
  return payload;
}

/**
 * @param {{read: () => Promise<Record<string, any> | null>}} observer - Durable lifecycle observer.
 * @param {(snapshot: Record<string, any> | null) => boolean} predicate - Required durable state.
 * @param {string} label - State being awaited.
 * @returns {Promise<Record<string, any>>} - Matching lifecycle snapshot.
 */
async function waitForDurableLifecycle(observer, predicate, label) {
  const deadline = Date.now() + RESIDENT_SERVICE_TIMEOUT_MS;
  /** @type {unknown} */
  let lastError;
  /** @type {Record<string, any> | null} */
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    try {
      const snapshot = await observer.read();
      lastSnapshot = snapshot;
      if (predicate(snapshot)) return snapshot;
    } catch (error) {
      lastError = error;
    }
    await delay(RESIDENT_SERVICE_POLL_INTERVAL_MS);
  }
  const errorDetail = lastError instanceof Error ? ` ${lastError.message}` : '';
  const stateDetail = lastSnapshot
    ? ` Last lifecycle snapshot: ${JSON.stringify(lastSnapshot)}.`
    : '';
  throw new Error(
    `Durable ledger-service lifecycle did not reach ${label}.${stateDetail}${errorDetail}`,
  );
}

/**
 * Wait for one durable run transition while failing immediately if the
 * output-blocked relocated SEA exits. Diagnostics summarize the large run
 * instead of copying its response-padding history into an error.
 * @param {{read: () => Promise<Record<string, any> | null>}} observer - Exact-run reader.
 * @param {(snapshot: Record<string, any> | null) => boolean} predicate - Required durable state.
 * @param {{getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Relocated SEA child.
 * @param {string} label - State being awaited.
 * @returns {Promise<Record<string, any>>} - Matching durable run.
 */
async function waitForDurableRun(observer, predicate, service, label) {
  const deadline = Date.now() + CRASH_RECOVERY_TIMEOUT_MS;
  /** @type {unknown} */
  let lastError;
  /** @type {Record<string, any> | null} */
  let lastSummary = null;
  while (Date.now() < deadline) {
    if (service.getExit()) {
      throw residentServiceError(
        service,
        `Relocated SEA exited before durable run reached ${label}. Exit: ${JSON.stringify(service.getExit())}.`,
      );
    }
    try {
      const snapshot = await observer.read();
      lastSummary = snapshot
        ? {
            runStatus: snapshot.run?.status,
            invocationStatus: snapshot.invocations?.[0]?.status,
            attemptStatus: snapshot.attempts?.[0]?.status,
            effectCount: snapshot.effects?.length,
            eventCount: snapshot.events?.length,
            lastEventType: snapshot.events?.at(-1)?.type,
          }
        : null;
      if (predicate(snapshot)) return snapshot;
    } catch (error) {
      lastError = error;
    }
    await delay(CRASH_RECOVERY_POLL_INTERVAL_MS);
  }
  const errorDetail = lastError instanceof Error ? ` ${lastError.message}` : '';
  const stateDetail = lastSummary
    ? ` Last run summary: ${JSON.stringify(lastSummary)}.`
    : '';
  throw residentServiceError(
    service,
    `Durable run did not reach ${label}.${stateDetail}${errorDetail}`,
  );
}

/**
 * @param {{read: () => Promise<Record<string, any> | null>}} observer - Durable lifecycle observer.
 * @param {(snapshot: Record<string, any> | null) => boolean} predicate - Required durable state.
 * @param {{getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Resident child to diagnose.
 * @param {string} label - State being awaited.
 * @returns {Promise<Record<string, any>>} - Matching lifecycle snapshot.
 */
async function waitForResidentLifecycle(observer, predicate, service, label) {
  const deadline = Date.now() + RESIDENT_SERVICE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.getExit()) {
      throw residentServiceError(
        service,
        `Resident SEA exited before reaching ${label}.`,
      );
    }
    try {
      const snapshot = await observer.read();
      if (predicate(snapshot)) return snapshot;
    } catch {
      // A just-created LMDB control volume may not be observable yet.
    }
    await delay(RESIDENT_SERVICE_POLL_INTERVAL_MS);
  }
  throw residentServiceError(service, `Resident SEA did not reach ${label}.`);
}

/**
 * Wait until the copied SEA, rather than the host observer, has created a
 * stable LMDB data/lock pair. LMDB read-only environments still register a
 * reader in an existing lock file, so observing only after both files exist
 * prevents this host process from creating or initializing control state.
 * @param {string} controlPath - Durable control-store parent selected for the resident SEA.
 * @param {{getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Resident child to diagnose.
 * @returns {Promise<void>} - Resolves after the SEA owns an initialized LMDB volume.
 */
async function waitForResidentControlVolume(controlPath, service) {
  const dataPath = path.join(controlPath, 'lmdb', 'data.mdb');
  const lockPath = path.join(controlPath, 'lmdb', 'lock.mdb');
  const deadline = Date.now() + RESIDENT_SERVICE_TIMEOUT_MS;
  /** @type {string | null} */
  let priorSnapshot = null;
  while (Date.now() < deadline) {
    if (service.getExit()) {
      throw residentServiceError(
        service,
        'Resident SEA exited before creating its durable LMDB control volume.',
      );
    }
    const snapshotParts = [dataPath, lockPath].map((filePath) => {
      try {
        const stats = lstatSync(filePath);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) {
          return null;
        }
        return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
      } catch {
        return null;
      }
    });
    if (snapshotParts.every(Boolean)) {
      const snapshot = snapshotParts.join('|');
      if (snapshot === priorSnapshot) return;
      priorSnapshot = snapshot;
    } else {
      priorSnapshot = null;
    }
    await delay(RESIDENT_SERVICE_POLL_INTERVAL_MS);
  }
  throw residentServiceError(
    service,
    'Resident SEA did not create its durable LMDB control volume.',
  );
}

/**
 * Enumerate the exact immutable payload files below one local store.
 * @param {string} root - Payload-store root.
 * @returns {string[]} - Sorted storage keys relative to the root.
 */
function readPhysicalPayloadKeys(root) {
  if (!existsSync(root)) return [];
  /** @type {string[]} */
  const files = [];
  const visit = (/** @type {string} */ directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, filePath).split(path.sep).join('/'));
      } else {
        throw new Error(
          `Execution payload store contains a non-file entry: ${filePath}`,
        );
      }
    }
  };
  visit(root);
  return files.sort();
}

/**
 * Collect local content-addressed storage keys reachable from a rebuilt run.
 * @param {unknown} value - Candidate ledger projection node.
 * @param {Set<string>} [found] - Recursive accumulator.
 * @returns {Set<string>} - Reachable storage keys.
 */
function collectReachablePayloadKeys(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) collectReachablePayloadKeys(item, found);
    return found;
  }
  const record = /** @type {Record<string, any>} */ (value);
  if (
    record.storage?.kind === 'wharfie.local-content-addressed.v1' &&
    typeof record.storage.key === 'string'
  ) {
    found.add(record.storage.key);
  }
  for (const item of Object.values(record)) {
    collectReachablePayloadKeys(item, found);
  }
  return found;
}

/**
 * Compare physical immutable files with the references retained by one run.
 * @param {string} payloadPath - Local payload-store root.
 * @param {Record<string, any>} run - Verified rebuilt run.
 * @returns {{physical: string[], reachable: string[], orphans: string[]}} - Exact reachability snapshot.
 */
function readPayloadReachability(payloadPath, run) {
  const physical = readPhysicalPayloadKeys(payloadPath);
  const reachable = [...collectReachablePayloadKeys(run)].sort();
  const reachableSet = new Set(reachable);
  const orphans = physical.filter((key) => !reachableSet.has(key));
  for (const key of reachable) {
    assert.ok(
      physical.includes(key),
      `Execution ledger references a missing payload file: ${key}`,
    );
  }
  return { physical, reachable, orphans };
}

/**
 * Snapshot immutable payload reachability and the exact bytes behind every key.
 * @param {string} payloadPath - Local payload-store root.
 * @param {Record<string, any>} run - Verified rebuilt run.
 * @returns {{physical: string[], reachable: string[], orphans: string[], files: {key: string, size: number, sha256: string}[]}} - Exact storage snapshot.
 */
function readPayloadStorageSnapshot(payloadPath, run) {
  const reachability = readPayloadReachability(payloadPath, run);
  return {
    ...reachability,
    files: reachability.physical.map((key) => {
      const bytes = readFileSync(path.join(payloadPath, ...key.split('/')));
      return {
        key,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  };
}

/**
 * Snapshot one shared payload store against every run that may retain a
 * reference. Successor authorization spans two aggregates, so inspecting only
 * the source or target would misclassify the other aggregate's live payloads as
 * orphans.
 * @param {string} payloadPath - Local payload-store root.
 * @param {Record<string, any>[]} runs - Complete verified aggregate set.
 * @returns {{physical: string[], reachable: string[], orphans: string[], files: {key: string, size: number, sha256: string}[]}} - Exact shared storage snapshot.
 */
function readPayloadStorageSnapshotForRuns(payloadPath, runs) {
  const physical = readPhysicalPayloadKeys(payloadPath);
  const reachableSet = new Set();
  for (const run of runs) collectReachablePayloadKeys(run, reachableSet);
  const reachable = [...reachableSet].sort();
  const orphans = physical.filter((key) => !reachableSet.has(key));
  for (const key of reachable) {
    assert.ok(
      physical.includes(key),
      `Execution ledger references a missing payload file: ${key}`,
    );
  }
  return {
    physical,
    reachable,
    orphans,
    files: physical.map((key) => {
      const bytes = readFileSync(path.join(payloadPath, ...key.split('/')));
      return {
        key,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  };
}

/**
 * Bind a breakpoint to the exact installed source bytes packaged into the SEA.
 * @param {string} installedPackageRoot - Installed tarball root.
 * @param {Record<string, any>} target - Original-source anchor.
 * @returns {Record<string, any>} - Anchor with exact expected sourcesContent.
 */
function bindInstalledBreakpointSource(installedPackageRoot, target) {
  return {
    ...target,
    expectedSourceContent: readFileSync(
      path.join(installedPackageRoot, target.sourceSuffix),
      'utf8',
    ),
  };
}

/**
 * Require one pause to name only the expected source breakpoint.
 * @param {Record<string, any>} pause - Debugger.paused params.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}} breakpoint - Expected stop.
 * @param {string} label - Crash phase label.
 * @returns {void}
 */
function assertExactInspectorPause(pause, breakpoint, label) {
  const expectedIds = new Set(
    breakpoint.breakpointIds || [breakpoint.breakpointId],
  );
  const hitBreakpoints = pause.hitBreakpoints || [];
  assert.ok(
    hitBreakpoints.length > 0 &&
      hitBreakpoints.every((breakpointId) => expectedIds.has(breakpointId)),
    `${label} paused outside breakpoint ${breakpoint.name}: ${JSON.stringify(hitBreakpoints)}`,
  );
}

/**
 * Resume an inspected crash run through the adapter guard to its exact target.
 * The user-continuation case has no target breakpoint; its fsynced authored
 * marker is the boundary.
 * @param {Record<string, any>} inspector - Attached inspector.
 * @param {{getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Inspected moved SEA.
 * @param {Record<string, any>} scenario - Crash case.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}} adapterBreakpoint - Physical adapter-entry guard.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string} | null} targetBreakpoint - Exact crash target.
 * @param {string} markerPath - Authored continuation marker.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}[]} [forbiddenBreakpoints] - Physical writes that must never be entered.
 * @returns {Promise<{adapterEntries: number, marker: Record<string, any> | null}>} - Boundary evidence.
 */
async function resumeToSeaCrashBoundary(
  inspector,
  service,
  scenario,
  adapterBreakpoint,
  targetBreakpoint,
  markerPath,
  forbiddenBreakpoints = [],
) {
  let adapterEntries = 0;
  await inspector.resume();
  if (targetBreakpoint) {
    for (;;) {
      let pause;
      try {
        pause = await inspector.waitForPause();
      } catch (error) {
        throw residentServiceError(
          service,
          `${scenario.label} did not reach ${JSON.stringify(targetBreakpoint)}; continuation marker present=${existsSync(markerPath)}; inspector error=${error instanceof Error ? error.message : String(error)}.`,
        );
      }
      const hits = pause.hitBreakpoints || [];
      const forbidden = forbiddenBreakpoints.find((breakpoint) => {
        const ids = new Set(
          breakpoint.breakpointIds || [breakpoint.breakpointId],
        );
        return hits.some((breakpointId) => ids.has(breakpointId));
      });
      if (forbidden) {
        assertExactInspectorPause(pause, forbidden, scenario.label);
        throw residentServiceError(
          service,
          `${scenario.label} entered forbidden physical destination write ${forbidden.name}.`,
        );
      }
      const adapterIds = new Set(
        adapterBreakpoint.breakpointIds || [adapterBreakpoint.breakpointId],
      );
      if (hits.some((breakpointId) => adapterIds.has(breakpointId))) {
        assertExactInspectorPause(pause, adapterBreakpoint, scenario.label);
        adapterEntries += 1;
        assert.ok(
          adapterEntries <= scenario.adapterEntries,
          `${scenario.label} entered the destination adapter too often`,
        );
        await inspector.resume();
        continue;
      }
      assertExactInspectorPause(pause, targetBreakpoint, scenario.label);
      break;
    }
  } else {
    while (adapterEntries < scenario.adapterEntries) {
      const pause = await inspector.waitForPause();
      assertExactInspectorPause(pause, adapterBreakpoint, scenario.label);
      adapterEntries += 1;
      await inspector.resume();
    }
  }
  assert.equal(
    adapterEntries,
    scenario.adapterEntries,
    `${scenario.label} reached the wrong number of destination adapter entries`,
  );
  assert.equal(
    service.getExit(),
    null,
    `${scenario.label} moved SEA exited at its crash boundary`,
  );

  if (targetBreakpoint) return { adapterEntries, marker: null };
  const deadline = Date.now() + CRASH_RECOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.getExit()) {
      throw residentServiceError(
        service,
        `${scenario.label} exited before its continuation marker was durable.`,
      );
    }
    if (existsSync(markerPath)) {
      try {
        return {
          adapterEntries,
          marker: JSON.parse(readFileSync(markerPath, 'utf8')),
        };
      } catch {
        // The authored activity fsyncs before returning; retry a partial read.
      }
    }
    await delay(CRASH_RECOVERY_POLL_INTERVAL_MS);
  }
  throw residentServiceError(
    service,
    `${scenario.label} did not publish its durable continuation marker.`,
  );
}

/**
 * Resume one inspected successor retry to its exact crash target while
 * counting both the framework adapter entry and the physical destination
 * transaction entry. Existing managed-effect matrices intentionally use a
 * simpler adapter-only helper; successor parity needs both boundaries exact.
 * @param {Record<string, any>} inspector - Attached inspector.
 * @param {{getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} service - Inspected moved SEA.
 * @param {{label: string, adapterEntries: number, applicationStateWrites: number}} scenario - Exact expected execution counts.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}} adapterBreakpoint - Managed adapter entry.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}} writeBreakpoint - Application-state transaction entry.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}} targetBreakpoint - Exact crash target.
 * @param {{breakpointId: string, breakpointIds?: string[], name: string}[]} forbiddenBreakpoints - Authored execution surfaces.
 * @returns {Promise<{adapterEntries: number, applicationStateWrites: number}>} - Exact physical execution evidence.
 */
async function resumeToSeaSuccessorCrashBoundary(
  inspector,
  service,
  scenario,
  adapterBreakpoint,
  writeBreakpoint,
  targetBreakpoint,
  forbiddenBreakpoints,
) {
  let adapterEntries = 0;
  let applicationStateWrites = 0;
  await inspector.resume();
  for (;;) {
    let pause;
    try {
      pause = await inspector.waitForPause();
    } catch (error) {
      throw residentServiceError(
        service,
        `${scenario.label} did not reach ${targetBreakpoint.name}; inspector error=${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    const hits = pause.hitBreakpoints || [];
    const findHit = (
      /** @type {{breakpointId: string, breakpointIds?: string[], name: string}[]} */ breakpoints,
    ) =>
      breakpoints.find((breakpoint) => {
        const ids = new Set(
          breakpoint.breakpointIds || [breakpoint.breakpointId],
        );
        return hits.some((breakpointId) => ids.has(breakpointId));
      });
    const forbidden = findHit(forbiddenBreakpoints);
    if (forbidden) {
      assertExactInspectorPause(pause, forbidden, scenario.label);
      throw residentServiceError(
        service,
        `${scenario.label} entered forbidden execution path ${forbidden.name}.`,
      );
    }
    if (findHit([adapterBreakpoint])) {
      assertExactInspectorPause(pause, adapterBreakpoint, scenario.label);
      adapterEntries += 1;
      assert.ok(
        adapterEntries <= scenario.adapterEntries,
        `${scenario.label} entered the successor adapter too often`,
      );
      await inspector.resume();
      continue;
    }
    if (findHit([writeBreakpoint])) {
      assertExactInspectorPause(pause, writeBreakpoint, scenario.label);
      applicationStateWrites += 1;
      assert.ok(
        applicationStateWrites <= scenario.applicationStateWrites,
        `${scenario.label} entered application-state too often`,
      );
      await inspector.resume();
      continue;
    }
    assertExactInspectorPause(pause, targetBreakpoint, scenario.label);
    break;
  }
  assert.equal(adapterEntries, scenario.adapterEntries);
  assert.equal(applicationStateWrites, scenario.applicationStateWrites);
  assert.equal(
    service.getExit(),
    null,
    `${scenario.label} moved SEA exited before its crash boundary`,
  );
  return { adapterEntries, applicationStateWrites };
}

/**
 * Spawn one relocated SEA command and leave it paused at an exact workflow or
 * operator response boundary. The workflow host handoff is counted separately
 * from the target so claim/recovery cases can prove that authored code never
 * became reachable.
 * @param {string} artifactPath - Relocated standalone SEA.
 * @param {string[]} args - Packaged command arguments.
 * @param {{cwd: string, env: Record<string, string>, installedPackageRoot: string, label: string, target: Record<string, any>, expectedWorkflowDispatches: number}} options - Exact boundary request.
 * @returns {Promise<{service: ReturnType<typeof spawnInspectorPausedProcess>, inspector: Record<string, any>, workflowDispatchObserved: boolean}>} - Paused process and dispatch evidence.
 */
async function pauseRelocatedSeaAtWorkflowBoundary(
  artifactPath,
  args,
  options,
) {
  assert.ok(
    options.expectedWorkflowDispatches === 0 ||
      options.expectedWorkflowDispatches === 1,
    `${options.label} requires a boolean workflow-dispatch expectation.`,
  );
  const service = spawnInspectorPausedProcess(artifactPath, args, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
  });
  /** @type {Record<string, any> | undefined} */
  let inspector;
  try {
    inspector = await attachSeaInspector(service, {
      timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
    });
    const target = await inspector.setSourceBreakpoint(
      options.label,
      bindInstalledBreakpointSource(
        options.installedPackageRoot,
        options.target,
      ),
    );
    const targetIsDispatch =
      options.target.sourceSuffix ===
        SEA_WORKFLOW_DISPATCH_BREAKPOINT.sourceSuffix &&
      options.target.anchor === SEA_WORKFLOW_DISPATCH_BREAKPOINT.anchor &&
      (options.target.occurrence || 1) === 1;
    const workflowDispatch = targetIsDispatch
      ? target
      : await inspector.setSourceBreakpoint(
          'workflow-activity-dispatch',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_WORKFLOW_DISPATCH_BREAKPOINT,
          ),
        );
    const forbidden = await Promise.all(
      [
        {
          name: 'manual-activity-dispatch',
          target: SEA_ACTIVITY_DISPATCH_BREAKPOINT,
        },
        {
          name: 'developer-cli-dispatch',
          target: SEA_APP_CLI_DISPATCH_BREAKPOINT,
        },
        {
          name: 'managed-effect-adapter',
          target: SEA_CRASH_ADAPTER_BREAKPOINT,
        },
      ].map(
        async (item) =>
          await inspector.setSourceBreakpoint(
            item.name,
            bindInstalledBreakpointSource(
              options.installedPackageRoot,
              item.target,
            ),
          ),
      ),
    );
    const isHit = (
      /** @type {Record<string, any>} */ pause,
      /** @type {Record<string, any>} */ breakpoint,
    ) => {
      const ids = new Set(
        breakpoint.breakpointIds || [breakpoint.breakpointId],
      );
      return (pause.hitBreakpoints || []).some((id) => ids.has(id));
    };
    let workflowDispatchObserved = false;
    await inspector.resume();
    for (;;) {
      let pause;
      try {
        pause = await inspector.waitForPause();
      } catch (error) {
        throw residentServiceError(
          service,
          `${options.label} did not reach its exact breakpoint: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
      if (isHit(pause, target)) {
        assertExactInspectorPause(pause, target, options.label);
        break;
      }
      const forbiddenHit = forbidden.find((breakpoint) =>
        isHit(pause, breakpoint),
      );
      if (forbiddenHit) {
        assertExactInspectorPause(pause, forbiddenHit, options.label);
        throw residentServiceError(
          service,
          `${options.label} entered forbidden ${forbiddenHit.name}.`,
        );
      }
      if (!targetIsDispatch && isHit(pause, workflowDispatch)) {
        assertExactInspectorPause(pause, workflowDispatch, options.label);
        assert.equal(
          options.expectedWorkflowDispatches,
          1,
          `${options.label} entered an unexpected workflow activity dispatch.`,
        );
        // One source-mapped await expression can expose multiple generated
        // breakpoint locations. Durable wx markers remain the physical
        // exactly-once oracle; this guard records only whether dispatch became
        // reachable before the requested later boundary.
        workflowDispatchObserved = true;
        await inspector.resume();
        continue;
      }
      assert.fail(
        `${options.label} paused outside its exact breakpoint set: ${JSON.stringify(pause.hitBreakpoints || [])}`,
      );
    }
    assert.equal(
      Number(workflowDispatchObserved),
      options.expectedWorkflowDispatches,
      `${options.label} reached the wrong workflow dispatch surface.`,
    );
    assert.equal(service.getExit(), null);
    return { service, inspector, workflowDispatchObserved };
  } catch (error) {
    inspector?.close();
    await stopResidentServiceForCleanup(service);
    throw error;
  }
}

/**
 * Run a normally terminating moved-SEA JSON command while source-mapped
 * breakpoints prove its exact destination adapter/write count and forbid every
 * unrelated dispatch surface.
 * @param {string} artifactPath - Relocated standalone SEA.
 * @param {string[]} args - Packaged command arguments.
 * @param {{cwd: string, env: Record<string, string>, installedPackageRoot: string, label: string, forbiddenTargets?: Array<{name: string, target: Record<string, any>}>, allowedAdapterEntries?: number, allowedApplicationStateWrites?: number, expectedExitCode?: number, writeBreakpointTarget?: Record<string, any>}} options - Guard inputs.
 * @returns {Promise<{serialized: string, value: Record<string, any>, adapterEntries: number, applicationStateWrites: number, stderr: string}>} - Exact command response and dispatch evidence.
 */
async function runInspectorGuardedSeaJson(artifactPath, args, options) {
  const allowedAdapterEntries = options.allowedAdapterEntries || 0;
  const allowedApplicationStateWrites =
    options.allowedApplicationStateWrites || 0;
  const expectedExitCode = options.expectedExitCode || 0;
  assert.ok(
    Number.isInteger(allowedAdapterEntries) && allowedAdapterEntries >= 0,
  );
  assert.ok(
    Number.isInteger(allowedApplicationStateWrites) &&
      allowedApplicationStateWrites >= 0,
  );
  assert.ok(Number.isInteger(expectedExitCode) && expectedExitCode >= 0);
  const service = spawnInspectorPausedProcess(artifactPath, args, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
  });
  /** @type {Record<string, any> | undefined} */
  let inspector;
  try {
    inspector = await attachSeaInspector(service, {
      timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
    });
    const adapterBreakpoint = await inspector.setSourceBreakpoint(
      'destination-adapter-entry',
      bindInstalledBreakpointSource(
        options.installedPackageRoot,
        SEA_CRASH_ADAPTER_BREAKPOINT,
      ),
    );
    const writeBreakpoint = await inspector.setSourceBreakpoint(
      'application-state-write-entry',
      bindInstalledBreakpointSource(
        options.installedPackageRoot,
        options.writeBreakpointTarget || SEA_CRASH_DESTINATION_WRITE_BREAKPOINT,
      ),
    );
    const additionalForbiddenBreakpoints = await Promise.all(
      (options.forbiddenTargets || []).map(
        async ({ name, target }) =>
          await inspector.setSourceBreakpoint(
            name,
            bindInstalledBreakpointSource(options.installedPackageRoot, target),
          ),
      ),
    );
    let adapterEntries = 0;
    let applicationStateWrites = 0;
    const waitForPause = () =>
      inspector.waitForPause().then(
        (value) => ({ kind: 'pause', value }),
        (error) => ({ kind: 'inspector-error', error }),
      );
    let pause = waitForPause();
    await inspector.resume();
    const deadline = Date.now() + CRASH_RECOVERY_TIMEOUT_MS;
    /** @type {Record<string, any> | undefined} */
    let value;
    /** @type {string | undefined} */
    let serialized;
    while (Date.now() < deadline) {
      const next = await Promise.race([
        pause,
        delay(CRASH_RECOVERY_POLL_INTERVAL_MS).then(() => ({
          kind: 'poll',
        })),
      ]);
      if (next.kind === 'pause') {
        const hits = next.value.hitBreakpoints || [];
        const forbidden = additionalForbiddenBreakpoints.find((breakpoint) => {
          const ids = new Set(
            breakpoint.breakpointIds || [breakpoint.breakpointId],
          );
          return hits.some((breakpointId) => ids.has(breakpointId));
        });
        if (forbidden) {
          assertExactInspectorPause(next.value, forbidden, options.label);
          throw residentServiceError(
            service,
            `${options.label} entered forbidden execution path ${forbidden.name}.`,
          );
        }
        const adapterIds = new Set(
          adapterBreakpoint.breakpointIds || [adapterBreakpoint.breakpointId],
        );
        if (hits.some((breakpointId) => adapterIds.has(breakpointId))) {
          assertExactInspectorPause(
            next.value,
            adapterBreakpoint,
            options.label,
          );
          adapterEntries += 1;
          assert.ok(
            adapterEntries <= allowedAdapterEntries,
            `${options.label} entered the destination adapter too often`,
          );
          pause = waitForPause();
          await inspector.resume();
          continue;
        }
        const writeIds = new Set(
          writeBreakpoint.breakpointIds || [writeBreakpoint.breakpointId],
        );
        if (hits.some((breakpointId) => writeIds.has(breakpointId))) {
          assertExactInspectorPause(next.value, writeBreakpoint, options.label);
          applicationStateWrites += 1;
          assert.ok(
            applicationStateWrites <= allowedApplicationStateWrites,
            `${options.label} entered the application-state write too often`,
          );
          pause = waitForPause();
          await inspector.resume();
          continue;
        }
        assert.fail(
          `${options.label} paused outside its execution guards: ${JSON.stringify(hits)}`,
        );
      }
      if (next.kind === 'inspector-error' && !service.getExit()) {
        throw next.error;
      }
      const output = service.getOutput();
      const candidate = output.stdout.trim();
      if (candidate) {
        try {
          value = JSON.parse(candidate);
          serialized = candidate;
          break;
        } catch {
          // The complete one-line JSON response has not drained yet.
        }
      }
      if (service.getExit()) {
        await service.exited;
        throw residentServiceError(
          service,
          `${options.label} exited before returning valid JSON.`,
        );
      }
    }
    if (!value || serialized === undefined) {
      throw residentServiceError(
        service,
        `${options.label} returned no JSON within ${CRASH_RECOVERY_TIMEOUT_MS}ms.`,
      );
    }
    inspector.close();
    inspector = undefined;
    const exited = await waitWithTimeout(
      service.exited,
      CRASH_RECOVERY_TIMEOUT_MS,
      `${options.label} inspector-detached exit`,
    );
    assert.deepEqual(
      exited,
      { code: expectedExitCode, signal: null },
      residentServiceError(service, `${options.label} exited unsuccessfully.`)
        .message,
    );
    assert.equal(
      adapterEntries,
      allowedAdapterEntries,
      `${options.label} entered the destination adapter the wrong number of times`,
    );
    assert.equal(
      applicationStateWrites,
      allowedApplicationStateWrites,
      `${options.label} entered the application-state write the wrong number of times`,
    );
    return {
      serialized,
      value,
      adapterEntries,
      applicationStateWrites,
      stderr: service.getOutput().stderr,
    };
  } finally {
    inspector?.close();
    await stopResidentServiceForCleanup(service);
  }
}

/**
 * @param {number} runVersion - Durable run version before recovery.
 * @returns {string[]} - Exact crash-run event vocabulary.
 */
function seaCrashEventTypes(runVersion) {
  const types = ['manual-run-created', 'attempt-claimed', 'attempt-started'];
  if (runVersion >= 4) types.push('effect-requested');
  if (runVersion >= 5) types.push('effect-started');
  if (runVersion >= 6) types.push('effect-completed');
  return types;
}

/**
 * Project only terminal effect authority that recovery must preserve exactly.
 * @param {Record<string, any> | null} delivery - Verified effect delivery.
 * @returns {Record<string, any> | null} - Stable terminal authority.
 */
function terminalDeliveryAuthority(delivery) {
  if (!delivery?.resultFrame) return null;
  return {
    effect: delivery.effect,
    outcome: delivery.outcome,
    resultFrame: delivery.resultFrame,
  };
}

/**
 * Assert the redacted packaged recovery response for one crash case.
 * @param {string} serialized - Exact response bytes without trailing newline.
 * @param {Record<string, any>} view - Parsed recovery response.
 * @param {Record<string, any>} scenario - Crash case.
 * @param {{runId: string, effectVersion: number | null, actor: Record<string, any>, secrets: string[]}} expected - Public truth.
 * @returns {void}
 */
function assertSeaCrashRecoveryView(serialized, view, scenario, expected) {
  assert.equal(view.schemaVersion, 7);
  assert.equal(view.kind, 'wharfie.execution-ledger.recovery');
  assert.deepEqual(view.integrity, { verified: true });
  assert.equal(view.run.runId, expected.runId);
  assert.equal(view.run.status, 'BLOCKED');
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].status, 'UNCERTAIN');
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].status, 'ABANDONED');
  const expectedRecovery = {
    action: scenario.recoveryAction,
    changed: true,
    ...(scenario.managedAction
      ? {
          managedEffects: [
            {
              effectId: SEA_CRASH_EFFECT_ID,
              action: scenario.managedAction,
              status: scenario.effectAfter,
            },
          ],
        }
      : {}),
  };
  assert.deepEqual(view.recovery, expectedRecovery);
  assert.equal(view.effects.length, scenario.effectAfter === null ? 0 : 1);
  if (scenario.effectAfter !== null) {
    assert.equal(view.effects[0].effectId, SEA_CRASH_EFFECT_ID);
    assert.equal(view.effects[0].status, scenario.effectAfter);
    assert.equal(view.effects[0].version, expected.effectVersion);
  }
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.type),
    [...seaCrashEventTypes(scenario.runVersion), 'attempt-became-uncertain'],
  );
  assert.deepEqual(view.history.at(-1)?.actor, expected.actor);
  for (const secret of expected.secrets) {
    assert.equal(
      serialized.includes(secret),
      false,
      `${scenario.label} recovery disclosed ${secret}`,
    );
  }
}

/**
 * Assert one raw run at the exact paused pre-kill boundary.
 * @param {Record<string, any>} run - Verified rebuilt run.
 * @param {Record<string, any>} scenario - Crash case.
 * @param {{runId: string, revisionId: string, destinationEffectId: string}} expected - Durable identities.
 * @returns {void}
 */
function assertSeaCrashRunBeforeRecovery(run, scenario, expected) {
  assert.equal(run.run.runId, expected.runId);
  assert.equal(run.run.revisionId, expected.revisionId);
  assert.equal(run.run.status, 'RUNNING');
  assert.equal(run.run.version, scenario.runVersion);
  assert.equal(run.invocations.length, 1);
  assert.equal(run.invocations[0].status, 'RUNNING');
  assert.equal(run.attempts.length, 1);
  assert.equal(run.attempts[0].status, 'STARTED');
  assert.equal(run.attempts[0].generation, 1);
  assert.deepEqual(
    run.events.map((/** @type {Record<string, any>} */ event) => event.type),
    seaCrashEventTypes(scenario.runVersion),
  );
  const packagedActor = {
    kind: 'packaged-operator',
    id: expected.revisionId,
  };
  assert.deepEqual(
    run.events.map((/** @type {Record<string, any>} */ event) => event.actor),
    [
      packagedActor,
      packagedActor,
      packagedActor,
      ...Array.from({ length: scenario.runVersion - 3 }, () => ({
        kind: 'runtime',
        id: 'managed-effect',
      })),
    ],
  );
  assert.equal(run.effects.length, scenario.effectBefore === null ? 0 : 1);
  if (scenario.effectBefore !== null) {
    assert.equal(run.effects[0].effectId, SEA_CRASH_EFFECT_ID);
    assert.equal(run.effects[0].status, scenario.effectBefore);
    assert.equal(run.effects[0].version, scenario.effectVersionBefore);
    assert.equal(
      run.effects[0].destinationEffectId,
      expected.destinationEffectId,
    );
  }
}

/**
 * Assert raw post-recovery state and the one compound closure event.
 * @param {Record<string, any>} before - Paused pre-kill run.
 * @param {Record<string, any>} after - Recovered run.
 * @param {Record<string, any>} scenario - Crash case.
 * @param {Record<string, any>} actor - Expected packaged recovery actor.
 * @returns {void}
 */
function assertSeaCrashRunAfterRecovery(before, after, scenario, actor) {
  assert.equal(after.run.status, 'BLOCKED');
  assert.equal(after.run.version, before.run.version + 1);
  assert.equal(after.invocations[0].status, 'UNCERTAIN');
  assert.equal(after.attempts[0].status, 'ABANDONED');
  assert.equal(after.effects.length, scenario.effectAfter === null ? 0 : 1);
  if (scenario.effectAfter !== null) {
    assert.equal(after.effects[0].effectId, SEA_CRASH_EFFECT_ID);
    assert.equal(after.effects[0].status, scenario.effectAfter);
    assert.equal(after.effects[0].version, scenario.effectVersionAfter);
  }
  assert.equal(after.events.length, before.events.length + 1);
  const closure = after.events.at(-1);
  assert.equal(closure.type, 'attempt-became-uncertain');
  assert.deepEqual(closure.actor, actor);
  assert.deepEqual(
    closure.payload.effects.map(
      (/** @type {Record<string, any>} */ effect) => ({
        effectId: effect.effectId,
        status: effect.status,
      }),
    ),
    scenario.eventEffects,
  );
}

/**
 * Exercise every managed-effect persistence boundary through the relocated
 * SEA, real SIGKILL, packaged recovery, and packaged recovery replay.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string}} options - Matrix inputs.
 * @returns {Promise<void>} - Resolves after all crash cases recover exactly.
 */
async function verifyRelocatedSeaCrashMatrix(options) {
  const recoveryActor = {
    kind: 'packaged-operator',
    id: options.revisionId,
  };
  for (const scenario of SEA_CRASH_CASES) {
    const caseRoot = path.join(options.root, scenario.boundary);
    const controlPath = path.join(caseRoot, 'control');
    const payloadPath = path.join(controlPath, 'execution-payloads');
    const sessionPath = path.join(caseRoot, 'sessions');
    const applicationStatePath = path.join(caseRoot, 'application-state');
    const markerPath = path.join(caseRoot, 'user-continuation.json');
    const tableName = 'wharfie-package-sea-crash-matrix';
    mkdirSync(caseRoot, { recursive: true, mode: 0o700 });
    const environment = {
      ...options.cleanEnvironment,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: controlPath,
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
    };
    const fixture = await createInstalledExecutionLedgerFixture({
      installedPackageRoot: options.installedPackageRoot,
      controlPath,
      tableName,
      payloadPath,
      applicationStatePath,
      revisionId: options.revisionId,
    });
    const lifecycle = await createInstalledLedgerLifecycleObserver({
      installedPackageRoot: options.installedPackageRoot,
      controlPath,
      tableName,
      appId: options.appId,
    });
    const nonce = randomUUID();
    const idempotencyKey = `sea-crash-${scenario.boundary}`;
    const runId = fixture.createRunId(options.appId, idempotencyKey);
    const destinationEffectId = fixture.createDestinationEffectId(
      options.appId,
      runId,
      SEA_CRASH_EFFECT_ID,
    );
    const logicalKey = `sea-crash-key-${scenario.boundary}`;
    const inputValue = {
      boundary: scenario.boundary,
      nonce,
      guarantee: 'destination-atomic-effect-id',
    };
    const callerRequestId = `sea-crash-request-${scenario.boundary}`;
    const input = {
      key: logicalKey,
      value: inputValue,
      crash: {
        continuationMarkerPath: markerPath,
        nonce,
        pauseAfterEffect: true,
      },
    };
    const runArgs = [
      'wharfie',
      'run',
      '--activity',
      'persist-once',
      '--idempotency-key',
      idempotencyKey,
      '--input',
      JSON.stringify(input),
      '--caller-metadata',
      JSON.stringify({
        requestId: callerRequestId,
        boundary: scenario.boundary,
      }),
      '--json',
    ];
    const recoveryArgs = [
      'wharfie',
      'recover',
      '--run-id',
      runId,
      '--confirm-runner-stopped',
      '--json',
    ];
    /** @type {ReturnType<typeof spawnInspectorPausedProcess> | undefined} */
    let service;
    /** @type {Record<string, any> | undefined} */
    let inspector;
    /** @type {string | undefined} */
    let staleEndpoint;
    try {
      service = spawnInspectorPausedProcess(options.artifactPath, runArgs, {
        cwd: caseRoot,
        env: environment,
        timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
      });
      inspector = await attachSeaInspector(service, {
        timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
      });
      const adapterBreakpoint = await inspector.setSourceBreakpoint(
        'destination-adapter-entry',
        bindInstalledBreakpointSource(
          options.installedPackageRoot,
          SEA_CRASH_ADAPTER_BREAKPOINT,
        ),
      );
      const targetBreakpoint = scenario.breakpoint
        ? await inspector.setSourceBreakpoint(
            scenario.boundary,
            bindInstalledBreakpointSource(
              options.installedPackageRoot,
              scenario.breakpoint,
            ),
          )
        : null;
      const boundaryEvidence = await resumeToSeaCrashBoundary(
        inspector,
        service,
        scenario,
        adapterBreakpoint,
        targetBreakpoint,
        markerPath,
      );
      assert.equal(boundaryEvidence.adapterEntries, scenario.adapterEntries);
      if (scenario.breakpoint) {
        assert.equal(boundaryEvidence.marker, null);
        assert.equal(
          existsSync(markerPath),
          false,
          `${scenario.label} allowed authored user continuation before SIGKILL`,
        );
      } else {
        assert.deepEqual(boundaryEvidence.marker, {
          kind: 'packaged-activity-continuation',
          nonce,
          executable: realpathSync(options.artifactPath),
          effect: { inserted: true },
        });
      }

      const runBefore = await fixture.readRun(runId);
      assert.ok(runBefore, `${scenario.label} retained no durable run`);
      assertSeaCrashRunBeforeRecovery(runBefore, scenario, {
        runId,
        revisionId: options.revisionId,
        destinationEffectId,
      });
      const deliveryBefore = await fixture.readManagedEffectDelivery(
        runId,
        SEA_CRASH_EFFECT_ID,
      );
      if (scenario.effectBefore === null) {
        assert.equal(deliveryBefore, null);
      } else {
        assert.equal(deliveryBefore?.effect.status, scenario.effectBefore);
        assert.equal(deliveryBefore?.request.input.key, logicalKey);
        assert.deepEqual(deliveryBefore?.request.input.value, inputValue);
      }
      const terminalAuthorityBefore = terminalDeliveryAuthority(deliveryBefore);
      if (scenario.effectBefore === 'COMPLETED') {
        assert.ok(
          terminalAuthorityBefore,
          `${scenario.label} omitted terminal redelivery authority`,
        );
        assert.deepEqual(terminalAuthorityBefore.resultFrame.result, {
          inserted: true,
        });
      } else {
        assert.equal(terminalAuthorityBefore, null);
      }

      const destinationBefore = await fixture.readApplicationStateDestination(
        options.appId,
        destinationEffectId,
        logicalKey,
      );
      assert.equal(
        destinationBefore.receipt !== null,
        scenario.destinationState,
        `${scenario.label} has the wrong destination receipt state`,
      );
      assert.equal(
        destinationBefore.business !== null,
        scenario.destinationState,
        `${scenario.label} has the wrong destination business state`,
      );
      if (scenario.destinationState) {
        assert.deepEqual(
          {
            destinationEffectId:
              destinationBefore.receipt.destination_effect_id,
            outcomeCode: destinationBefore.receipt.outcome_code,
            inserted: destinationBefore.receipt.inserted,
            namespace: destinationBefore.business.namespace,
            logicalKey: destinationBefore.business.logical_key,
            value: destinationBefore.business.value,
            createdBy:
              destinationBefore.business.created_by_destination_effect_id,
          },
          {
            destinationEffectId,
            outcomeCode: 'inserted',
            inserted: true,
            namespace: options.appId,
            logicalKey,
            value: inputValue,
            createdBy: destinationEffectId,
          },
        );
      }
      const payloadBefore = readPayloadReachability(payloadPath, runBefore);
      assert.equal(
        payloadBefore.orphans.length,
        scenario.orphanPayloadsBefore,
        `${scenario.label} has the wrong pre-recovery payload reachability`,
      );
      assert.equal(
        payloadBefore.physical.length,
        payloadBefore.reachable.length + scenario.orphanPayloadsBefore,
      );

      const ownershipBefore = await lifecycle.readOwnership();
      assert.ok(ownershipBefore, `${scenario.label} has no mutation owner`);
      assert.equal(ownershipBefore.appId, options.appId);
      assert.equal(ownershipBefore.ownerKind, 'manual');
      assert.equal(ownershipBefore.generation, 1);
      staleEndpoint = lifecycle.getSessionEndpoint(
        ownershipBefore.sessionId,
        sessionPath,
      );
      assert.equal(
        existsSync(staleEndpoint),
        true,
        `${scenario.label} owner endpoint was not held`,
      );

      const killed = await signalResidentService(service, 'SIGKILL');
      assert.deepEqual(killed, { code: null, signal: 'SIGKILL' });
      inspector.close();
      inspector = undefined;
      assert.deepEqual(
        await lifecycle.readOwnership(),
        ownershipBefore,
        `${scenario.label} SIGKILL did not leave exact stale ownership`,
      );
      assert.equal(existsSync(staleEndpoint), true);

      const recovery = await runInspectorGuardedSeaJson(
        options.artifactPath,
        recoveryArgs,
        {
          cwd: caseRoot,
          env: environment,
          installedPackageRoot: options.installedPackageRoot,
          label: `${scenario.label} recovery`,
        },
      );
      assertSeaCrashRecoveryView(
        recovery.serialized,
        recovery.value,
        scenario,
        {
          runId,
          effectVersion: scenario.effectVersionAfter,
          actor: recoveryActor,
          secrets: [
            logicalKey,
            nonce,
            callerRequestId,
            destinationEffectId,
            markerPath,
            'destinationEffectId',
            'continuationMarkerPath',
          ],
        },
      );
      const runAfter = await fixture.readRun(runId);
      assert.ok(runAfter, `${scenario.label} recovery lost the durable run`);
      assertSeaCrashRunAfterRecovery(
        runBefore,
        runAfter,
        scenario,
        recoveryActor,
      );
      assert.equal(await lifecycle.readOwnership(), null);
      assert.deepEqual(
        await fixture.readApplicationStateDestination(
          options.appId,
          destinationEffectId,
          logicalKey,
        ),
        destinationBefore,
        `${scenario.label} recovery changed destination state`,
      );
      const deliveryAfter = await fixture.readManagedEffectDelivery(
        runId,
        SEA_CRASH_EFFECT_ID,
      );
      if (terminalAuthorityBefore) {
        assert.deepEqual(
          terminalDeliveryAuthority(deliveryAfter),
          terminalAuthorityBefore,
          `${scenario.label} recovery rewrote terminal delivery authority`,
        );
      } else if (scenario.effectAfter === 'COMPLETED') {
        assert.deepEqual(deliveryAfter?.resultFrame.result, { inserted: true });
        assert.equal(deliveryAfter?.outcome.ok, true);
      } else {
        assert.equal(deliveryAfter?.resultFrame, undefined);
      }

      const payloadAfter = readPayloadReachability(payloadPath, runAfter);
      assert.equal(
        payloadAfter.orphans.length,
        scenario.orphanPayloadsAfter,
        `${scenario.label} has the wrong recovered payload reachability`,
      );
      if (scenario.boundary === 'destination-transaction-committed') {
        assert.equal(
          payloadAfter.physical.length,
          payloadBefore.physical.length + 1,
        );
      } else {
        assert.deepEqual(
          payloadAfter.physical,
          payloadBefore.physical,
          `${scenario.label} recovery changed immutable payload files`,
        );
      }
      if (scenario.boundary === 'outcome-payload-published') {
        assert.deepEqual(payloadBefore.orphans, [
          runAfter.effects[0].outcomeRef.storage.key,
        ]);
      }
      assert.equal(
        existsSync(markerPath),
        scenario.breakpoint === null,
        `${scenario.label} changed authored continuation evidence`,
      );
      if (scenario.breakpoint === null) {
        assert.deepEqual(
          JSON.parse(readFileSync(markerPath, 'utf8')),
          boundaryEvidence.marker,
        );
      }

      const replay = await runInspectorGuardedSeaJson(
        options.artifactPath,
        recoveryArgs,
        {
          cwd: caseRoot,
          env: environment,
          installedPackageRoot: options.installedPackageRoot,
          label: `${scenario.label} recovery replay`,
        },
      );
      assert.deepEqual(replay.value.recovery, {
        action: 'none',
        changed: false,
      });
      const { recovery: _firstRecovery, ...firstStableView } = recovery.value;
      const { recovery: _replayRecovery, ...replayStableView } = replay.value;
      assert.deepEqual(replayStableView, firstStableView);
      assert.deepEqual(await fixture.readRun(runId), runAfter);
      assert.equal(await lifecycle.readOwnership(), null);
      assert.deepEqual(
        await fixture.readApplicationStateDestination(
          options.appId,
          destinationEffectId,
          logicalKey,
        ),
        destinationBefore,
      );
      assert.deepEqual(
        readPayloadReachability(payloadPath, runAfter),
        payloadAfter,
      );
      assert.equal(existsSync(staleEndpoint), true);
    } finally {
      inspector?.close();
      await stopResidentServiceForCleanup(service);
      if (staleEndpoint) rmSync(staleEndpoint, { force: true });
      rmSync(caseRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Exercise stopped mixed-effect settlement persistence through the relocated
 * SEA, real SIGKILL, packaged recovery, and packaged recovery replay.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string}} options - Matrix inputs.
 * @returns {Promise<void>} - Resolves after all mixed crash cases recover exactly.
 */
async function verifyRelocatedSeaMixedSettlementCrashMatrix(options) {
  const recoveryActor = {
    kind: 'packaged-operator',
    id: options.revisionId,
  };
  for (const scenario of SEA_MIXED_SETTLEMENT_CRASH_CASES) {
    const caseRoot = path.join(options.root, scenario.boundary);
    const controlPath = path.join(caseRoot, 'control');
    const payloadPath = path.join(controlPath, 'execution-payloads');
    const sessionPath = path.join(caseRoot, 'sessions');
    const applicationStatePath = path.join(caseRoot, 'application-state');
    const markerPath = path.join(
      caseRoot,
      'authored-marker-must-not-exist.json',
    );
    const tableName = 'wharfie-package-sea-mixed-settlement-crash-matrix';
    mkdirSync(caseRoot, { recursive: true, mode: 0o700 });
    const environment = {
      ...options.cleanEnvironment,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: controlPath,
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
    };
    const fixture = await createInstalledExecutionLedgerFixture({
      installedPackageRoot: options.installedPackageRoot,
      controlPath,
      tableName,
      payloadPath,
      applicationStatePath,
      revisionId: options.revisionId,
    });
    const lifecycle = await createInstalledLedgerLifecycleObserver({
      installedPackageRoot: options.installedPackageRoot,
      controlPath,
      tableName,
      appId: options.appId,
    });
    const batch = await fixture.createApplicationStateRecoveryBatchRun(
      options.appId,
      `sea-mixed-settlement-crash-${scenario.boundary}`,
      [...SEA_MIXED_SETTLEMENT_EFFECT_SPECS],
    );
    const recoveryArgs = [
      'wharfie',
      'recover',
      '--run-id',
      batch.runId,
      '--confirm-runner-stopped',
      '--json',
    ];
    /** @type {ReturnType<typeof spawnInspectorPausedProcess> | undefined} */
    let service;
    /** @type {Record<string, any> | undefined} */
    let inspector;
    /** @type {string | undefined} */
    let staleEndpoint;
    try {
      const seededRun = await fixture.readRun(batch.runId);
      assert.ok(seededRun, `${scenario.label} retained no seeded run`);
      assert.equal(seededRun.run.status, 'RUNNING');
      assert.equal(seededRun.invocations[0].status, 'RUNNING');
      assert.equal(seededRun.attempts[0].status, 'STARTED');
      assert.deepEqual(
        seededRun.effects.map(
          (/** @type {Record<string, any>} */ effect) => effect.status,
        ),
        batch.effects.map((effect) => effect.initialStatus),
      );
      assert.deepEqual(
        seededRun.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
        seededManagedEffectEventTypes(batch),
      );
      const seededPayload = readPayloadStorageSnapshot(payloadPath, seededRun);
      assert.deepEqual(seededPayload.orphans, []);
      assert.deepEqual(seededPayload.physical, seededPayload.reachable);
      const destinationsBefore = await readManagedEffectBatchDestinations(
        fixture,
        options.appId,
        batch,
      );
      for (const effect of batch.effects) {
        assert.equal(
          destinationsBefore[effect.effectId].receipt !== null,
          effect.receiptPresent,
          `${scenario.label} ${effect.effectId} began with the wrong receipt state`,
        );
        assert.equal(
          destinationsBefore[effect.effectId].business !== null,
          effect.receiptPresent,
          `${scenario.label} ${effect.effectId} began with the wrong business state`,
        );
      }
      const deliveriesBefore = await readManagedEffectBatchDeliveries(
        fixture,
        batch,
      );
      for (const effect of batch.effects) {
        assert.equal(
          deliveriesBefore[effect.effectId]?.effect.status,
          effect.initialStatus,
        );
      }
      assert.ok(
        terminalDeliveryAuthority(deliveriesBefore['04-terminal']),
        `${scenario.label} seeded no terminal sibling authority`,
      );
      assert.equal(await lifecycle.readOwnership(), null);

      service = spawnInspectorPausedProcess(
        options.artifactPath,
        recoveryArgs,
        {
          cwd: caseRoot,
          env: environment,
          timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
        },
      );
      inspector = await attachSeaInspector(service, {
        timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
      });
      const adapterBreakpoint = await inspector.setSourceBreakpoint(
        'destination-adapter-entry',
        bindInstalledBreakpointSource(
          options.installedPackageRoot,
          SEA_CRASH_ADAPTER_BREAKPOINT,
        ),
      );
      const writeBreakpoint = await inspector.setSourceBreakpoint(
        'application-state-write-entry',
        bindInstalledBreakpointSource(
          options.installedPackageRoot,
          SEA_CRASH_DESTINATION_WRITE_BREAKPOINT,
        ),
      );
      const targetBreakpoint = await inspector.setSourceBreakpoint(
        scenario.boundary,
        bindInstalledBreakpointSource(
          options.installedPackageRoot,
          scenario.breakpoint,
        ),
      );
      const boundaryEvidence = await resumeToSeaCrashBoundary(
        inspector,
        service,
        { ...scenario, adapterEntries: 0 },
        adapterBreakpoint,
        targetBreakpoint,
        markerPath,
        [writeBreakpoint],
      );
      assert.deepEqual(boundaryEvidence, { adapterEntries: 0, marker: null });
      assert.equal(
        service.getOutput().stdout,
        '',
        `${scenario.label} returned output before its crash boundary`,
      );
      assert.equal(existsSync(markerPath), false);

      const runAtBoundary = await fixture.readRun(batch.runId);
      assert.ok(runAtBoundary, `${scenario.label} lost its paused run`);
      const payloadAtBoundary = readPayloadStorageSnapshot(
        payloadPath,
        runAtBoundary,
      );
      const seededPayloadKeys = new Set(seededPayload.physical);
      const newPayloadKeys = payloadAtBoundary.physical.filter(
        (key) => !seededPayloadKeys.has(key),
      );
      assert.equal(
        newPayloadKeys.length,
        1,
        `${scenario.label} published the wrong payload set`,
      );
      const recoveredPayloadFile = payloadAtBoundary.files.find(
        (file) => file.key === newPayloadKeys[0],
      );
      assert.ok(
        recoveredPayloadFile,
        `${scenario.label} omitted recovered outcome payload bytes`,
      );
      if (scenario.settledAtBoundary) {
        assertSettledManagedEffectBatchRun(
          seededRun,
          runAtBoundary,
          batch,
          recoveryActor,
          recoveredPayloadFile,
        );
      } else {
        assert.deepEqual(
          runAtBoundary,
          seededRun,
          `${scenario.label} changed control truth before settlement`,
        );
      }
      for (const seededFile of seededPayload.files) {
        assert.deepEqual(
          payloadAtBoundary.files.find((file) => file.key === seededFile.key),
          seededFile,
          `${scenario.label} rewrote immutable payload ${seededFile.key}`,
        );
      }
      if (scenario.settledAtBoundary) {
        assert.deepEqual(payloadAtBoundary.orphans, []);
        assert.equal(
          payloadAtBoundary.reachable.length,
          seededPayload.reachable.length + 1,
        );
        assert.equal(
          runAtBoundary.effects.find(
            (/** @type {Record<string, any>} */ effect) =>
              effect.effectId === '02-receipt',
          )?.outcomeRef.storage.key,
          newPayloadKeys[0],
        );
        await assertSettledManagedEffectBatchDeliveries(
          fixture,
          batch,
          deliveriesBefore,
          await readManagedEffectBatchDeliveries(fixture, batch),
          newPayloadKeys[0],
        );
      } else {
        assert.deepEqual(payloadAtBoundary.reachable, seededPayload.reachable);
        assert.deepEqual(payloadAtBoundary.orphans, newPayloadKeys);
        assert.deepEqual(
          await readManagedEffectBatchDeliveries(fixture, batch),
          deliveriesBefore,
        );
      }
      assert.deepEqual(
        await readManagedEffectBatchDestinations(fixture, options.appId, batch),
        destinationsBefore,
        `${scenario.label} changed destination state before SIGKILL`,
      );

      const ownershipBefore = await lifecycle.readOwnership();
      assert.ok(ownershipBefore, `${scenario.label} has no mutation owner`);
      assert.equal(ownershipBefore.appId, options.appId);
      assert.equal(ownershipBefore.ownerKind, 'manual');
      assert.equal(ownershipBefore.generation, 1);
      staleEndpoint = lifecycle.getSessionEndpoint(
        ownershipBefore.sessionId,
        sessionPath,
      );
      assert.equal(
        existsSync(staleEndpoint),
        true,
        `${scenario.label} owner endpoint was not held`,
      );

      const killed = await signalResidentService(service, 'SIGKILL');
      assert.deepEqual(killed, { code: null, signal: 'SIGKILL' });
      inspector.close();
      inspector = undefined;
      assert.deepEqual(await fixture.readRun(batch.runId), runAtBoundary);
      assert.deepEqual(
        readPayloadStorageSnapshot(payloadPath, runAtBoundary),
        payloadAtBoundary,
      );
      assert.deepEqual(
        await readManagedEffectBatchDestinations(fixture, options.appId, batch),
        destinationsBefore,
      );
      assert.deepEqual(
        await lifecycle.readOwnership(),
        ownershipBefore,
        `${scenario.label} SIGKILL did not leave exact stale ownership`,
      );
      assert.equal(existsSync(staleEndpoint), true);

      const recovery = await runInspectorGuardedSeaJson(
        options.artifactPath,
        recoveryArgs,
        {
          cwd: caseRoot,
          env: environment,
          installedPackageRoot: options.installedPackageRoot,
          label: `${scenario.label} recovery`,
        },
      );
      const recoveredView = assertManagedEffectBatchRecoveryView(
        recovery.serialized,
        batch,
        {
          adapter: fixture.ApplicationStateAdapterDescriptor,
          actor: recoveryActor,
          ...(scenario.settledAtBoundary
            ? { recovery: { action: 'none', changed: false } }
            : {}),
        },
      );
      const runAfterRecovery = await fixture.readRun(batch.runId);
      assert.ok(
        runAfterRecovery,
        `${scenario.label} recovery lost the durable run`,
      );
      assertSettledManagedEffectBatchRun(
        seededRun,
        runAfterRecovery,
        batch,
        recoveryActor,
        recoveredPayloadFile,
      );
      if (scenario.settledAtBoundary) {
        assert.deepEqual(
          runAfterRecovery,
          runAtBoundary,
          `${scenario.label} restarted recovery rewrote settled control truth`,
        );
      }
      const payloadAfterRecovery = readPayloadStorageSnapshot(
        payloadPath,
        runAfterRecovery,
      );
      assert.deepEqual(
        payloadAfterRecovery.physical,
        payloadAtBoundary.physical,
      );
      assert.deepEqual(payloadAfterRecovery.files, payloadAtBoundary.files);
      assert.deepEqual(payloadAfterRecovery.orphans, []);
      assert.ok(payloadAfterRecovery.reachable.includes(newPayloadKeys[0]));
      const deliveriesAfterRecovery = await readManagedEffectBatchDeliveries(
        fixture,
        batch,
      );
      await assertSettledManagedEffectBatchDeliveries(
        fixture,
        batch,
        deliveriesBefore,
        deliveriesAfterRecovery,
        newPayloadKeys[0],
      );
      assert.deepEqual(
        await readManagedEffectBatchDestinations(fixture, options.appId, batch),
        destinationsBefore,
        `${scenario.label} recovery dispatched or rewrote destination state`,
      );
      assert.equal(await lifecycle.readOwnership(), null);
      assert.equal(existsSync(staleEndpoint), true);

      const replay = await runInspectorGuardedSeaJson(
        options.artifactPath,
        recoveryArgs,
        {
          cwd: caseRoot,
          env: environment,
          installedPackageRoot: options.installedPackageRoot,
          label: `${scenario.label} recovery replay`,
        },
      );
      const replayView = assertManagedEffectBatchRecoveryView(
        replay.serialized,
        batch,
        {
          adapter: fixture.ApplicationStateAdapterDescriptor,
          actor: recoveryActor,
          recovery: { action: 'none', changed: false },
        },
      );
      const { recovery: _firstRecovery, ...firstStableView } = recoveredView;
      const { recovery: _replayRecovery, ...replayStableView } = replayView;
      assert.deepEqual(replayStableView, firstStableView);
      assert.deepEqual(await fixture.readRun(batch.runId), runAfterRecovery);
      assert.deepEqual(
        readPayloadStorageSnapshot(payloadPath, runAfterRecovery),
        payloadAfterRecovery,
      );
      assert.deepEqual(
        await readManagedEffectBatchDeliveries(fixture, batch),
        deliveriesAfterRecovery,
      );
      assert.deepEqual(
        await readManagedEffectBatchDestinations(fixture, options.appId, batch),
        destinationsBefore,
      );
      assert.equal(await lifecycle.readOwnership(), null);
      assert.equal(existsSync(staleEndpoint), true);
    } finally {
      inspector?.close();
      await stopResidentServiceForCleanup(service);
      if (staleEndpoint) rmSync(staleEndpoint, { force: true });
      rmSync(caseRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Exercise destination-backed reconciliation through one relocated SEA and
 * one shared stopped attempt. Four uncertain siblings prove the late-receipt
 * terminal plus destination-resolution, payload-publication, and ledger-
 * response crashes without dispatching authored activity or a normal adapter.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string}} options - Matrix inputs.
 * @returns {Promise<void>} - Resolves after every disposition and replay is exact.
 */
async function verifyRelocatedSeaEffectReconciliationCrashMatrix(options) {
  const caseRoot = options.root;
  const controlPath = path.join(caseRoot, 'control');
  const payloadPath = path.join(controlPath, 'execution-payloads');
  const sessionPath = path.join(caseRoot, 'sessions');
  const applicationStatePath = path.join(caseRoot, 'application-state');
  const markerPath = path.join(caseRoot, 'authored-activity-must-not-run.json');
  const tableName = 'wharfie-package-sea-effect-reconciliation-crash-matrix';
  const packagedActor = {
    kind: 'packaged-operator',
    id: options.revisionId,
  };
  const staleEndpoints = new Set();
  mkdirSync(caseRoot, { recursive: true, mode: 0o700 });
  const environment = {
    ...options.cleanEnvironment,
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: controlPath,
    WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
    WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
    WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
    WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
  };
  const fixture = await createInstalledExecutionLedgerFixture({
    installedPackageRoot: options.installedPackageRoot,
    controlPath,
    tableName,
    payloadPath,
    applicationStatePath,
    revisionId: options.revisionId,
  });
  const lifecycle = await createInstalledLedgerLifecycleObserver({
    installedPackageRoot: options.installedPackageRoot,
    controlPath,
    tableName,
    appId: options.appId,
  });
  const forbiddenActivityTarget = {
    name: 'authored-activity-dispatch',
    target: SEA_ACTIVITY_DISPATCH_BREAKPOINT,
  };
  const forbiddenAppCliTarget = {
    name: 'authored-app-cli-dispatch',
    target: SEA_APP_CLI_DISPATCH_BREAKPOINT,
  };
  const forbiddenResolutionWriteTarget = {
    name: 'application-state-resolution-write',
    target: SEA_EFFECT_RESOLUTION_WRITE_BREAKPOINT,
  };
  const unavailableNode = spawnSync('node', ['--version'], {
    encoding: 'utf8',
    env: environment,
  });
  assert.equal(
    /** @type {NodeJS.ErrnoException | undefined} */ (unavailableNode.error)
      ?.code,
    'ENOENT',
    'Effect reconciliation matrix unexpectedly exposes a Node executable',
  );

  try {
    const batch = await fixture.createApplicationStateRecoveryBatchRun(
      options.appId,
      'sea-effect-reconciliation-crash-matrix',
      [...SEA_EFFECT_RECONCILIATION_SPECS],
    );
    const seededRun = await fixture.readRun(batch.runId);
    assert.ok(seededRun, 'effect reconciliation matrix retained no seeded run');
    assert.equal(seededRun.run.status, 'RUNNING');
    assert.equal(seededRun.invocations[0].status, 'RUNNING');
    assert.equal(seededRun.attempts[0].status, 'STARTED');
    assert.deepEqual(
      seededRun.effects.map((effect) => effect.status),
      Array.from({ length: batch.effects.length }, () => 'STARTED'),
    );
    const seededPayload = readPayloadStorageSnapshot(payloadPath, seededRun);
    const seededDestinations = await readManagedEffectBatchDestinations(
      fixture,
      options.appId,
      batch,
    );
    for (const effect of batch.effects) {
      assert.deepEqual(seededDestinations[effect.effectId], {
        receipt: null,
        resolution: null,
        business: null,
      });
    }

    const recoveryArgs = [
      'wharfie',
      'recover',
      '--run-id',
      batch.runId,
      '--confirm-runner-stopped',
      '--json',
    ];
    const recovery = await runInspectorGuardedSeaJson(
      options.artifactPath,
      recoveryArgs,
      {
        cwd: caseRoot,
        env: environment,
        installedPackageRoot: options.installedPackageRoot,
        label: 'effect reconciliation stopped-attempt setup',
        forbiddenTargets: [
          forbiddenActivityTarget,
          forbiddenAppCliTarget,
          forbiddenResolutionWriteTarget,
        ],
      },
    );
    assertManagedEffectBatchRecoveryView(recovery.serialized, batch, {
      adapter: fixture.ApplicationStateAdapterDescriptor,
      actor: packagedActor,
    });
    const stoppedRun = await fixture.readRun(batch.runId);
    assert.ok(stoppedRun, 'effect reconciliation recovery lost its run');
    assertSettledManagedEffectBatchRun(
      seededRun,
      stoppedRun,
      batch,
      packagedActor,
      /** @type {any} */ ({}),
    );
    assert.equal(stoppedRun.run.status, 'BLOCKED');
    assert.equal(stoppedRun.invocations[0].status, 'UNCERTAIN');
    assert.equal(stoppedRun.attempts[0].status, 'ABANDONED');
    assert.deepEqual(
      stoppedRun.effects.map((effect) => effect.status),
      Array.from({ length: batch.effects.length }, () => 'UNCERTAIN'),
    );
    assert.deepEqual(
      readPayloadStorageSnapshot(payloadPath, stoppedRun),
      seededPayload,
      'absence-only stopped recovery changed immutable payload storage',
    );
    assert.deepEqual(
      await readManagedEffectBatchDestinations(fixture, options.appId, batch),
      seededDestinations,
      'absence-only stopped recovery changed application state',
    );
    assert.equal(await lifecycle.readOwnership(), null);
    assert.equal(existsSync(markerPath), false);

    const lateReceiptEffectId = SEA_EFFECT_RECONCILIATION_SPECS[0].effectId;
    const beforeLateReceiptRun = await fixture.readRun(batch.runId);
    assert.ok(beforeLateReceiptRun, 'late receipt setup lost its durable run');
    const beforeLateReceiptPayload = readPayloadStorageSnapshot(
      payloadPath,
      beforeLateReceiptRun,
    );
    const lateOutcome = await fixture.materializeApplicationStateReceipt(
      options.appId,
      batch.runId,
      lateReceiptEffectId,
    );
    assert.deepEqual(lateOutcome.result, { inserted: true });
    assert.deepEqual(
      await fixture.readRun(batch.runId),
      beforeLateReceiptRun,
      'late destination receipt rewrote control-ledger uncertainty',
    );
    assert.deepEqual(
      readPayloadStorageSnapshot(payloadPath, beforeLateReceiptRun),
      beforeLateReceiptPayload,
      'late destination receipt changed execution payload storage',
    );
    const destinationsAfterLateReceipt =
      await readManagedEffectBatchDestinations(fixture, options.appId, batch);
    assert.ok(destinationsAfterLateReceipt[lateReceiptEffectId].receipt);
    assert.ok(destinationsAfterLateReceipt[lateReceiptEffectId].business);
    assert.equal(
      destinationsAfterLateReceipt[lateReceiptEffectId].resolution,
      null,
    );
    for (const effect of batch.effects.slice(1)) {
      assert.deepEqual(
        destinationsAfterLateReceipt[effect.effectId],
        seededDestinations[effect.effectId],
      );
    }

    const lateReconciliationId = 'sea-late-receipt-reconciliation';
    const latePrivateReason = `sea-private-late-receipt-${randomUUID()}`;
    const lateArgs = [
      'wharfie',
      'reconcile-effect',
      '--run-id',
      batch.runId,
      '--effect-id',
      lateReceiptEffectId,
      '--reconciliation-id',
      lateReconciliationId,
      '--confirm-runner-stopped',
      '--reason',
      latePrivateReason,
      '--json',
    ];
    const lateBefore = await fixture.readRun(batch.runId);
    assert.ok(lateBefore, 'late receipt reconciliation lost its durable run');
    const latePayloadBefore = readPayloadStorageSnapshot(
      payloadPath,
      lateBefore,
    );
    const lateDeliveriesBefore = await readManagedEffectBatchDeliveries(
      fixture,
      batch,
    );
    const lateDeliveryBefore = lateDeliveriesBefore[lateReceiptEffectId];
    assert.ok(lateDeliveryBefore, 'late receipt reconciliation lost delivery');
    const lateResponse = await runInspectorGuardedSeaJson(
      options.artifactPath,
      lateArgs,
      {
        cwd: caseRoot,
        env: environment,
        installedPackageRoot: options.installedPackageRoot,
        label: 'receipt-backed effect reconciliation',
        forbiddenTargets: [
          forbiddenActivityTarget,
          forbiddenAppCliTarget,
          forbiddenResolutionWriteTarget,
        ],
      },
    );
    const lateAfter = await fixture.readRun(batch.runId);
    assert.ok(lateAfter, 'receipt-backed reconciliation lost its run');
    const lateTargetBefore = lateBefore.effects.find(
      (effect) => effect.effectId === lateReceiptEffectId,
    );
    assert.ok(lateTargetBefore, 'late receipt target is not retained');
    const lateAuthority = assertUncertainManagedEffectReconciliationRun(
      lateBefore,
      lateAfter,
      batch,
      {
        effectId: lateReceiptEffectId,
        reconciliationId: lateReconciliationId,
        status: 'COMPLETED',
        actor: packagedActor,
        reason: latePrivateReason,
        verifier: lateTargetBefore.verifier,
      },
    );
    const latePayloadAfter = readPayloadStorageSnapshot(payloadPath, lateAfter);
    assert.equal(
      latePayloadAfter.physical.length,
      latePayloadBefore.physical.length + 1,
    );
    assert.equal(
      latePayloadAfter.reachable.length,
      latePayloadBefore.reachable.length + 1,
    );
    assert.deepEqual(latePayloadAfter.orphans, []);
    assert.deepEqual(
      latePayloadAfter.physical.filter(
        (key) => !latePayloadBefore.physical.includes(key),
      ),
      [lateAuthority.reconciliation.evidenceRef.storage.key],
    );
    const lateDestinations = await readManagedEffectBatchDestinations(
      fixture,
      options.appId,
      batch,
    );
    assert.deepEqual(lateDestinations, destinationsAfterLateReceipt);
    await assertManagedEffectReconciliationPayload(
      fixture,
      lateAuthority.effect,
      lateDestinations[lateReceiptEffectId],
      latePayloadAfter,
    );
    assertManagedEffectReconciliationView(
      lateResponse.serialized,
      batch,
      lateAfter,
      {
        effectId: lateReceiptEffectId,
        reconciliationId: lateReconciliationId,
        status: 'COMPLETED',
        changed: true,
        privateReason: latePrivateReason,
        adapter: fixture.ApplicationStateAdapterDescriptor,
        extraSecrets: [
          applicationStatePath,
          controlPath,
          lateDestinations[lateReceiptEffectId].receipt.contract_digest,
          lateDestinations[lateReceiptEffectId].receipt.receipt_digest,
          lateDestinations[lateReceiptEffectId].business.record_digest,
        ],
      },
    );
    const lateDeliveriesAfter = await readManagedEffectBatchDeliveries(
      fixture,
      batch,
    );
    const lateDeliveryAfter = lateDeliveriesAfter[lateReceiptEffectId];
    assert.ok(lateDeliveryAfter, 'late receipt reconciliation lost delivery');
    assert.deepEqual(lateDeliveryAfter.request, lateDeliveryBefore.request);
    assert.equal(lateDeliveryAfter.effect.status, 'COMPLETED');
    assert.deepEqual(lateDeliveryAfter.resultFrame.result, { inserted: true });
    assert.deepEqual(lateDeliveryAfter.outcomeRef, undefined);
    assert.deepEqual(
      JSON.parse(JSON.stringify(lateDeliveryAfter.outcome)),
      JSON.parse(
        JSON.stringify(
          await fixture.readExecutionPayload(
            lateAuthority.reconciliation.evidenceRef,
          ),
        ),
      ),
    );
    for (const effect of batch.effects.slice(1)) {
      assertManagedEffectSiblingDeliveryStable(
        lateDeliveriesBefore[effect.effectId],
        lateDeliveriesAfter[effect.effectId],
        `late receipt reconciliation rewrote sibling delivery ${effect.effectId}`,
      );
    }
    assert.equal(await lifecycle.readOwnership(), null);
    assert.equal(existsSync(markerPath), false);

    const lateReplay = await runInspectorGuardedSeaJson(
      options.artifactPath,
      lateArgs,
      {
        cwd: caseRoot,
        env: environment,
        installedPackageRoot: options.installedPackageRoot,
        label: 'receipt-backed effect reconciliation replay',
        forbiddenTargets: [
          forbiddenActivityTarget,
          forbiddenAppCliTarget,
          forbiddenResolutionWriteTarget,
        ],
      },
    );
    assertManagedEffectReconciliationView(
      lateReplay.serialized,
      batch,
      lateAfter,
      {
        effectId: lateReceiptEffectId,
        reconciliationId: lateReconciliationId,
        status: 'COMPLETED',
        changed: false,
        privateReason: latePrivateReason,
        adapter: fixture.ApplicationStateAdapterDescriptor,
        extraSecrets: [
          applicationStatePath,
          controlPath,
          lateDestinations[lateReceiptEffectId].receipt.contract_digest,
          lateDestinations[lateReceiptEffectId].receipt.receipt_digest,
          lateDestinations[lateReceiptEffectId].business.record_digest,
        ],
      },
    );
    assert.deepEqual(await fixture.readRun(batch.runId), lateAfter);
    assert.deepEqual(
      readPayloadStorageSnapshot(payloadPath, lateAfter),
      latePayloadAfter,
    );
    assert.deepEqual(
      await readManagedEffectBatchDestinations(fixture, options.appId, batch),
      lateDestinations,
    );
    assert.deepEqual(
      await readManagedEffectBatchDeliveries(fixture, batch),
      lateDeliveriesAfter,
    );

    let currentRun = lateAfter;
    let currentPayload = latePayloadAfter;
    let currentDestinations = lateDestinations;
    for (const scenario of SEA_EFFECT_RECONCILIATION_CRASH_CASES) {
      const privateReason = `sea-private-${scenario.effectId}-${randomUUID()}`;
      const reconciliationArgs = [
        'wharfie',
        'reconcile-effect',
        '--run-id',
        batch.runId,
        '--effect-id',
        scenario.effectId,
        '--reconciliation-id',
        scenario.reconciliationId,
        '--confirm-runner-stopped',
        '--reason',
        privateReason,
        '--json',
      ];
      const beforeRun = currentRun;
      const beforePayload = currentPayload;
      const beforeDestinations = currentDestinations;
      const beforeDeliveries = await readManagedEffectBatchDeliveries(
        fixture,
        batch,
      );
      const beforeTarget = beforeRun.effects.find(
        (effect) => effect.effectId === scenario.effectId,
      );
      assert.ok(beforeTarget);
      assert.equal(beforeTarget.status, 'UNCERTAIN');
      /** @type {ReturnType<typeof spawnInspectorPausedProcess> | undefined} */
      let service;
      /** @type {Record<string, any> | undefined} */
      let inspector;
      /** @type {string | undefined} */
      let staleEndpoint;
      try {
        service = spawnInspectorPausedProcess(
          options.artifactPath,
          reconciliationArgs,
          {
            cwd: caseRoot,
            env: environment,
            timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
          },
        );
        inspector = await attachSeaInspector(service, {
          timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
        });
        const resolutionWriteBreakpoint = await inspector.setSourceBreakpoint(
          'application-state-resolution-write',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_EFFECT_RESOLUTION_WRITE_BREAKPOINT,
          ),
        );
        const targetBreakpoint = await inspector.setSourceBreakpoint(
          scenario.effectId,
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            scenario.breakpoint,
          ),
        );
        const normalAdapterBreakpoint = await inspector.setSourceBreakpoint(
          'forbidden-normal-effect-adapter',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_CRASH_ADAPTER_BREAKPOINT,
          ),
        );
        const normalWriteBreakpoint = await inspector.setSourceBreakpoint(
          'forbidden-normal-application-state-write',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_CRASH_DESTINATION_WRITE_BREAKPOINT,
          ),
        );
        const activityBreakpoint = await inspector.setSourceBreakpoint(
          'forbidden-authored-activity-dispatch',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_ACTIVITY_DISPATCH_BREAKPOINT,
          ),
        );
        const appCliBreakpoint = await inspector.setSourceBreakpoint(
          'forbidden-authored-app-cli-dispatch',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_APP_CLI_DISPATCH_BREAKPOINT,
          ),
        );
        const boundaryEvidence = await resumeToSeaCrashBoundary(
          inspector,
          service,
          {
            ...scenario,
            adapterEntries: 1,
          },
          resolutionWriteBreakpoint,
          targetBreakpoint,
          markerPath,
          [
            normalAdapterBreakpoint,
            normalWriteBreakpoint,
            activityBreakpoint,
            appCliBreakpoint,
          ],
        );
        assert.deepEqual(boundaryEvidence, {
          adapterEntries: 1,
          marker: null,
        });
        assert.equal(
          service.getOutput().stdout,
          '',
          `${scenario.label} returned output before its crash boundary`,
        );
        assert.equal(existsSync(markerPath), false);

        const destinationsAtBoundary = await readManagedEffectBatchDestinations(
          fixture,
          options.appId,
          batch,
        );
        const targetDestination = destinationsAtBoundary[scenario.effectId];
        assert.equal(targetDestination.receipt, null);
        assert.equal(targetDestination.business, null);
        assert.ok(targetDestination.resolution);
        assert.deepEqual(
          {
            schemaVersion: targetDestination.resolution.schema_version,
            destinationEffectId:
              targetDestination.resolution.destination_effect_id,
            disposition: targetDestination.resolution.disposition,
            businessObservation:
              targetDestination.resolution.business_observation,
          },
          {
            schemaVersion: 2,
            destinationEffectId: beforeTarget.destinationEffectId,
            disposition: 'not-applied',
            businessObservation: { kind: 'absent' },
          },
        );
        for (const effect of batch.effects) {
          if (effect.effectId === scenario.effectId) continue;
          assert.deepEqual(
            destinationsAtBoundary[effect.effectId],
            beforeDestinations[effect.effectId],
            `${scenario.label} changed sibling destination ${effect.effectId}`,
          );
        }

        const runAtBoundary = await fixture.readRun(batch.runId);
        assert.ok(runAtBoundary, `${scenario.label} lost its durable run`);
        let authorityAtBoundary;
        if (scenario.ledgerCommittedAtBoundary) {
          authorityAtBoundary = assertUncertainManagedEffectReconciliationRun(
            beforeRun,
            runAtBoundary,
            batch,
            {
              effectId: scenario.effectId,
              reconciliationId: scenario.reconciliationId,
              status: 'NOT_APPLIED',
              actor: packagedActor,
              reason: privateReason,
              verifier:
                fixture.ApplicationStateReconciliationVerifierDescriptor,
            },
          );
        } else {
          assert.deepEqual(
            runAtBoundary,
            beforeRun,
            `${scenario.label} changed ledger truth before reconciliation`,
          );
        }
        const payloadAtBoundary = readPayloadStorageSnapshot(
          payloadPath,
          runAtBoundary,
        );
        if (scenario.ledgerCommittedAtBoundary) {
          assert.equal(
            payloadAtBoundary.physical.length,
            beforePayload.physical.length + 1,
          );
          assert.equal(
            payloadAtBoundary.reachable.length,
            beforePayload.reachable.length + 1,
          );
          assert.deepEqual(payloadAtBoundary.orphans, []);
          assert.deepEqual(
            payloadAtBoundary.physical.filter(
              (key) => !beforePayload.physical.includes(key),
            ),
            [authorityAtBoundary.reconciliation.evidenceRef.storage.key],
          );
          await assertManagedEffectReconciliationPayload(
            fixture,
            authorityAtBoundary.effect,
            targetDestination,
            payloadAtBoundary,
          );
        } else if (scenario.payloadPublishedAtBoundary) {
          const publishedKeys = payloadAtBoundary.physical.filter(
            (key) => !beforePayload.physical.includes(key),
          );
          assert.equal(
            payloadAtBoundary.physical.length,
            beforePayload.physical.length + 1,
          );
          assert.deepEqual(
            payloadAtBoundary.reachable,
            beforePayload.reachable,
          );
          assert.deepEqual(payloadAtBoundary.orphans, publishedKeys);
          assert.equal(publishedKeys.length, 1);
          assert.deepEqual(
            payloadAtBoundary.files.filter((file) =>
              publishedKeys.includes(file.key),
            ).length,
            1,
          );
        } else {
          assert.deepEqual(
            payloadAtBoundary,
            beforePayload,
            `${scenario.label} published ledger evidence before its boundary`,
          );
        }
        const deliveriesAtBoundary = await readManagedEffectBatchDeliveries(
          fixture,
          batch,
        );
        if (scenario.ledgerCommittedAtBoundary) {
          assert.equal(
            deliveriesAtBoundary[scenario.effectId].effect.status,
            'NOT_APPLIED',
          );
          assert.deepEqual(
            deliveriesAtBoundary[scenario.effectId].request,
            beforeDeliveries[scenario.effectId].request,
          );
          assert.equal(
            deliveriesAtBoundary[scenario.effectId].outcome,
            undefined,
          );
          assert.equal(
            deliveriesAtBoundary[scenario.effectId].resultFrame,
            undefined,
          );
          for (const effect of batch.effects) {
            if (effect.effectId === scenario.effectId) continue;
            assertManagedEffectSiblingDeliveryStable(
              beforeDeliveries[effect.effectId],
              deliveriesAtBoundary[effect.effectId],
              `${scenario.label} rewrote sibling delivery ${effect.effectId}`,
            );
          }
        } else {
          assert.deepEqual(deliveriesAtBoundary, beforeDeliveries);
        }

        const ownershipBeforeKill = await lifecycle.readOwnership();
        assert.ok(
          ownershipBeforeKill,
          `${scenario.label} has no mutation owner`,
        );
        assert.equal(ownershipBeforeKill.appId, options.appId);
        assert.equal(ownershipBeforeKill.ownerKind, 'manual');
        staleEndpoint = lifecycle.getSessionEndpoint(
          ownershipBeforeKill.sessionId,
          sessionPath,
        );
        staleEndpoints.add(staleEndpoint);
        assert.equal(existsSync(staleEndpoint), true);

        const killed = await signalResidentService(service, 'SIGKILL');
        assert.deepEqual(killed, { code: null, signal: 'SIGKILL' });
        inspector.close();
        inspector = undefined;
        assert.deepEqual(await lifecycle.readOwnership(), ownershipBeforeKill);
        assert.deepEqual(await fixture.readRun(batch.runId), runAtBoundary);
        assert.deepEqual(
          readPayloadStorageSnapshot(payloadPath, runAtBoundary),
          payloadAtBoundary,
        );
        assert.deepEqual(
          await readManagedEffectBatchDestinations(
            fixture,
            options.appId,
            batch,
          ),
          destinationsAtBoundary,
        );

        const replay = await runInspectorGuardedSeaJson(
          options.artifactPath,
          reconciliationArgs,
          {
            cwd: caseRoot,
            env: environment,
            installedPackageRoot: options.installedPackageRoot,
            label: `${scenario.label} restart`,
            forbiddenTargets: [
              forbiddenActivityTarget,
              forbiddenAppCliTarget,
              forbiddenResolutionWriteTarget,
            ],
          },
        );
        const runAfterReplay = await fixture.readRun(batch.runId);
        assert.ok(runAfterReplay, `${scenario.label} replay lost its run`);
        let finalAuthority;
        if (scenario.ledgerCommittedAtBoundary) {
          assert.deepEqual(
            runAfterReplay,
            runAtBoundary,
            `${scenario.label} replay duplicated ledger reconciliation`,
          );
          finalAuthority = authorityAtBoundary;
        } else {
          finalAuthority = assertUncertainManagedEffectReconciliationRun(
            beforeRun,
            runAfterReplay,
            batch,
            {
              effectId: scenario.effectId,
              reconciliationId: scenario.reconciliationId,
              status: 'NOT_APPLIED',
              actor: packagedActor,
              reason: privateReason,
              verifier:
                fixture.ApplicationStateReconciliationVerifierDescriptor,
            },
          );
        }
        const payloadAfterReplay = readPayloadStorageSnapshot(
          payloadPath,
          runAfterReplay,
        );
        if (scenario.ledgerCommittedAtBoundary) {
          assert.deepEqual(payloadAfterReplay, payloadAtBoundary);
        } else if (scenario.payloadPublishedAtBoundary) {
          assert.deepEqual(
            payloadAfterReplay.physical,
            payloadAtBoundary.physical,
          );
          assert.equal(
            payloadAfterReplay.reachable.length,
            payloadAtBoundary.reachable.length + 1,
          );
          assert.deepEqual(payloadAfterReplay.orphans, []);
          assert.deepEqual(payloadAtBoundary.orphans, [
            finalAuthority.reconciliation.evidenceRef.storage.key,
          ]);
          assert.deepEqual(payloadAfterReplay.files, payloadAtBoundary.files);
        } else {
          assert.equal(
            payloadAfterReplay.physical.length,
            payloadAtBoundary.physical.length + 1,
          );
          assert.equal(
            payloadAfterReplay.reachable.length,
            payloadAtBoundary.reachable.length + 1,
          );
          assert.deepEqual(payloadAfterReplay.orphans, []);
          assert.deepEqual(
            payloadAfterReplay.physical.filter(
              (key) => !payloadAtBoundary.physical.includes(key),
            ),
            [finalAuthority.reconciliation.evidenceRef.storage.key],
          );
        }
        const destinationsAfterReplay =
          await readManagedEffectBatchDestinations(
            fixture,
            options.appId,
            batch,
          );
        assert.deepEqual(destinationsAfterReplay, destinationsAtBoundary);
        await assertManagedEffectReconciliationPayload(
          fixture,
          finalAuthority.effect,
          destinationsAfterReplay[scenario.effectId],
          payloadAfterReplay,
        );
        assertManagedEffectReconciliationView(
          replay.serialized,
          batch,
          runAfterReplay,
          {
            effectId: scenario.effectId,
            reconciliationId: scenario.reconciliationId,
            status: 'NOT_APPLIED',
            changed: !scenario.ledgerCommittedAtBoundary,
            privateReason,
            adapter: fixture.ApplicationStateAdapterDescriptor,
            extraSecrets: [
              applicationStatePath,
              controlPath,
              destinationsAfterReplay[scenario.effectId].resolution
                .contract_digest,
              destinationsAfterReplay[scenario.effectId].resolution
                .resolution_digest,
            ],
          },
        );
        const deliveriesAfterReplay = await readManagedEffectBatchDeliveries(
          fixture,
          batch,
        );
        assert.deepEqual(
          deliveriesAfterReplay[scenario.effectId].request,
          beforeDeliveries[scenario.effectId].request,
        );
        assert.equal(
          deliveriesAfterReplay[scenario.effectId].effect.status,
          'NOT_APPLIED',
        );
        assert.equal(
          deliveriesAfterReplay[scenario.effectId].outcome,
          undefined,
        );
        assert.equal(
          deliveriesAfterReplay[scenario.effectId].resultFrame,
          undefined,
        );
        for (const effect of batch.effects) {
          if (effect.effectId === scenario.effectId) continue;
          assertManagedEffectSiblingDeliveryStable(
            beforeDeliveries[effect.effectId],
            deliveriesAfterReplay[effect.effectId],
            `${scenario.label} replay rewrote sibling delivery ${effect.effectId}`,
          );
        }
        assert.equal(await lifecycle.readOwnership(), null);
        assert.equal(existsSync(staleEndpoint), true);
        assert.equal(existsSync(markerPath), false);

        if (!scenario.ledgerCommittedAtBoundary) {
          const idempotentReplay = await runInspectorGuardedSeaJson(
            options.artifactPath,
            reconciliationArgs,
            {
              cwd: caseRoot,
              env: environment,
              installedPackageRoot: options.installedPackageRoot,
              label: `${scenario.label} idempotent replay`,
              forbiddenTargets: [
                forbiddenActivityTarget,
                forbiddenAppCliTarget,
                forbiddenResolutionWriteTarget,
              ],
            },
          );
          assertManagedEffectReconciliationView(
            idempotentReplay.serialized,
            batch,
            runAfterReplay,
            {
              effectId: scenario.effectId,
              reconciliationId: scenario.reconciliationId,
              status: 'NOT_APPLIED',
              changed: false,
              privateReason,
              adapter: fixture.ApplicationStateAdapterDescriptor,
              extraSecrets: [
                applicationStatePath,
                controlPath,
                destinationsAfterReplay[scenario.effectId].resolution
                  .contract_digest,
                destinationsAfterReplay[scenario.effectId].resolution
                  .resolution_digest,
              ],
            },
          );
          assert.deepEqual(await fixture.readRun(batch.runId), runAfterReplay);
          assert.deepEqual(
            readPayloadStorageSnapshot(payloadPath, runAfterReplay),
            payloadAfterReplay,
          );
          assert.deepEqual(
            await readManagedEffectBatchDestinations(
              fixture,
              options.appId,
              batch,
            ),
            destinationsAfterReplay,
          );
          assert.deepEqual(
            await readManagedEffectBatchDeliveries(fixture, batch),
            deliveriesAfterReplay,
          );
        }

        currentRun = runAfterReplay;
        currentPayload = payloadAfterReplay;
        currentDestinations = destinationsAfterReplay;
      } finally {
        inspector?.close();
        await stopResidentServiceForCleanup(service);
      }
    }

    assert.deepEqual(
      currentRun.effects.map((effect) => ({
        effectId: effect.effectId,
        status: effect.status,
      })),
      [
        { effectId: '01-late-receipt', status: 'COMPLETED' },
        { effectId: '02-resolution-before-ledger', status: 'NOT_APPLIED' },
        { effectId: '03-payload-before-ledger', status: 'NOT_APPLIED' },
        { effectId: '04-ledger-before-response', status: 'NOT_APPLIED' },
      ],
    );
    assert.equal(currentRun.run.status, 'BLOCKED');
    assert.equal(currentRun.invocations[0].status, 'UNCERTAIN');
    assert.deepEqual(currentRun.attempts[0], stoppedRun.attempts[0]);
    assert.deepEqual(
      currentRun.events.slice(-4).map((event) => event.type),
      Array.from({ length: 4 }, () => 'uncertain-effect-reconciled'),
    );
    assert.ok(currentDestinations['01-late-receipt'].receipt);
    assert.ok(currentDestinations['01-late-receipt'].business);
    assert.equal(currentDestinations['01-late-receipt'].resolution, null);
    for (const effectId of [
      '02-resolution-before-ledger',
      '03-payload-before-ledger',
      '04-ledger-before-response',
    ]) {
      assert.equal(currentDestinations[effectId].receipt, null);
      assert.equal(currentDestinations[effectId].business, null);
      assert.equal(
        currentDestinations[effectId].resolution.disposition,
        'not-applied',
      );
      assert.deepEqual(
        currentDestinations[effectId].resolution.business_observation,
        { kind: 'absent' },
      );
    }
    assert.deepEqual(currentPayload.orphans, []);
    assert.equal(existsSync(markerPath), false);
    assert.equal(await lifecycle.readOwnership(), null);
  } finally {
    for (const endpoint of staleEndpoints) rmSync(endpoint, { force: true });
    rmSync(caseRoot, { recursive: true, force: true });
  }
}

/**
 * Reproduce the stable schema-v7 projection used by the packaged operator so
 * successor responses can be compared as complete JSON values, not partial
 * shapes.
 * @param {Record<string, any>} raw - Verified rebuilt ledger run.
 * @param {string} [kind] - Public response kind.
 * @returns {Record<string, any>} - Exact redacted operator run view.
 */
function createExpectedSeaOperatorRunView(
  raw,
  kind = 'wharfie.execution-ledger.run',
) {
  return {
    schemaVersion: 7,
    kind,
    integrity: { verified: true },
    run: {
      runId: raw.run.runId,
      appId: raw.run.appId,
      revisionId: raw.run.revisionId,
      trigger:
        raw.run.trigger.kind === 'workflow'
          ? {
              kind: raw.run.trigger.kind,
              workflowId: raw.run.trigger.workflowId,
              planId: raw.run.trigger.planId,
            }
          : { kind: raw.run.trigger.kind },
      status: raw.run.status,
      version: raw.run.version,
      lastSequence: raw.run.lastSequence,
      createdAt: raw.run.createdAt,
      updatedAt: raw.run.updatedAt,
      ...(raw.run.cancellationRequest
        ? {
            cancellationRequest: {
              requestId: raw.run.cancellationRequest.requestId,
              requestedAt: raw.run.cancellationRequest.requestedAt,
            },
          }
        : {}),
    },
    invocations: raw.invocations.map((invocation) => ({
      invocationId: invocation.invocationId,
      activityId: invocation.activityId,
      status: invocation.status,
      generation: invocation.generation,
      version: invocation.version,
      lastSequence: invocation.lastSequence,
      createdAt: invocation.createdAt,
      updatedAt: invocation.updatedAt,
      ...(invocation.workflow
        ? {
            workflow: {
              workflowId: invocation.workflow.workflowId,
              planId: invocation.workflow.planId,
              continuationId: invocation.workflow.continuationId,
              stepId: invocation.workflow.stepId,
              stepIndex: invocation.workflow.stepIndex,
            },
          }
        : {}),
    })),
    attempts: raw.attempts.map((attempt) => ({
      invocationId: attempt.invocationId,
      attemptId: attempt.attemptId,
      status: attempt.status,
      generation: attempt.generation,
      version: attempt.version,
      claimedAt: attempt.claimedAt,
      ...(attempt.startedAt === undefined
        ? {}
        : { startedAt: attempt.startedAt }),
      updatedAt: attempt.updatedAt,
      lastSequence: attempt.lastSequence,
    })),
    effects: raw.effects.map((effect) => ({
      invocationId: effect.invocationId,
      effectId: effect.effectId,
      status: effect.status,
      adapter: {
        id: effect.adapter.id,
        version: effect.adapter.version,
      },
      version: effect.version,
      lastSequence: effect.lastSequence,
      createdAt: effect.createdAt,
      updatedAt: effect.updatedAt,
    })),
    timers: (raw.timers || []).map((timer) => ({
      timerId: timer.timerId,
      workflowId: timer.workflowId,
      planId: timer.planId,
      continuationId: timer.continuationId,
      stepId: timer.stepId,
      stepIndex: timer.stepIndex,
      status: timer.status,
      scheduledAt: timer.scheduledAt,
      dueAt: timer.dueAt,
      ...(timer.firedAt === undefined ? {} : { firedAt: timer.firedAt }),
      version: timer.version,
      lastSequence: timer.lastSequence,
      createdAt: timer.createdAt,
      updatedAt: timer.updatedAt,
      ...(timer.cancellationRequest
        ? {
            cancellationRequest: {
              requestId: timer.cancellationRequest.requestId,
              requestedAt: timer.cancellationRequest.requestedAt,
            },
          }
        : {}),
    })),
    signalWaits: (raw.signalWaits || []).map((wait) => ({
      signalWaitId: wait.signalWaitId,
      workflowId: wait.workflowId,
      planId: wait.planId,
      continuationId: wait.continuationId,
      stepId: wait.stepId,
      stepIndex: wait.stepIndex,
      signalId: wait.signalId,
      status: wait.status,
      ...(wait.deliveryId === undefined ? {} : { deliveryId: wait.deliveryId }),
      ...(wait.acceptedAt === undefined ? {} : { acceptedAt: wait.acceptedAt }),
      version: wait.version,
      lastSequence: wait.lastSequence,
      createdAt: wait.createdAt,
      updatedAt: wait.updatedAt,
      ...(wait.cancellationRequest
        ? {
            cancellationRequest: {
              requestId: wait.cancellationRequest.requestId,
              requestedAt: wait.cancellationRequest.requestedAt,
            },
          }
        : {}),
    })),
    signalDeliveries: (raw.signalDeliveries || []).map((delivery) => ({
      deliveryId: delivery.deliveryId,
      signalId: delivery.signalId,
      status: delivery.status,
      ...(delivery.rejectionReason === undefined
        ? {}
        : { rejectionReason: delivery.rejectionReason }),
      ...(delivery.signalWaitId === undefined
        ? {}
        : { signalWaitId: delivery.signalWaitId }),
      version: delivery.version,
      lastSequence: delivery.lastSequence,
      observedAt: delivery.observedAt,
    })),
    history: raw.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
    })),
    ...(raw.workflowCursor
      ? {
          workflowCursor: {
            runId: raw.workflowCursor.runId,
            appId: raw.workflowCursor.appId,
            revisionId: raw.workflowCursor.revisionId,
            workflowId: raw.workflowCursor.workflowId,
            planId: raw.workflowCursor.planId,
            stepId: raw.workflowCursor.stepId,
            stepIndex: raw.workflowCursor.stepIndex,
            continuationId: raw.workflowCursor.continuationId,
            ...(Object.prototype.hasOwnProperty.call(
              raw.workflowCursor,
              'invocationId',
            )
              ? { invocationId: raw.workflowCursor.invocationId }
              : Object.prototype.hasOwnProperty.call(
                    raw.workflowCursor,
                    'timerId',
                  )
                ? { timerId: raw.workflowCursor.timerId }
                : { signalWaitId: raw.workflowCursor.signalWaitId }),
            disposition: raw.workflowCursor.disposition,
            outputs: raw.workflowCursor.outputs.map((output) => ({
              stepId: output.stepId,
              stepIndex: output.stepIndex,
            })),
            version: raw.workflowCursor.version,
            lastSequence: raw.workflowCursor.lastSequence,
            createdAt: raw.workflowCursor.createdAt,
            updatedAt: raw.workflowCursor.updatedAt,
          },
        }
      : {}),
  };
}

/**
 * Assert a complete causal retry response and both independently redacted run
 * projections.
 * @param {string} serialized - Exact one-line SEA JSON response.
 * @param {Record<string, any>} source - Verified source aggregate.
 * @param {Record<string, any>} target - Verified target aggregate.
 * @param {{successorId: string, sourceEffectId: string, targetEffectId: string, authorizationApplied: boolean, disposition: string, secrets: string[], label: string}} expected - Safe response truth and private values.
 * @returns {Record<string, any>} - Parsed response.
 */
function assertSeaSuccessorOperatorView(serialized, source, target, expected) {
  const value = JSON.parse(serialized);
  assert.deepEqual(value, {
    schemaVersion: 7,
    kind: 'wharfie.execution-ledger.effect-successor',
    integrity: { verified: true },
    effectSuccessor: {
      successorId: expected.successorId,
      intent: 'retry',
      authorizationApplied: expected.authorizationApplied,
      source: {
        runId: source.run.runId,
        effectId: expected.sourceEffectId,
        status: source.run.status,
      },
      target: {
        runId: target.run.runId,
        effectId: expected.targetEffectId,
        status: target.run.status,
        disposition: expected.disposition,
      },
    },
    source: createExpectedSeaOperatorRunView(source),
    target: createExpectedSeaOperatorRunView(target),
  });
  for (const secret of [
    ...expected.secrets,
    'destinationEffectId',
    'requestDigest',
    'fencingToken',
    'coordinatorEpoch',
    'outcomeRef',
    'evidenceRef',
    'businessObservation',
    'contractDigest',
    'receiptDigest',
    '"planRef"',
    '"requestRef"',
    '"startRef"',
    '"payload"',
  ]) {
    assert.equal(
      serialized.includes(secret),
      false,
      `${expected.label} successor response disclosed ${secret}`,
    );
  }
  return value;
}

/**
 * Find one exact source-side successor authorization.
 * @param {Record<string, any>} source - Verified source aggregate.
 * @param {string} successorId - Stable public identity.
 * @param {number} expectedCount - Required matching event count.
 * @returns {Record<string, any> | null} - Retained authorization.
 */
function findSeaSuccessorAuthorization(source, successorId, expectedCount) {
  const events = source.events.filter(
    (event) =>
      event.type === 'effect-successor-authorized' &&
      event.payload?.authorization?.successorId === successorId,
  );
  assert.equal(events.length, expectedCount);
  return events[0]?.payload?.authorization || null;
}

/**
 * Derive the only target identity and authorization an exact retained source
 * can publish. This deliberately uses the installed package's derivation so a
 * crash before the cross-run transaction can prove every target-side record is
 * absent rather than merely waiting for a source event to reveal its ID.
 * @param {{createManagedEffectSuccessorAuthorization: (options: Record<string, any>) => Record<string, any>}} fixture - Installed successor-contract helper.
 * @param {Record<string, any>} source - Verified source aggregate after reconciliation.
 * @param {Record<string, any>} sourceRequest - Exact logical source request.
 * @param {{successorId: string, reason: string}} expected - Operator retry input.
 * @returns {Record<string, any>} - Deterministically derived authorization.
 */
function createExpectedSeaSuccessorAuthorization(
  fixture,
  source,
  sourceRequest,
  expected,
) {
  const sourceEffect = source.effects.find(
    (effect) => effect.effectId === SEA_SUCCESSOR_SOURCE_EFFECT_ID,
  );
  assert.ok(sourceEffect?.reconciliation);
  const sourceAttempt = source.attempts.find(
    (attempt) => attempt.attemptId === sourceEffect.requestedBy.attemptId,
  );
  assert.ok(sourceAttempt);
  const reconciliationEvents = source.events.filter(
    (event) =>
      event.type === 'uncertain-effect-reconciled' &&
      event.payload?.effect?.effectId === sourceEffect.effectId &&
      event.payload?.reconciliation?.reconciliationId ===
        sourceEffect.reconciliation.reconciliationId,
  );
  assert.equal(reconciliationEvents.length, 1);
  const reconciliationEvent = reconciliationEvents[0];
  return fixture.createManagedEffectSuccessorAuthorization({
    appId: source.run.appId,
    revisionId: source.run.revisionId,
    successorId: expected.successorId,
    reason: {
      kind: 'operator-managed-effect-successor-retry',
      successorId: expected.successorId,
      message: expected.reason,
    },
    source: {
      runId: source.run.runId,
      invocationId: sourceEffect.invocationId,
      attemptId: sourceAttempt.attemptId,
      effectId: sourceEffect.effectId,
      uncertaintyEventId: sourceEffect.reconciliation.uncertaintyEventId,
      uncertaintySequence: sourceEffect.reconciliation.uncertaintySequence,
      reconciliationEventId: reconciliationEvent.event_id,
      reconciliationSequence: reconciliationEvent.sequence,
      reconciliationId: sourceEffect.reconciliation.reconciliationId,
      disposition: 'NOT_APPLIED',
    },
    contract: {
      adapter: sourceEffect.adapter,
      destination: sourceEffect.destination,
      verifier: sourceEffect.verifier,
      substantiatedReplayProperties: sourceEffect.substantiatedReplayProperties,
    },
    request: sourceRequest,
  });
}

/**
 * Prove authorization advances only the source aggregate envelope while its
 * abandoned attempt and permanently decided effect remain byte-identical.
 * @param {Record<string, any>} before - Source before authorization.
 * @param {Record<string, any>} after - Source after authorization.
 * @param {{successorId: string, sourceEffectId: string, actor: Record<string, any>, reason: string, revisionId: string}} expected - Exact causal authority.
 * @returns {Record<string, any>} - Verified immutable authorization.
 */
function assertSeaSuccessorSourceAuthorization(before, after, expected) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.equal(before.run.status, 'BLOCKED');
  assert.equal(after.run.status, 'BLOCKED');
  assert.equal(before.invocations[0].status, 'UNCERTAIN');
  assert.equal(after.invocations[0].status, 'UNCERTAIN');
  assert.deepEqual(after.attempts, before.attempts);
  assert.deepEqual(after.effects, before.effects);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.equal(after.events.length, before.events.length + 1);
  const event = after.events.at(-1);
  assert.equal(event.type, 'effect-successor-authorized');
  assert.deepEqual(event.actor, expected.actor);
  assert.equal(event.sequence, before.head.sequence + 1);
  assert.deepEqual(after.head, {
    ...before.head,
    version: before.head.version + 1,
    sequence: event.sequence,
  });
  assert.deepEqual(after.run, {
    ...before.run,
    version: before.run.version + 1,
    lastSequence: event.sequence,
    updatedAt: event.observed_at,
  });
  assert.deepEqual(after.invocations[0], {
    ...before.invocations[0],
    version: before.invocations[0].version + 1,
    lastSequence: event.sequence,
    updatedAt: event.observed_at,
  });
  const authorization = event.payload.authorization;
  assert.deepEqual(Object.keys(authorization).sort(), [
    'contract',
    'intent',
    'kind',
    'policy',
    'reason',
    'slotId',
    'source',
    'successorId',
    'target',
  ]);
  assert.equal(authorization.kind, 'effect-successor');
  assert.equal(authorization.intent, 'retry');
  assert.equal(authorization.successorId, expected.successorId);
  assert.deepEqual(authorization.policy, {
    kind: 'application-state-put-if-absent-not-applied-retry',
    version: 1,
  });
  assert.deepEqual(authorization.reason, {
    kind: 'operator-managed-effect-successor-retry',
    successorId: expected.successorId,
    message: expected.reason,
  });
  const sourceEffect = before.effects.find(
    (effect) => effect.effectId === expected.sourceEffectId,
  );
  assert.ok(sourceEffect?.reconciliation);
  assert.deepEqual(authorization.source, {
    runId: before.run.runId,
    invocationId: sourceEffect.invocationId,
    attemptId: before.attempts[0].attemptId,
    effectId: sourceEffect.effectId,
    uncertaintyEventId: sourceEffect.reconciliation.uncertaintyEventId,
    uncertaintySequence: sourceEffect.reconciliation.uncertaintySequence,
    reconciliationEventId: before.events.at(-1).event_id,
    reconciliationSequence: before.events.at(-1).sequence,
    reconciliationId: sourceEffect.reconciliation.reconciliationId,
    disposition: 'NOT_APPLIED',
  });
  assert.deepEqual(authorization.contract, {
    adapter: sourceEffect.adapter,
    destination: sourceEffect.destination,
    verifier: sourceEffect.verifier,
    substantiatedReplayProperties: sourceEffect.substantiatedReplayProperties,
  });
  assert.equal(authorization.target.revisionId, expected.revisionId);
  assert.notEqual(authorization.target.runId, before.run.runId);
  assert.notEqual(authorization.target.invocationId, sourceEffect.invocationId);
  assert.notEqual(authorization.target.effectId, sourceEffect.effectId);
  assert.notEqual(
    authorization.target.destinationEffectId,
    sourceEffect.destinationEffectId,
  );
  assert.deepEqual(event.payload, {
    run: after.run,
    invocation: after.invocations[0],
    authorization,
  });
  return authorization;
}

/**
 * Assert the exact finite target state retained at one successor boundary.
 * @param {Record<string, any>} target - Verified target aggregate.
 * @param {Record<string, any>} authorization - Immutable target trigger.
 * @param {{run: string, invocation: string, attempt: string | null, effect: string | null, events: string[]}} expected - Required lifecycle state.
 * @param {Record<string, any>} actor - Packaged operator authority.
 * @param {string} label - Assertion context.
 * @returns {void}
 */
function assertSeaSuccessorTargetState(
  target,
  authorization,
  expected,
  actor,
  label,
) {
  assert.equal(target.run.runId, authorization.target.runId);
  assert.deepEqual(target.run.trigger, authorization);
  assert.equal(target.run.status, expected.run);
  assert.equal(target.invocations.length, 1);
  assert.equal(
    target.invocations[0].invocationId,
    authorization.target.invocationId,
  );
  assert.equal(target.invocations[0].activityId, 'wharfie-effect-successor');
  assert.equal(target.invocations[0].status, expected.invocation);
  assert.equal(target.attempts.length, expected.attempt === null ? 0 : 1);
  assert.equal(target.attempts[0]?.status || null, expected.attempt);
  assert.equal(target.effects.length, expected.effect === null ? 0 : 1);
  assert.equal(target.effects[0]?.status || null, expected.effect);
  if (target.effects[0]) {
    assert.equal(target.effects[0].effectId, authorization.target.effectId);
    assert.equal(
      target.effects[0].destinationEffectId,
      authorization.target.destinationEffectId,
    );
  }
  assert.deepEqual(
    target.events.map((event) => event.type),
    expected.events,
    `${label} retained the wrong successor event vocabulary`,
  );
  assert.deepEqual(
    target.events.map((event) => event.actor),
    Array.from({ length: expected.events.length }, () => actor),
  );
}

/**
 * Assert that a target copies only the verified logical request into fresh,
 * target-owned durable authority. The source's old physical attempt must never
 * become the new run's fence, request envelope, or effect identity.
 * @param {{readExecutionPayload: (reference: Record<string, any>) => Promise<any>}} fixture - Installed payload reader.
 * @param {Record<string, any>} source - Verified source aggregate.
 * @param {Record<string, any>} target - Verified successor target aggregate.
 * @param {Record<string, any>} authorization - Immutable target trigger.
 * @param {Record<string, any>} sourceRequest - Exact logical source request.
 * @param {string} label - Assertion context.
 * @returns {Promise<void>} - Resolves after every retained authority verifies.
 */
async function assertSeaSuccessorTargetAuthority(
  fixture,
  source,
  target,
  authorization,
  sourceRequest,
  label,
) {
  const [invocation] = target.invocations;
  assert.ok(invocation, `${label} has no successor invocation`);
  assert.deepEqual(target.run.requestRef, invocation.requestRef);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(await fixture.readExecutionPayload(target.run.requestRef)),
    ),
    JSON.parse(
      JSON.stringify({
        input: {
          effectRequest: {
            effectId: authorization.target.effectId,
            ...sourceRequest,
          },
        },
        callerMetadata: {},
      }),
    ),
  );
  const [effect] = target.effects;
  if (!effect) return;
  const attempt = target.attempts.find(
    (candidate) => candidate.attemptId === effect.requestedBy.attemptId,
  );
  assert.ok(attempt, `${label} effect has no matching target attempt`);
  const sourceAttempt = source.attempts.find(
    (candidate) => candidate.attemptId === authorization.source.attemptId,
  );
  assert.ok(sourceAttempt, `${label} source attempt disappeared`);
  assert.deepEqual(effect.adapter, authorization.contract.adapter);
  assert.deepEqual(effect.destination, authorization.contract.destination);
  assert.deepEqual(effect.verifier, authorization.contract.verifier);
  assert.deepEqual(
    effect.requestedReplayProperties,
    sourceRequest.requestedReplayProperties,
  );
  assert.deepEqual(
    effect.substantiatedReplayProperties,
    authorization.contract.substantiatedReplayProperties,
  );
  assert.deepEqual(
    await fixture.readExecutionPayload(effect.requestRef),
    sourceRequest,
  );
  assert.notEqual(attempt.attemptId, sourceAttempt.attemptId);
  assert.equal(attempt.generation, 1);
  assert.equal(invocation.generation, 1);
  assert.equal(attempt.coordinatorEpoch, 0);
  assert.notEqual(attempt.fencingToken, sourceAttempt.fencingToken);
  assert.deepEqual(effect.requestedBy, {
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    coordinatorEpoch: attempt.coordinatorEpoch,
    fencingToken: attempt.fencingToken,
    protocolSequence: 1,
  });
  assert.deepEqual(effect.startedBy, {
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    coordinatorEpoch: attempt.coordinatorEpoch,
    fencingToken: attempt.fencingToken,
  });
}

/**
 * Read one immutable payload and bind its reference to the physical local
 * content-addressed file rather than trusting a projection alone.
 * @param {{payloadStoreId: string, readExecutionPayload: (reference: Record<string, any>) => Promise<any>}} fixture - Installed payload reader.
 * @param {Record<string, any>} reference - Retained immutable reference.
 * @param {{files: {key: string, size: number, sha256: string}[]}} payloadStorage - Physical payload snapshot.
 * @param {string} payloadSchema - Exact semantic payload schema.
 * @param {string} label - Assertion context.
 * @returns {Promise<any>} - Exact referenced JSON payload.
 */
async function readSeaPhysicalPayload(
  fixture,
  reference,
  payloadStorage,
  payloadSchema,
  label,
) {
  const file = payloadStorage.files.find(
    (candidate) => candidate.key === reference.storage.key,
  );
  assert.ok(file, `${label} payload is not physical`);
  assert.equal(reference.schemaVersion, 1);
  assert.equal(reference.kind, 'executionPayloadReference');
  assert.equal(reference.mediaType, 'application/json');
  assert.equal(reference.payloadSchema, payloadSchema);
  assert.deepEqual(reference.storage, {
    kind: 'wharfie.local-content-addressed.v1',
    storeId: fixture.payloadStoreId,
    key: file.key,
  });
  assert.equal(reference.size, file.size);
  assert.deepEqual(reference.digest, {
    algorithm: 'sha256',
    value: Buffer.from(file.sha256, 'hex').toString('base64url'),
  });
  return JSON.parse(
    JSON.stringify(await fixture.readExecutionPayload(reference)),
  );
}

/**
 * Bind the direct terminal outcome and complete target-owned transcript to
 * the actual destination receipt. Reconciled terminal outcomes intentionally
 * use their separate reconciliation-evidence assertion instead.
 * @param {{payloadStoreId: string, readExecutionPayload: (reference: Record<string, any>) => Promise<any>}} fixture - Installed payload reader.
 * @param {Record<string, any>} target - Verified terminal successor target.
 * @param {Record<string, any>} authorization - Immutable target trigger.
 * @param {Record<string, any>} sourceRequest - Exact logical source request.
 * @param {{receipt: Record<string, any> | null}} destination - Physical destination truth.
 * @param {{files: {key: string, size: number, sha256: string}[]}} payloadStorage - Physical payload snapshot.
 * @param {string} label - Assertion context.
 * @returns {Promise<void>} - Resolves after terminal evidence verifies.
 */
async function assertSeaSuccessorTerminalOutcomeEvidence(
  fixture,
  target,
  authorization,
  sourceRequest,
  destination,
  payloadStorage,
  label,
) {
  if (
    !target.events.some((event) => event.type === 'effect-successor-terminal')
  ) {
    return;
  }
  assert.ok(destination.receipt, `${label} direct terminal has no receipt`);
  const [invocation] = target.invocations;
  const [attempt] = target.attempts;
  const [effect] = target.effects;
  assert.ok(invocation);
  assert.ok(attempt);
  assert.ok(effect);
  assert.equal(invocation.status, 'COMPLETED');
  assert.equal(attempt.status, 'COMPLETED');
  assert.equal(effect.status, 'COMPLETED');
  assert.ok(effect.outcomeRef, `${label} terminal has no outcome reference`);
  assert.ok(attempt.evidenceRef, `${label} terminal has no evidence reference`);
  const normalizedSourceRequest = JSON.parse(JSON.stringify(sourceRequest));
  const expectedOutcome = JSON.parse(
    JSON.stringify({
      destinationEffectId: authorization.target.destinationEffectId,
      adapter: authorization.contract.adapter,
      destination: authorization.contract.destination,
      verifier: authorization.contract.verifier,
      ok: true,
      result: { inserted: destination.receipt.inserted },
      substantiatedReplayProperties:
        authorization.contract.substantiatedReplayProperties,
      evidence: {
        kind: 'application-state-put-if-absent-receipt',
        version: 2,
        destinationEffectId: destination.receipt.destination_effect_id,
        contractDigest: destination.receipt.contract_digest,
        receiptDigest: destination.receipt.receipt_digest,
        businessRecordDigest: destination.receipt.business_record_digest,
        disposition: destination.receipt.outcome_code,
      },
    }),
  );
  const outcome = await readSeaPhysicalPayload(
    fixture,
    effect.outcomeRef,
    payloadStorage,
    'wharfie.execution.managed-effect-outcome.v2',
    `${label} outcome`,
  );
  assert.deepEqual(outcome, expectedOutcome);
  const evidence = await readSeaPhysicalPayload(
    fixture,
    attempt.evidenceRef,
    payloadStorage,
    'wharfie.execution.activity-evidence.v1',
    `${label} evidence`,
  );
  const expectedStart = {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'start',
    revisionId: authorization.target.revisionId,
    activityId: 'wharfie-effect-successor',
    runId: authorization.target.runId,
    invocationId: authorization.target.invocationId,
    attemptId: attempt.attemptId,
    fencingToken: attempt.fencingToken,
    input: {
      effectRequest: {
        effectId: authorization.target.effectId,
        ...normalizedSourceRequest,
      },
    },
    caller: { metadata: {} },
  };
  const expectedRequestFrame = {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId: attempt.attemptId,
    sequence: 1,
    effectId: authorization.target.effectId,
    ...normalizedSourceRequest,
  };
  const expectedResultFrame = {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-result',
    attemptId: attempt.attemptId,
    effectId: authorization.target.effectId,
    ok: true,
    result: expectedOutcome.result,
    substantiatedReplayProperties:
      authorization.contract.substantiatedReplayProperties,
    evidence: expectedOutcome.evidence,
  };
  const expectedTerminal = {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: attempt.attemptId,
    sequence: 2,
    result: expectedOutcome.result,
  };
  assert.equal(evidence.status, 'completed');
  assert.deepEqual(evidence.start, expectedStart);
  assert.deepEqual(evidence.frames, [
    expectedStart,
    expectedRequestFrame,
    expectedResultFrame,
    expectedTerminal,
  ]);
  assert.deepEqual(evidence.terminal, expectedTerminal);
  assert.deepEqual(invocation.terminal, {
    type: 'completed',
    attemptId: attempt.attemptId,
  });
}

/**
 * Assert destination truth for the successor's fresh physical identity.
 * @param {{receipt: Record<string, any> | null, resolution: Record<string, any> | null, business: Record<string, any> | null}} destination - Physical application-state truth.
 * @param {Record<string, any>} authorization - Immutable target identity.
 * @param {Record<string, any>} sourceRequest - Exact logical source request.
 * @param {string} appId - Application namespace.
 * @param {true | false | 'not-applied'} expectedOutcome - Expected destination state.
 * @param {{destinationEffectId: string, value: Record<string, any>} | null} [preexistingBusiness] - Independent writer that owns an already-present value.
 * @returns {void}
 */
function assertSeaSuccessorDestination(
  destination,
  authorization,
  sourceRequest,
  appId,
  expectedOutcome,
  preexistingBusiness = null,
) {
  if (expectedOutcome === false) {
    assert.deepEqual(destination, {
      receipt: null,
      resolution: null,
      business: null,
    });
    return;
  }
  if (expectedOutcome === 'not-applied') {
    assert.equal(destination.receipt, null);
    assert.equal(destination.business, null);
    assert.ok(destination.resolution);
    assert.equal(
      destination.resolution.destination_effect_id,
      authorization.target.destinationEffectId,
    );
    assert.equal(destination.resolution.operation, 'put-if-absent');
    assert.equal(destination.resolution.disposition, 'not-applied');
    assert.deepEqual(destination.resolution.business_observation, {
      kind: 'absent',
    });
    return;
  }
  const inserted = preexistingBusiness === null;
  assert.ok(destination.receipt);
  assert.ok(destination.business);
  assert.equal(destination.resolution, null);
  assert.deepEqual(
    {
      destinationEffectId: destination.receipt.destination_effect_id,
      outcomeCode: destination.receipt.outcome_code,
      inserted: destination.receipt.inserted,
      namespace: destination.business.namespace,
      logicalKey: destination.business.logical_key,
      createdBy: destination.business.created_by_destination_effect_id,
    },
    {
      destinationEffectId: authorization.target.destinationEffectId,
      outcomeCode: inserted ? 'inserted' : 'already-present',
      inserted,
      namespace: appId,
      logicalKey: sourceRequest.input.key,
      createdBy: inserted
        ? authorization.target.destinationEffectId
        : preexistingBusiness.destinationEffectId,
    },
  );
  assert.deepEqual(
    destination.business.value,
    inserted
      ? JSON.parse(JSON.stringify(sourceRequest.input.value))
      : preexistingBusiness.value,
  );
  if (inserted) {
    assert.equal(
      destination.business.contract_digest,
      destination.receipt.contract_digest,
    );
  } else {
    assert.notEqual(
      destination.business.contract_digest,
      destination.receipt.contract_digest,
    );
  }
  assert.equal(
    destination.business.record_digest,
    destination.receipt.business_record_digest,
  );
}

/**
 * Prove the public packaged successor command preserves its dedicated
 * lifecycle across every durable publication and transaction boundary. Every
 * execution is the relocated SEA with Node absent from PATH; host-side imports
 * only seed and independently read durable truth.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string}} options - Matrix inputs.
 * @returns {Promise<void>} - Resolves after all six crash/recovery cases pass.
 */
async function verifyRelocatedSeaManagedEffectSuccessorCrashMatrix(options) {
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  try {
    for (const [
      scenarioIndex,
      scenario,
    ] of SEA_SUCCESSOR_CRASH_CASES.entries()) {
      const caseId = `case-${scenarioIndex + 1}`;
      const caseRoot = path.join(options.root, scenario.boundary);
      const controlPath = path.join(caseRoot, 'control');
      const payloadPath = path.join(controlPath, 'execution-payloads');
      const sessionPath = path.join(caseRoot, 'sessions');
      const applicationStatePath = path.join(caseRoot, 'application-state');
      const markerPath = path.join(
        caseRoot,
        'authored-activity-must-not-run.json',
      );
      const tableName = `wharfie-package-sea-${scenario.boundary}`;
      const packagedActor = {
        kind: 'packaged-operator',
        id: options.revisionId,
      };
      const successorId = `sea-${caseId}`;
      const sourceReconciliationId = `source-${caseId}`;
      const targetReconciliationId = `target-${caseId}`;
      const sourceReason = `sea-private-source-${randomUUID()}`;
      const retryReason = `sea-private-successor-${randomUUID()}`;
      const targetReason = `sea-private-target-${randomUUID()}`;
      const staleEndpoints = new Set();
      mkdirSync(caseRoot, { recursive: true, mode: 0o700 });
      const environment = {
        ...options.cleanEnvironment,
        WHARFIE_CONTROL_ADAPTER: 'lmdb',
        WHARFIE_CONTROL_PATH: controlPath,
        WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
        WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
        WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
        WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
        WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
      };
      const fixture = await createInstalledExecutionLedgerFixture({
        installedPackageRoot: options.installedPackageRoot,
        controlPath,
        tableName,
        payloadPath,
        applicationStatePath,
        revisionId: options.revisionId,
      });
      const lifecycle = await createInstalledLedgerLifecycleObserver({
        installedPackageRoot: options.installedPackageRoot,
        controlPath,
        tableName,
        appId: options.appId,
      });
      // The packaged operator is source-free, so setup, execution, recovery,
      // and reconciliation must never enter authored app CLI or activity
      // dispatch.
      const operatorForbiddenTargets = [
        {
          name: 'authored-activity-dispatch',
          target: SEA_ACTIVITY_DISPATCH_BREAKPOINT,
        },
        {
          name: 'authored-app-cli-dispatch',
          target: SEA_APP_CLI_DISPATCH_BREAKPOINT,
        },
      ];
      /** @type {ReturnType<typeof spawnInspectorPausedProcess> | undefined} */
      let service;
      /** @type {Record<string, any> | undefined} */
      let inspector;
      try {
        const unavailableNode = spawnSync('node', ['--version'], {
          encoding: 'utf8',
          env: environment,
        });
        assert.equal(
          /** @type {NodeJS.ErrnoException | undefined} */ (
            unavailableNode.error
          )?.code,
          'ENOENT',
          `${scenario.label} unexpectedly exposes Node on PATH`,
        );

        const batch = await fixture.createApplicationStateRecoveryBatchRun(
          options.appId,
          `sea-source-${caseId}`,
          [
            {
              effectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
              state: 'STARTED_ABSENT',
            },
          ],
        );
        const sourceEffectFixture = batch.effects[0];
        const sourceRecoveryArgs = [
          'wharfie',
          'recover',
          '--run-id',
          batch.runId,
          '--confirm-runner-stopped',
          '--json',
        ];
        const sourceRecovery = await runInspectorGuardedSeaJson(
          options.artifactPath,
          sourceRecoveryArgs,
          {
            cwd: caseRoot,
            env: environment,
            installedPackageRoot: options.installedPackageRoot,
            label: `${scenario.label} source recovery setup`,
            forbiddenTargets: operatorForbiddenTargets,
          },
        );
        assertManagedEffectBatchRecoveryView(sourceRecovery.serialized, batch, {
          adapter: fixture.ApplicationStateAdapterDescriptor,
          actor: packagedActor,
        });
        const sourceReconciliationArgs = [
          'wharfie',
          'reconcile-effect',
          '--run-id',
          batch.runId,
          '--effect-id',
          SEA_SUCCESSOR_SOURCE_EFFECT_ID,
          '--reconciliation-id',
          sourceReconciliationId,
          '--confirm-runner-stopped',
          '--reason',
          sourceReason,
          '--json',
        ];
        const sourceBeforeReconciliation = await fixture.readRun(batch.runId);
        assert.ok(sourceBeforeReconciliation);
        const sourceReconciliation = await runInspectorGuardedSeaJson(
          options.artifactPath,
          sourceReconciliationArgs,
          {
            cwd: caseRoot,
            env: environment,
            installedPackageRoot: options.installedPackageRoot,
            label: `${scenario.label} source not-applied setup`,
            forbiddenTargets: operatorForbiddenTargets,
          },
        );
        const sourceBeforeRetry = await fixture.readRun(batch.runId);
        assert.ok(sourceBeforeRetry);
        const sourceAuthority = assertUncertainManagedEffectReconciliationRun(
          sourceBeforeReconciliation,
          sourceBeforeRetry,
          batch,
          {
            effectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
            reconciliationId: sourceReconciliationId,
            status: 'NOT_APPLIED',
            actor: packagedActor,
            reason: sourceReason,
            verifier: fixture.ApplicationStateReconciliationVerifierDescriptor,
          },
        );
        assertManagedEffectReconciliationView(
          sourceReconciliation.serialized,
          batch,
          sourceBeforeRetry,
          {
            effectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
            reconciliationId: sourceReconciliationId,
            status: 'NOT_APPLIED',
            changed: true,
            privateReason: sourceReason,
            adapter: fixture.ApplicationStateAdapterDescriptor,
            extraSecrets: [applicationStatePath, controlPath],
          },
        );
        const sourceDestination = await fixture.readApplicationStateDestination(
          options.appId,
          sourceEffectFixture.destinationEffectId,
          sourceEffectFixture.requestKey,
        );
        const sourcePayload = readPayloadStorageSnapshotForRuns(payloadPath, [
          sourceBeforeRetry,
        ]);
        assert.deepEqual(sourcePayload.orphans, []);
        await assertManagedEffectReconciliationPayload(
          fixture,
          sourceAuthority.effect,
          sourceDestination,
          sourcePayload,
        );
        const sourceEffect = sourceBeforeRetry.effects.find(
          (effect) => effect.effectId === SEA_SUCCESSOR_SOURCE_EFFECT_ID,
        );
        assert.ok(sourceEffect);
        const sourceRequest = await fixture.readExecutionPayload(
          sourceEffect.requestRef,
        );
        assert.equal(sourceRequest.input.key, sourceEffectFixture.requestKey);
        const expectedAuthorization = createExpectedSeaSuccessorAuthorization(
          fixture,
          sourceBeforeRetry,
          sourceRequest,
          { successorId, reason: retryReason },
        );
        const expectedTargetRequest = {
          input: {
            effectRequest: {
              effectId: expectedAuthorization.target.effectId,
              ...sourceRequest,
            },
          },
          callerMetadata: {},
        };
        const expectedTargetRequestRef =
          fixture.createExecutionPayloadReference({
            bytes: fixture.encodeCanonicalJsonPayload(expectedTargetRequest),
            payloadSchema: 'wharfie.execution.activity-request.v1',
            storeId: fixture.payloadStoreId,
          });
        const directoryBeforeRetry = await fixture.listRunDirectory(
          options.appId,
        );
        const preexistingBusiness = scenario.preexistingBusiness
          ? await fixture.writeApplicationStateExternalValue(
              options.appId,
              sourceEffectFixture.requestKey,
              {
                writer: 'sea-external-writer',
                credential: `sea-external-state-secret-${caseId}`,
              },
              caseId,
            )
          : null;
        if (preexistingBusiness) {
          assert.deepEqual(preexistingBusiness.outcome.result, {
            inserted: true,
          });
        }
        assert.equal(await lifecycle.readOwnership(), null);
        assert.equal(existsSync(markerPath), false);

        const retryArgs = [
          'wharfie',
          'retry-effect',
          '--run-id',
          batch.runId,
          '--effect-id',
          SEA_SUCCESSOR_SOURCE_EFFECT_ID,
          '--successor-id',
          successorId,
          '--confirm-runner-stopped',
          '--reason',
          retryReason,
          '--json',
        ];
        service = spawnInspectorPausedProcess(options.artifactPath, retryArgs, {
          cwd: caseRoot,
          env: environment,
          timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
        });
        inspector = await attachSeaInspector(service, {
          timeoutMs: CRASH_RECOVERY_TIMEOUT_MS,
        });
        const adapterBreakpoint = await inspector.setSourceBreakpoint(
          'successor-adapter-entry',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_CRASH_ADAPTER_BREAKPOINT,
          ),
        );
        const writeBreakpoint = await inspector.setSourceBreakpoint(
          'successor-application-state-write',
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            SEA_CRASH_DESTINATION_TRANSACTION_BREAKPOINT,
          ),
        );
        const targetBreakpoint = await inspector.setSourceBreakpoint(
          scenario.boundary,
          bindInstalledBreakpointSource(
            options.installedPackageRoot,
            scenario.breakpoint,
          ),
        );
        const forbiddenBreakpoints = await Promise.all(
          operatorForbiddenTargets.map(
            async ({ name, target }) =>
              await inspector.setSourceBreakpoint(
                name,
                bindInstalledBreakpointSource(
                  options.installedPackageRoot,
                  target,
                ),
              ),
          ),
        );
        assert.deepEqual(
          await resumeToSeaSuccessorCrashBoundary(
            inspector,
            service,
            scenario,
            adapterBreakpoint,
            writeBreakpoint,
            targetBreakpoint,
            forbiddenBreakpoints,
          ),
          {
            adapterEntries: scenario.adapterEntries,
            applicationStateWrites: scenario.applicationStateWrites,
          },
        );
        assert.equal(
          service.getOutput().stdout,
          '',
          `${scenario.label} returned a response before its crash boundary`,
        );
        assert.equal(existsSync(markerPath), false);

        const sourceAtBoundary = await fixture.readRun(batch.runId);
        assert.ok(sourceAtBoundary);
        let authorization;
        let targetAtBoundary = null;
        if (!scenario.authorizationCommitted) {
          assert.deepEqual(sourceAtBoundary, sourceBeforeRetry);
          assert.equal(
            findSeaSuccessorAuthorization(sourceAtBoundary, successorId, 0),
            null,
          );
          assert.equal(
            await fixture.readRun(expectedAuthorization.target.runId),
            null,
          );
          assert.deepEqual(
            await fixture.readRawLedgerRunRows(
              expectedAuthorization.target.runId,
            ),
            [],
          );
          assert.deepEqual(
            await fixture.listRunDirectory(options.appId),
            directoryBeforeRetry,
          );
          assert.equal(
            await fixture.readSuccessorIdentity(options.appId, successorId),
            null,
          );
        } else {
          authorization = assertSeaSuccessorSourceAuthorization(
            sourceBeforeRetry,
            sourceAtBoundary,
            {
              successorId,
              sourceEffectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
              actor: packagedActor,
              reason: retryReason,
              revisionId: options.revisionId,
            },
          );
          assert.deepEqual(authorization, expectedAuthorization);
          targetAtBoundary = await fixture.readRun(authorization.target.runId);
          assert.ok(targetAtBoundary);
          assertSeaSuccessorTargetState(
            targetAtBoundary,
            authorization,
            scenario.target,
            packagedActor,
            scenario.label,
          );
          await assertSeaSuccessorTargetAuthority(
            fixture,
            sourceBeforeRetry,
            targetAtBoundary,
            authorization,
            sourceRequest,
            scenario.label,
          );
        }
        const destinationAtBoundary = authorization
          ? await fixture.readApplicationStateDestination(
              options.appId,
              authorization.target.destinationEffectId,
              sourceEffectFixture.requestKey,
            )
          : null;
        if (destinationAtBoundary) {
          assertSeaSuccessorDestination(
            destinationAtBoundary,
            authorization,
            sourceRequest,
            options.appId,
            scenario.destinationApplied,
            preexistingBusiness,
          );
        }
        const payloadAtBoundary = readPayloadStorageSnapshotForRuns(
          payloadPath,
          [sourceAtBoundary, ...(targetAtBoundary ? [targetAtBoundary] : [])],
        );
        assert.equal(payloadAtBoundary.orphans.length, scenario.orphanPayloads);
        assert.equal(
          payloadAtBoundary.physical.length,
          payloadAtBoundary.reachable.length + scenario.orphanPayloads,
        );
        assert.deepEqual(
          payloadAtBoundary.files.filter((file) =>
            sourcePayload.physical.includes(file.key),
          ),
          sourcePayload.files,
          `${scenario.label} rewrote preexisting immutable payloads`,
        );
        let preauthorizationRequestKey;
        if (!scenario.authorizationCommitted) {
          const added = payloadAtBoundary.physical.filter(
            (key) => !sourcePayload.physical.includes(key),
          );
          assert.deepEqual(
            payloadAtBoundary.reachable,
            sourcePayload.reachable,
          );
          assert.deepEqual(added, [expectedTargetRequestRef.storage.key]);
          assert.deepEqual(payloadAtBoundary.orphans, [
            expectedTargetRequestRef.storage.key,
          ]);
          assert.deepEqual(
            JSON.parse(
              JSON.stringify(
                await fixture.readExecutionPayload(expectedTargetRequestRef),
              ),
            ),
            JSON.parse(JSON.stringify(expectedTargetRequest)),
          );
          preauthorizationRequestKey = expectedTargetRequestRef.storage.key;
        }
        const terminalPayloadKeys =
          scenario.boundary === 'successor-terminal-payloads-published'
            ? [...payloadAtBoundary.orphans]
            : [];

        const ownershipAtBoundary = await lifecycle.readOwnership();
        assert.ok(ownershipAtBoundary, `${scenario.label} has no owner`);
        assert.equal(ownershipAtBoundary.appId, options.appId);
        assert.equal(ownershipAtBoundary.ownerKind, 'manual');
        const staleEndpoint = lifecycle.getSessionEndpoint(
          ownershipAtBoundary.sessionId,
          sessionPath,
        );
        staleEndpoints.add(staleEndpoint);
        assert.equal(existsSync(staleEndpoint), true);
        const killed = await signalResidentService(service, 'SIGKILL');
        assert.deepEqual(killed, { code: null, signal: 'SIGKILL' });
        inspector.close();
        inspector = undefined;
        service = undefined;
        assert.deepEqual(await lifecycle.readOwnership(), ownershipAtBoundary);
        assert.deepEqual(await fixture.readRun(batch.runId), sourceAtBoundary);
        if (!scenario.authorizationCommitted) {
          assert.equal(
            await fixture.readRun(expectedAuthorization.target.runId),
            null,
          );
          assert.deepEqual(
            await fixture.readRawLedgerRunRows(
              expectedAuthorization.target.runId,
            ),
            [],
          );
          assert.deepEqual(
            await fixture.listRunDirectory(options.appId),
            directoryBeforeRetry,
          );
          assert.equal(
            await fixture.readSuccessorIdentity(options.appId, successorId),
            null,
          );
        } else if (authorization) {
          assert.deepEqual(
            await fixture.readRun(authorization.target.runId),
            targetAtBoundary,
          );
        }
        assert.deepEqual(
          readPayloadStorageSnapshotForRuns(payloadPath, [
            sourceAtBoundary,
            ...(targetAtBoundary ? [targetAtBoundary] : []),
          ]),
          payloadAtBoundary,
        );
        if (authorization) {
          assert.deepEqual(
            await fixture.readApplicationStateDestination(
              options.appId,
              authorization.target.destinationEffectId,
              sourceEffectFixture.requestKey,
            ),
            destinationAtBoundary,
          );
        }

        const commonSecrets = [
          ...batch.secrets,
          sourceEffectFixture.destinationEffectId,
          sourceEffectFixture.requestKey,
          batch.storeId,
          sourceReason,
          retryReason,
          targetReason,
          applicationStatePath,
          controlPath,
          ...(preexistingBusiness
            ? [
                preexistingBusiness.destinationEffectId,
                preexistingBusiness.value.credential,
              ]
            : []),
        ];
        let finalSource;
        let finalTarget;
        let finalDestination;
        let finalPayload;
        let finalDisposition;

        if (
          scenario.boundary === 'successor-target-request-published' ||
          scenario.boundary === 'successor-authorization-committed'
        ) {
          const continuation = await runInspectorGuardedSeaJson(
            options.artifactPath,
            retryArgs,
            {
              cwd: caseRoot,
              env: environment,
              installedPackageRoot: options.installedPackageRoot,
              label: `${scenario.label} restart completion`,
              forbiddenTargets: operatorForbiddenTargets,
              allowedAdapterEntries: 1,
              allowedApplicationStateWrites: 1,
              writeBreakpointTarget:
                SEA_CRASH_DESTINATION_TRANSACTION_BREAKPOINT,
            },
          );
          finalSource = await fixture.readRun(batch.runId);
          assert.ok(finalSource);
          if (!scenario.authorizationCommitted) {
            authorization = assertSeaSuccessorSourceAuthorization(
              sourceBeforeRetry,
              finalSource,
              {
                successorId,
                sourceEffectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
                actor: packagedActor,
                reason: retryReason,
                revisionId: options.revisionId,
              },
            );
            assert.deepEqual(authorization, expectedAuthorization);
          } else {
            assert.deepEqual(finalSource, sourceAtBoundary);
          }
          finalTarget = await fixture.readRun(authorization.target.runId);
          assert.ok(finalTarget);
          assertSeaSuccessorTargetState(
            finalTarget,
            authorization,
            {
              run: 'COMPLETED',
              invocation: 'COMPLETED',
              attempt: 'COMPLETED',
              effect: 'COMPLETED',
              events: [
                'effect-successor-run-created',
                'effect-successor-started',
                'effect-successor-terminal',
              ],
            },
            packagedActor,
            `${scenario.label} completed target`,
          );
          await assertSeaSuccessorTargetAuthority(
            fixture,
            sourceBeforeRetry,
            finalTarget,
            authorization,
            sourceRequest,
            `${scenario.label} completed target`,
          );
          finalDestination = await fixture.readApplicationStateDestination(
            options.appId,
            authorization.target.destinationEffectId,
            sourceEffectFixture.requestKey,
          );
          assertSeaSuccessorDestination(
            finalDestination,
            authorization,
            sourceRequest,
            options.appId,
            true,
            preexistingBusiness,
          );
          finalPayload = readPayloadStorageSnapshotForRuns(payloadPath, [
            finalSource,
            finalTarget,
          ]);
          assert.deepEqual(finalPayload.orphans, []);
          if (preauthorizationRequestKey) {
            assert.deepEqual(
              finalTarget.run.requestRef,
              expectedTargetRequestRef,
              'restart did not reuse the pre-authorization request payload',
            );
            assert.ok(
              finalPayload.reachable.includes(preauthorizationRequestKey),
            );
            assert.deepEqual(
              finalPayload.files.find(
                (file) => file.key === preauthorizationRequestKey,
              ),
              payloadAtBoundary.files.find(
                (file) => file.key === preauthorizationRequestKey,
              ),
            );
          }
          assertSeaSuccessorOperatorView(
            continuation.serialized,
            finalSource,
            finalTarget,
            {
              successorId,
              sourceEffectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
              targetEffectId: authorization.target.effectId,
              authorizationApplied: !scenario.authorizationCommitted,
              disposition: 'completed',
              secrets: [
                ...commonSecrets,
                authorization.target.destinationEffectId,
              ],
              label: `${scenario.label} continuation`,
            },
          );
          for (const secret of commonSecrets) {
            assert.equal(continuation.stderr.includes(secret), false);
          }
          finalDisposition = 'completed';
        } else {
          if (scenario.boundary !== 'successor-atomic-terminal-committed') {
            const retained = await runInspectorGuardedSeaJson(
              options.artifactPath,
              retryArgs,
              {
                cwd: caseRoot,
                env: environment,
                installedPackageRoot: options.installedPackageRoot,
                label: `${scenario.label} retained pre-recovery replay`,
                forbiddenTargets: operatorForbiddenTargets,
                expectedExitCode: 1,
                writeBreakpointTarget:
                  SEA_CRASH_DESTINATION_TRANSACTION_BREAKPOINT,
              },
            );
            assertSeaSuccessorOperatorView(
              retained.serialized,
              sourceAtBoundary,
              targetAtBoundary,
              {
                successorId,
                sourceEffectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
                targetEffectId: authorization.target.effectId,
                authorizationApplied: false,
                disposition: 'in-progress',
                secrets: [
                  ...commonSecrets,
                  authorization.target.destinationEffectId,
                ],
                label: `${scenario.label} retained replay`,
              },
            );
            assert.match(retained.stderr, /already in progress/i);
            for (const secret of commonSecrets) {
              assert.equal(retained.stderr.includes(secret), false);
            }
            assert.deepEqual(
              await fixture.readRun(batch.runId),
              sourceAtBoundary,
            );
            assert.deepEqual(
              await fixture.readRun(authorization.target.runId),
              targetAtBoundary,
            );
          }

          const recoveryArgs = [
            'wharfie',
            'recover',
            '--run-id',
            authorization.target.runId,
            '--confirm-runner-stopped',
            '--json',
          ];
          const recovery = await runInspectorGuardedSeaJson(
            options.artifactPath,
            recoveryArgs,
            {
              cwd: caseRoot,
              env: environment,
              installedPackageRoot: options.installedPackageRoot,
              label: `${scenario.label} target recovery`,
              forbiddenTargets: operatorForbiddenTargets,
            },
          );
          const recoveredTarget = await fixture.readRun(
            authorization.target.runId,
          );
          assert.ok(recoveredTarget);
          if (scenario.boundary === 'successor-atomic-terminal-committed') {
            assert.deepEqual(recoveredTarget, targetAtBoundary);
            assert.deepEqual(JSON.parse(recovery.serialized), {
              ...createExpectedSeaOperatorRunView(
                recoveredTarget,
                'wharfie.execution-ledger.recovery',
              ),
              recovery: { action: 'none', changed: false },
            });
            finalSource = sourceAtBoundary;
            finalTarget = recoveredTarget;
            finalDestination = destinationAtBoundary;
            finalPayload = payloadAtBoundary;
            finalDisposition = 'completed';
          } else {
            assertSeaSuccessorTargetState(
              recoveredTarget,
              authorization,
              {
                run: 'BLOCKED',
                invocation: 'UNCERTAIN',
                attempt: 'ABANDONED',
                effect: 'UNCERTAIN',
                events: [
                  'effect-successor-run-created',
                  'effect-successor-started',
                  'effect-successor-interrupted',
                ],
              },
              packagedActor,
              `${scenario.label} recovered target`,
            );
            await assertSeaSuccessorTargetAuthority(
              fixture,
              sourceBeforeRetry,
              recoveredTarget,
              authorization,
              sourceRequest,
              `${scenario.label} recovered target`,
            );
            assert.deepEqual(JSON.parse(recovery.serialized), {
              ...createExpectedSeaOperatorRunView(
                recoveredTarget,
                'wharfie.execution-ledger.recovery',
              ),
              recovery: {
                action: 'marked-successor-uncertain',
                changed: true,
              },
            });
            assert.deepEqual(
              readPayloadStorageSnapshotForRuns(payloadPath, [
                sourceAtBoundary,
                recoveredTarget,
              ]),
              payloadAtBoundary,
              `${scenario.label} recovery published payloads`,
            );
            assert.deepEqual(
              await fixture.readApplicationStateDestination(
                options.appId,
                authorization.target.destinationEffectId,
                sourceEffectFixture.requestKey,
              ),
              destinationAtBoundary,
            );

            const reconciliationArgs = [
              'wharfie',
              'reconcile-effect',
              '--run-id',
              authorization.target.runId,
              '--effect-id',
              authorization.target.effectId,
              '--reconciliation-id',
              targetReconciliationId,
              '--confirm-runner-stopped',
              '--reason',
              targetReason,
              '--json',
            ];
            const reconciliation = await runInspectorGuardedSeaJson(
              options.artifactPath,
              reconciliationArgs,
              {
                cwd: caseRoot,
                env: environment,
                installedPackageRoot: options.installedPackageRoot,
                label: `${scenario.label} target reconciliation`,
                forbiddenTargets: operatorForbiddenTargets,
              },
            );
            finalSource = await fixture.readRun(batch.runId);
            finalTarget = await fixture.readRun(authorization.target.runId);
            assert.ok(finalSource);
            assert.ok(finalTarget);
            assert.deepEqual(finalSource, sourceAtBoundary);
            const completed = scenario.destinationApplied;
            assertSeaSuccessorTargetState(
              finalTarget,
              authorization,
              {
                run: completed ? 'COMPLETED' : 'FAILED',
                invocation: completed ? 'COMPLETED' : 'FAILED',
                attempt: 'ABANDONED',
                effect: completed ? 'COMPLETED' : 'NOT_APPLIED',
                events: [
                  'effect-successor-run-created',
                  'effect-successor-started',
                  'effect-successor-interrupted',
                  'effect-successor-reconciled',
                ],
              },
              packagedActor,
              `${scenario.label} reconciled target`,
            );
            await assertSeaSuccessorTargetAuthority(
              fixture,
              sourceBeforeRetry,
              finalTarget,
              authorization,
              sourceRequest,
              `${scenario.label} reconciled target`,
            );
            assert.deepEqual(finalTarget.attempts, recoveredTarget.attempts);
            assert.deepEqual(JSON.parse(reconciliation.serialized), {
              ...createExpectedSeaOperatorRunView(
                finalTarget,
                'wharfie.execution-ledger.effect-reconciliation',
              ),
              effectReconciliation: {
                reconciliationId: targetReconciliationId,
                effectId: authorization.target.effectId,
                status: completed ? 'COMPLETED' : 'NOT_APPLIED',
                changed: true,
              },
            });
            finalDestination = await fixture.readApplicationStateDestination(
              options.appId,
              authorization.target.destinationEffectId,
              sourceEffectFixture.requestKey,
            );
            assertSeaSuccessorDestination(
              finalDestination,
              authorization,
              sourceRequest,
              options.appId,
              completed ? true : 'not-applied',
              preexistingBusiness,
            );
            finalPayload = readPayloadStorageSnapshotForRuns(payloadPath, [
              finalSource,
              finalTarget,
            ]);
            await assertManagedEffectReconciliationPayload(
              fixture,
              finalTarget.effects[0],
              finalDestination,
              finalPayload,
            );
            if (scenario.boundary === 'successor-terminal-payloads-published') {
              assert.deepEqual(
                finalPayload.physical,
                payloadAtBoundary.physical,
              );
              assert.deepEqual(finalPayload.files, payloadAtBoundary.files);
              assert.equal(finalPayload.orphans.length, 1);
              const reusedOutcomeKey =
                finalTarget.effects[0].reconciliation.evidenceRef.storage.key;
              assert.equal(
                finalTarget.effects[0].outcomeRef.storage.key,
                reusedOutcomeKey,
              );
              assert.ok(terminalPayloadKeys.includes(reusedOutcomeKey));
              assert.deepEqual(
                finalPayload.orphans,
                terminalPayloadKeys.filter((key) => key !== reusedOutcomeKey),
              );
            } else {
              assert.deepEqual(finalPayload.orphans, []);
            }
            finalDisposition = completed ? 'completed' : 'failed';
          }
        }

        assert.ok(authorization);
        assert.ok(finalSource);
        assert.ok(finalTarget);
        assert.ok(finalDestination);
        assert.ok(finalPayload);
        assert.deepEqual(authorization, expectedAuthorization);
        await assertSeaSuccessorTargetAuthority(
          fixture,
          sourceBeforeRetry,
          finalTarget,
          authorization,
          sourceRequest,
          `${scenario.label} final target`,
        );
        await assertSeaSuccessorTerminalOutcomeEvidence(
          fixture,
          finalTarget,
          authorization,
          sourceRequest,
          finalDestination,
          finalPayload,
          `${scenario.label} final terminal`,
        );
        assert.deepEqual(
          findSeaSuccessorAuthorization(finalSource, successorId, 1),
          authorization,
        );
        const beforeFinalReplay = {
          source: finalSource,
          target: finalTarget,
          destination: finalDestination,
          payload: finalPayload,
        };
        const finalReplay = await runInspectorGuardedSeaJson(
          options.artifactPath,
          retryArgs,
          {
            cwd: caseRoot,
            env: environment,
            installedPackageRoot: options.installedPackageRoot,
            label: `${scenario.label} terminal replay`,
            forbiddenTargets: operatorForbiddenTargets,
            expectedExitCode: finalDisposition === 'failed' ? 1 : 0,
            writeBreakpointTarget: SEA_CRASH_DESTINATION_TRANSACTION_BREAKPOINT,
          },
        );
        assertSeaSuccessorOperatorView(
          finalReplay.serialized,
          finalSource,
          finalTarget,
          {
            successorId,
            sourceEffectId: SEA_SUCCESSOR_SOURCE_EFFECT_ID,
            targetEffectId: authorization.target.effectId,
            authorizationApplied: false,
            disposition: finalDisposition,
            secrets: [
              ...commonSecrets,
              authorization.target.destinationEffectId,
            ],
            label: `${scenario.label} terminal replay`,
          },
        );
        if (finalDisposition === 'failed') {
          assert.match(finalReplay.stderr, /finished FAILED/i);
        }
        for (const secret of commonSecrets) {
          assert.equal(finalReplay.stderr.includes(secret), false);
        }
        assert.deepEqual(
          await fixture.readRun(batch.runId),
          beforeFinalReplay.source,
        );
        assert.deepEqual(
          await fixture.readRun(authorization.target.runId),
          beforeFinalReplay.target,
        );
        assert.deepEqual(
          await fixture.readApplicationStateDestination(
            options.appId,
            authorization.target.destinationEffectId,
            sourceEffectFixture.requestKey,
          ),
          beforeFinalReplay.destination,
        );
        assert.deepEqual(
          readPayloadStorageSnapshotForRuns(payloadPath, [
            beforeFinalReplay.source,
            beforeFinalReplay.target,
          ]),
          beforeFinalReplay.payload,
        );
        const finalSourceDestination =
          await fixture.readApplicationStateDestination(
            options.appId,
            sourceEffectFixture.destinationEffectId,
            sourceEffectFixture.requestKey,
          );
        assert.deepEqual(
          {
            receipt: finalSourceDestination.receipt,
            resolution: finalSourceDestination.resolution,
          },
          {
            receipt: sourceDestination.receipt,
            resolution: sourceDestination.resolution,
          },
          `${scenario.label} rewrote the source effect disposition`,
        );
        assert.deepEqual(
          finalSourceDestination.business,
          finalDestination.business,
          `${scenario.label} did not retain one shared successor business row`,
        );
        assert.equal(await lifecycle.readOwnership(), null);
        assert.equal(existsSync(staleEndpoint), true);
        assert.equal(existsSync(markerPath), false);
      } finally {
        inspector?.close();
        await stopResidentServiceForCleanup(service);
        for (const endpoint of staleEndpoints)
          rmSync(endpoint, { force: true });
        rmSync(caseRoot, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(options.root, { recursive: true, force: true });
  }
}

/**
 * Parse the final nonempty JSON line emitted by a CLI command.
 * @param {unknown} value - Captured command output.
 * @returns {Record<string, any>} - Parsed final JSON object.
 */
function parseFinalJsonLine(value) {
  const line = String(value).trim().split('\n').filter(Boolean).at(-1);
  if (!line) throw new Error('Expected one JSON command response.');
  return JSON.parse(line);
}

/**
 * Parse a JSON receipt emitted before a human-readable success line.
 * @param {unknown} value - Captured operator command output.
 * @returns {Record<string, any>} - Parsed first JSON object.
 */
function parseFirstJsonLine(value) {
  const line = String(value).trim().split('\n').find(Boolean);
  if (!line) throw new Error('Expected one JSON command receipt.');
  return JSON.parse(line);
}

/**
 * Return one compact exact-ready-work projection for workflow assertions.
 * @param {Record<string, any>[]} items - Durable ready-work records.
 * @returns {Record<string, any>[]} - Stable assertion projection.
 */
function workflowReadySummary(items) {
  return items.map((/** @type {Record<string, any>} */ item) => ({
    kind: item.kind,
    runId: item.runId,
    cursorVersion: item.cursorVersion,
    stepId: item.stepId,
    stepIndex: item.stepIndex,
    ...(item.invocationId === undefined
      ? {}
      : { invocationId: item.invocationId }),
    ...(item.timerId === undefined ? {} : { timerId: item.timerId }),
    ...(item.generation === undefined ? {} : { generation: item.generation }),
    ...(item.attemptId === undefined ? {} : { attemptId: item.attemptId }),
  }));
}

/**
 * Create one isolated public workflow run through the relocated SEA.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string}} options - Shared matrix inputs.
 * @param {string} boundary - Stable case identity.
 * @returns {Promise<Record<string, any>>} - Isolated workflow case.
 */
async function createRelocatedSeaWorkflowCase(options, boundary) {
  const caseRoot = path.join(options.root, boundary);
  const controlPath = path.join(caseRoot, 'control');
  const payloadPath = path.join(controlPath, 'execution-payloads');
  const sessionPath = path.join(caseRoot, 'sessions');
  const applicationStatePath = path.join(caseRoot, 'application-state');
  const markerDirectory = path.join(caseRoot, 'workflow-markers');
  const tableName = 'wharfie-package-sea-workflow-crash-matrix';
  mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
  const environment = {
    ...options.cleanEnvironment,
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: controlPath,
    WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
    WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
    WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
    WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
  };
  const fixture = await createInstalledExecutionLedgerFixture({
    installedPackageRoot: options.installedPackageRoot,
    controlPath,
    tableName,
    payloadPath,
    applicationStatePath,
    revisionId: options.revisionId,
  });
  const lifecycle = await createInstalledLedgerLifecycleObserver({
    installedPackageRoot: options.installedPackageRoot,
    controlPath,
    tableName,
    appId: options.appId,
  });
  const idempotencyKey = `sea-workflow-${boundary}`;
  const runId = fixture.createWorkflowRunId(options.appId, idempotencyKey);
  const secret = `private-workflow-${boundary}-${randomUUID()}`;
  const callerSecret = `private-workflow-caller-${boundary}`;
  const input = { ordinal: 1, markerDirectory, secret };
  const startArgs = [
    'wharfie',
    'start',
    '--workflow',
    SEA_WORKFLOW_ID,
    '--idempotency-key',
    idempotencyKey,
    '--input',
    JSON.stringify(input),
    '--caller-metadata',
    JSON.stringify({ requestId: callerSecret, boundary }),
    '--json',
  ];
  const startText = runCommand(options.artifactPath, startArgs, {
    cwd: caseRoot,
    capture: true,
    env: environment,
  }).stdout.trim();
  const start = parseFinalJsonLine(startText);
  assert.deepEqual(start, {
    idempotency_key: idempotencyKey,
    run_id: runId,
    revision: options.revisionId,
    workflow: SEA_WORKFLOW_ID,
    status: 'RUNNING',
    cursor_disposition: 'ACTIVITY_RUNNABLE',
    step: 'first',
    step_index: 0,
    activation_kind: 'activity',
    activation_status: 'RUNNABLE',
    reused: false,
  });
  for (const privateValue of [secret, callerSecret, markerDirectory]) {
    assert.equal(startText.includes(privateValue), false);
  }
  const initial = await fixture.readRun(runId);
  assert.ok(initial);
  assert.equal(initial.run.version, 1);
  assert.equal(initial.run.trigger.kind, 'workflow');
  assert.equal(initial.run.trigger.workflowId, SEA_WORKFLOW_ID);
  assert.equal(initial.workflowCursor.disposition, 'ACTIVITY_RUNNABLE');
  assert.equal(initial.workflowCursor.stepId, 'first');
  assert.equal(initial.invocations[0].activityId, SEA_WORKFLOW_ACTIVITY_ID);
  assert.equal(initial.invocations[0].status, 'RUNNABLE');
  assert.deepEqual(
    initial.events.map((event) => event.type),
    ['workflow-run-created'],
  );
  assert.deepEqual(initial.events[0].actor, {
    kind: 'workflow-operator',
    id: options.revisionId,
  });
  const ready = await fixture.listReadyWork(options.appId, options.revisionId);
  assert.deepEqual(workflowReadySummary(ready), [
    {
      kind: 'ACTIVITY',
      runId,
      invocationId: initial.invocations[0].invocationId,
      generation: 0,
      cursorVersion: 1,
      stepId: 'first',
      stepIndex: 0,
    },
  ]);
  return {
    boundary,
    caseRoot,
    controlPath,
    payloadPath,
    sessionPath,
    applicationStatePath,
    markerDirectory,
    environment,
    fixture,
    lifecycle,
    idempotencyKey,
    runId,
    secret,
    callerSecret,
    input,
    startArgs,
    initial,
  };
}

/**
 * Kill one exact inspected boundary and retain stale ownership evidence.
 * @param {Record<string, any>} paused - Paused inspector and child process.
 * @param {Record<string, any>} lifecycle - Installed lifecycle observer.
 * @param {string} sessionPath - Ledger-service session directory.
 * @returns {Promise<Record<string, any>>} - Retained ownership and endpoint.
 */
async function killPausedWorkflowBoundary(paused, lifecycle, sessionPath) {
  const ownership = await lifecycle.readOwnership();
  assert.ok(ownership);
  const endpoint = lifecycle.getSessionEndpoint(
    ownership.sessionId,
    sessionPath,
  );
  assert.equal(existsSync(endpoint), true);
  const killed = await signalResidentService(paused.service, 'SIGKILL');
  assert.deepEqual(killed, { code: null, signal: 'SIGKILL' });
  paused.inspector.close();
  assert.deepEqual(await lifecycle.readOwnership(), ownership);
  assert.equal(existsSync(endpoint), true);
  return { ownership, endpoint };
}

/**
 * Kill a public command after its mutation service released local ownership
 * but before its JSON response was constructed.
 * @param {Record<string, any>} paused - Paused inspector and child process.
 * @param {Record<string, any>} lifecycle - Installed lifecycle observer.
 * @returns {Promise<void>} - Resolves after the owner-free SIGKILL.
 */
async function killPausedWorkflowResponse(paused, lifecycle) {
  assert.equal(await lifecycle.readOwnership(), null);
  assert.equal(paused.service.getOutput().stdout, '');
  const killed = await signalResidentService(paused.service, 'SIGKILL');
  assert.deepEqual(killed, { code: null, signal: 'SIGKILL' });
  paused.inspector.close();
  assert.equal(await lifecycle.readOwnership(), null);
}

/**
 * Run a public packaged recovery while forbidding every authored path.
 * @param {{artifactPath: string, installedPackageRoot: string}} options - SEA inputs.
 * @param {Record<string, any>} context - Isolated workflow case.
 * @param {string} label - Inspector assertion label.
 * @returns {Promise<Record<string, any>>} - Guarded command result.
 */
async function runSeaWorkflowRecovery(options, context, label) {
  return await runInspectorGuardedSeaJson(
    options.artifactPath,
    [
      'wharfie',
      'recover',
      '--run-id',
      context.runId,
      '--confirm-runner-stopped',
      '--json',
    ],
    {
      cwd: context.caseRoot,
      env: context.environment,
      installedPackageRoot: options.installedPackageRoot,
      label,
      forbiddenTargets: [
        {
          name: 'workflow-activity-dispatch',
          target: SEA_WORKFLOW_DISPATCH_BREAKPOINT,
        },
        {
          name: 'manual-activity-dispatch',
          target: SEA_ACTIVITY_DISPATCH_BREAKPOINT,
        },
        {
          name: 'developer-cli-dispatch',
          target: SEA_APP_CLI_DISPATCH_BREAKPOINT,
        },
      ],
    },
  );
}

/**
 * Start a public packaged worker, wait for workflow completion, and drain it.
 * @param {{artifactPath: string, appId: string}} options - SEA inputs.
 * @param {Record<string, any>} context - Isolated workflow case.
 * @param {string} label - Lifecycle assertion label.
 * @returns {Promise<Record<string, any>>} - Completed durable run.
 */
async function completeSeaWorkflow(options, context, label) {
  const previousLifecycle = await context.lifecycle.read();
  const previousGeneration = previousLifecycle?.generation ?? 0;
  const previousSessionId = previousLifecycle?.sessionId;
  const service = spawnResidentService(options.artifactPath, {
    cwd: context.caseRoot,
    env: context.environment,
    args: ['wharfie', 'worker'],
  });
  try {
    const ready = await waitForResidentLifecycle(
      context.lifecycle,
      (snapshot) =>
        snapshot?.status === 'READY' &&
        snapshot.generation === previousGeneration + 1,
      service,
      `${label} resident READY`,
    );
    assert.notEqual(ready.sessionId, previousSessionId);
    const ownership = await context.lifecycle.readOwnership();
    assert.equal(ownership?.ownerKind, 'resident');
    assert.equal(ownership?.sessionId, ready.sessionId);
    assert.equal(ownership?.appId, options.appId);
    assert.ok(
      Number.isSafeInteger(ownership?.generation) && ownership.generation > 0,
    );
    const completed = await waitForDurableRun(
      { read: async () => await context.fixture.readRun(context.runId) },
      (snapshot) =>
        snapshot?.run.status === 'COMPLETED' &&
        snapshot.workflowCursor?.disposition === 'COMPLETED',
      service,
      `${label} workflow completion`,
    );
    const exit = await signalResidentService(service, 'SIGTERM');
    assert.deepEqual(exit, { code: 0, signal: null });
    const stopped = await waitForDurableLifecycle(
      context.lifecycle,
      (snapshot) =>
        snapshot?.status === 'STOPPED' &&
        snapshot.generation === ready.generation,
      `${label} resident STOPPED`,
    );
    assert.equal(stopped.sessionId, ready.sessionId);
    return completed;
  } finally {
    await stopResidentServiceForCleanup(service);
  }
}

/**
 * Assert one completed two-step workflow has exact linear authority.
 * @param {{artifactPath: string, appId: string, revisionId: string}} options - SEA inputs.
 * @param {Record<string, any>} context - Isolated workflow case.
 * @param {Record<string, any>} run - Completed durable run.
 * @param {{firstGeneration?: number, abandonedAttempts?: number, completedAttempts?: number, eventTypes?: string[]}} [expectations] - Recovery-specific retained history.
 * @returns {Promise<void>} - Resolves after exact durable assertions.
 */
async function assertCompletedSeaWorkflow(
  options,
  context,
  run,
  expectations = {},
) {
  const expectedEventTypes = expectations.eventTypes ?? [
    'workflow-run-created',
    'workflow-activity-claimed',
    'workflow-activity-started',
    'workflow-activity-succeeded',
    'workflow-activity-claimed',
    'workflow-activity-started',
    'workflow-activity-succeeded',
  ];
  const expectedFirstGeneration = expectations.firstGeneration ?? 1;
  const expectedAbandonedAttempts = expectations.abandonedAttempts ?? 0;
  const expectedCompletedAttempts = expectations.completedAttempts ?? 2;
  assert.equal(run.run.status, 'COMPLETED');
  assert.equal(run.run.version, expectedEventTypes.length);
  assert.equal(run.run.lastSequence, expectedEventTypes.length);
  assert.equal(run.workflowCursor.disposition, 'COMPLETED');
  assert.deepEqual(
    run.events.map((/** @type {Record<string, any>} */ event) => event.type),
    expectedEventTypes,
  );
  assert.deepEqual(
    run.workflowCursor.outputs.map(
      (/** @type {Record<string, any>} */ output) => ({
        stepId: output.stepId,
        stepIndex: output.stepIndex,
      }),
    ),
    [
      { stepId: 'first', stepIndex: 0 },
      { stepId: 'second', stepIndex: 1 },
    ],
  );
  assert.deepEqual(
    [...run.invocations]
      .sort((left, right) => left.workflow.stepIndex - right.workflow.stepIndex)
      .map((/** @type {Record<string, any>} */ invocation) => ({
        stepId: invocation.workflow.stepId,
        status: invocation.status,
        generation: invocation.generation,
      })),
    [
      {
        stepId: 'first',
        status: 'COMPLETED',
        generation: expectedFirstGeneration,
      },
      { stepId: 'second', status: 'COMPLETED', generation: 1 },
    ],
  );
  assert.equal(
    run.attempts.filter(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.status === 'ABANDONED',
    ).length,
    expectedAbandonedAttempts,
  );
  assert.equal(
    run.attempts.filter(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.status === 'COMPLETED',
    ).length,
    expectedCompletedAttempts,
  );
  assert.equal(
    run.attempts.length,
    expectedAbandonedAttempts + expectedCompletedAttempts,
  );
  assert.deepEqual(
    await context.fixture.listReadyWork(options.appId, options.revisionId),
    [],
  );
  assert.equal(run.effects.length, 0);
  assert.equal(
    readPayloadReachability(context.payloadPath, run).orphans.length,
    0,
  );
  for (const ordinal of [1, 2]) {
    const marker = JSON.parse(
      readFileSync(
        path.join(context.markerDirectory, `${ordinal}.json`),
        'utf8',
      ),
    );
    assert.deepEqual(marker, {
      kind: 'packaged-workflow-step',
      ordinal,
      executable: realpathSync(options.artifactPath),
      result: {
        ordinal: ordinal + 1,
        markerDirectory: context.markerDirectory,
        secret: context.secret,
        value: `portable-workflow-step-${ordinal}`,
      },
    });
  }
}

/**
 * Prove that a moved SEA persists one timer decision across resident death,
 * consumes only its current signal wait, and resumes the exact next activity.
 * The clean environment deliberately exposes no Node executable on PATH.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string}} options - Packaged workflow inputs.
 * @returns {Promise<void>} - Resolves after exact replay and cleanup checks.
 */
async function verifyRelocatedSeaTimerSignalWorkflow(options) {
  rmSync(options.root, { recursive: true, force: true });
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  const controlPath = path.join(options.root, 'control');
  const payloadPath = path.join(controlPath, 'execution-payloads');
  const sessionPath = path.join(options.root, 'sessions');
  const applicationStatePath = path.join(options.root, 'application-state');
  const markerDirectory = path.join(options.root, 'workflow-markers');
  const tableName = 'wharfie-package-sea-timer-signal-workflow';
  mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
  const environment = {
    ...options.cleanEnvironment,
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: controlPath,
    WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
    WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
    WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
    WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
  };
  const fixture = await createInstalledExecutionLedgerFixture({
    installedPackageRoot: options.installedPackageRoot,
    controlPath,
    tableName,
    payloadPath,
    applicationStatePath,
    revisionId: options.revisionId,
  });
  const lifecycle = await createInstalledLedgerLifecycleObserver({
    installedPackageRoot: options.installedPackageRoot,
    controlPath,
    tableName,
    appId: options.appId,
  });
  const idempotencyKey = 'sea-timer-signal-workflow';
  const runId = fixture.createWorkflowRunId(options.appId, idempotencyKey);
  const secret = `private-timer-signal-${randomUUID()}`;
  const input = { ordinal: 1, markerDirectory, secret };
  const startText = runCommand(
    options.artifactPath,
    [
      'wharfie',
      'start',
      '--workflow',
      SEA_TIMER_SIGNAL_WORKFLOW_ID,
      '--idempotency-key',
      idempotencyKey,
      '--input',
      JSON.stringify(input),
      '--json',
    ],
    { cwd: options.root, capture: true, env: environment },
  ).stdout.trim();
  assert.deepEqual(parseFinalJsonLine(startText), {
    idempotency_key: idempotencyKey,
    run_id: runId,
    revision: options.revisionId,
    workflow: SEA_TIMER_SIGNAL_WORKFLOW_ID,
    status: 'RUNNING',
    cursor_disposition: 'ACTIVITY_RUNNABLE',
    step: 'first',
    step_index: 0,
    activation_kind: 'activity',
    activation_status: 'RUNNABLE',
    reused: false,
  });
  for (const privateValue of [secret, markerDirectory]) {
    assert.equal(startText.includes(privateValue), false);
  }

  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let firstService;
  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let secondService;
  /** @type {string | undefined} */
  let staleEndpoint;
  try {
    firstService = spawnResidentService(options.artifactPath, {
      cwd: options.root,
      env: environment,
      args: ['wharfie', 'worker'],
    });
    const firstReady = await waitForResidentLifecycle(
      lifecycle,
      (snapshot) => snapshot?.status === 'READY' && snapshot.generation === 1,
      firstService,
      'timer workflow resident READY generation 1',
    );
    const observedWaitingTimerRun = await waitForDurableRun(
      { read: async () => await fixture.readRun(runId) },
      (snapshot) => snapshot?.workflowCursor?.disposition === 'TIMER_WAITING',
      firstService,
      'persisted TIMER_WAITING',
    );
    // Kill as soon as the durable wait is observed. Assertions and read-only
    // fixture queries below can then take arbitrarily long without racing the
    // live resident against the five-second timer deadline.
    assert.deepEqual(await signalResidentService(firstService, 'SIGKILL'), {
      code: null,
      signal: 'SIGKILL',
    });
    firstService = undefined;
    const waitingTimerRun = await fixture.readRun(runId);
    assert.deepEqual(waitingTimerRun, observedWaitingTimerRun);
    assert.ok(waitingTimerRun);
    assert.equal(waitingTimerRun.run.status, 'RUNNING');
    assert.equal(waitingTimerRun.timers.length, 1);
    const waitingTimer = waitingTimerRun.timers[0];
    assert.equal(waitingTimer.status, 'WAITING');
    assert.equal(waitingTimer.stepId, 'pause');
    assert.equal(waitingTimer.stepIndex, 1);
    assert.equal(waitingTimer.dueAt - waitingTimer.scheduledAt, 5_000);
    assert.equal(waitingTimerRun.workflowCursor.timerId, waitingTimer.timerId);
    const futureReady = await fixture.listReadyWork(
      options.appId,
      options.revisionId,
      Number.MAX_SAFE_INTEGER,
    );
    assert.deepEqual(workflowReadySummary(futureReady), [
      {
        kind: 'TIMER',
        runId,
        cursorVersion: waitingTimerRun.workflowCursor.version,
        stepId: 'pause',
        stepIndex: 1,
        timerId: waitingTimer.timerId,
      },
    ]);
    assert.equal(futureReady[0].availableAt, waitingTimer.dueAt);
    const firstOwnership = await lifecycle.readOwnership();
    assert.equal(firstOwnership?.ownerKind, 'resident');
    assert.equal(firstOwnership?.appId, options.appId);
    assert.equal(firstOwnership?.generation, firstReady.generation);
    assert.equal(firstOwnership?.sessionId, firstReady.sessionId);
    staleEndpoint = lifecycle.getSessionEndpoint(
      firstReady.sessionId,
      sessionPath,
    );
    assert.equal(existsSync(staleEndpoint), true);
    secondService = spawnResidentService(options.artifactPath, {
      cwd: options.root,
      env: environment,
      args: ['wharfie', 'worker'],
    });
    const secondReady = await waitForResidentLifecycle(
      lifecycle,
      (snapshot) =>
        snapshot?.status === 'READY' &&
        snapshot.generation === firstReady.generation + 1,
      secondService,
      'timer workflow resident READY generation 2',
    );
    assert.notEqual(secondReady.sessionId, firstReady.sessionId);
    const waitingSignalRun = await waitForDurableRun(
      { read: async () => await fixture.readRun(runId) },
      (snapshot) => snapshot?.workflowCursor?.disposition === 'SIGNAL_WAITING',
      secondService,
      'persisted SIGNAL_WAITING after timer fire',
    );
    assert.equal(waitingSignalRun.run.status, 'RUNNING');
    assert.equal(waitingSignalRun.timers.length, 1);
    const firedTimer = waitingSignalRun.timers[0];
    assert.equal(firedTimer.timerId, waitingTimer.timerId);
    assert.equal(firedTimer.status, 'FIRED');
    assert.equal(firedTimer.scheduledAt, waitingTimer.scheduledAt);
    assert.equal(firedTimer.dueAt, waitingTimer.dueAt);
    assert.ok(firedTimer.firedAt >= waitingTimer.dueAt);
    assert.equal(waitingSignalRun.signalWaits.length, 1);
    const waitingSignal = waitingSignalRun.signalWaits[0];
    assert.equal(waitingSignal.status, 'WAITING');
    assert.equal(waitingSignal.signalId, 'continue');
    assert.equal(
      waitingSignalRun.workflowCursor.signalWaitId,
      waitingSignal.signalWaitId,
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          await fixture.readExecutionPayload(firedTimer.outputRef),
        ),
      ),
      {
        schemaVersion: 1,
        kind: 'workflowOutput',
        value: {
          scheduledAt: firedTimer.scheduledAt,
          dueAt: firedTimer.dueAt,
          firedAt: firedTimer.firedAt,
        },
      },
    );

    const deliveryId = 'sea-timer-signal-delivery';
    const signalPayload = {
      ordinal: 2,
      markerDirectory,
      secret,
      value: 'continue-after-durable-wait',
    };
    const signalArgs = [
      'wharfie',
      'signal',
      '--run-id',
      runId,
      '--signal',
      'continue',
      '--delivery-id',
      deliveryId,
      '--payload',
      JSON.stringify(signalPayload),
      '--json',
    ];
    const acceptedText = runCommand(options.artifactPath, signalArgs, {
      cwd: options.root,
      capture: true,
      env: environment,
    }).stdout.trim();
    const accepted = parseFirstJsonLine(acceptedText);
    assert.deepEqual(accepted, {
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.signal',
      runId,
      signalId: 'continue',
      deliveryId,
      outcome: 'accepted',
      reused: false,
      runStatus: 'RUNNING',
      cursor: {
        disposition: 'ACTIVITY_RUNNABLE',
        stepId: 'second',
        stepIndex: 3,
      },
      nextActivation: { kind: 'activity' },
    });
    for (const privateValue of [secret, markerDirectory, signalPayload.value]) {
      assert.equal(acceptedText.includes(privateValue), false);
    }
    const completed = await waitForDurableRun(
      { read: async () => await fixture.readRun(runId) },
      (snapshot) =>
        snapshot?.run?.status === 'COMPLETED' &&
        snapshot.workflowCursor?.disposition === 'COMPLETED',
      secondService,
      'completed timer/signal workflow',
    );
    assert.deepEqual(await signalResidentService(secondService, 'SIGTERM'), {
      code: 0,
      signal: null,
    });
    secondService = undefined;
    const stopped = await waitForDurableLifecycle(
      lifecycle,
      (snapshot) =>
        snapshot?.status === 'STOPPED' &&
        snapshot.generation === secondReady.generation,
      'timer workflow resident STOPPED generation 2',
    );
    assert.equal(stopped.sessionId, secondReady.sessionId);
    assert.equal(await lifecycle.readOwnership(), null);
    assert.equal(existsSync(staleEndpoint), true);

    assert.equal(completed.run.version, 9);
    assert.equal(completed.run.lastSequence, 9);
    assert.deepEqual(
      completed.events.map(
        (/** @type {Record<string, any>} */ event) => event.type,
      ),
      [
        'workflow-run-created',
        'workflow-activity-claimed',
        'workflow-activity-started',
        'workflow-activity-succeeded',
        'workflow-timer-fired',
        'workflow-signal-accepted',
        'workflow-activity-claimed',
        'workflow-activity-started',
        'workflow-activity-succeeded',
      ],
    );
    assert.deepEqual(
      completed.workflowCursor.outputs.map(
        (/** @type {Record<string, any>} */ output) => ({
          stepId: output.stepId,
          stepIndex: output.stepIndex,
        }),
      ),
      [
        { stepId: 'first', stepIndex: 0 },
        { stepId: 'pause', stepIndex: 1 },
        { stepId: 'continue', stepIndex: 2 },
        { stepId: 'second', stepIndex: 3 },
      ],
    );
    assert.deepEqual(
      [...completed.invocations]
        .sort(
          (/** @type {Record<string, any>} */ left, right) =>
            left.workflow.stepIndex - right.workflow.stepIndex,
        )
        .map((/** @type {Record<string, any>} */ invocation) => ({
          stepId: invocation.workflow.stepId,
          status: invocation.status,
        })),
      [
        { stepId: 'first', status: 'COMPLETED' },
        { stepId: 'second', status: 'COMPLETED' },
      ],
    );
    assert.deepEqual(
      completed.attempts.map(
        (/** @type {Record<string, any>} */ attempt) => attempt.status,
      ),
      ['COMPLETED', 'COMPLETED'],
    );
    assert.equal(completed.timers[0].status, 'FIRED');
    assert.equal(completed.signalWaits[0].status, 'CONSUMED');
    assert.deepEqual(
      completed.signalDeliveries.map(
        (/** @type {Record<string, any>} */ delivery) => ({
          deliveryId: delivery.deliveryId,
          signalId: delivery.signalId,
          status: delivery.status,
        }),
      ),
      [{ deliveryId, signalId: 'continue', status: 'ACCEPTED' }],
    );
    const signalBinding = completed.workflowCursor.outputs.find(
      (/** @type {Record<string, any>} */ output) =>
        output.stepId === 'continue',
    );
    assert.ok(signalBinding);
    assert.equal(
      (await fixture.readExecutionPayload(signalBinding.outputRef)).value.value,
      signalPayload.value,
    );
    assert.deepEqual(
      await fixture.listReadyWork(options.appId, options.revisionId),
      [],
    );
    assert.equal(
      readPayloadReachability(payloadPath, completed).orphans.length,
      0,
    );
    assert.deepEqual(readdirSync(markerDirectory).sort(), ['1.json', '2.json']);

    const beforeReplay = JSON.parse(JSON.stringify(completed));
    const replayText = runCommand(options.artifactPath, signalArgs, {
      cwd: options.root,
      capture: true,
      env: environment,
    }).stdout.trim();
    assert.deepEqual(parseFirstJsonLine(replayText), {
      ...accepted,
      reused: true,
    });
    assert.deepEqual(await fixture.readRun(runId), beforeReplay);
    for (const privateValue of [secret, markerDirectory, signalPayload.value]) {
      assert.equal(replayText.includes(privateValue), false);
    }
    const inspectionText = runCommand(
      options.artifactPath,
      ['wharfie', 'inspect', '--run-id', runId, '--json'],
      { cwd: options.root, capture: true, env: environment },
    ).stdout.trim();
    const inspection = JSON.parse(inspectionText);
    assert.equal(inspection.run.runId, runId);
    for (const privateValue of [secret, markerDirectory, signalPayload.value]) {
      assert.equal(inspectionText.includes(privateValue), false);
    }
  } finally {
    await Promise.all([
      stopResidentServiceForCleanup(firstService),
      stopResidentServiceForCleanup(secondService),
    ]);
    if (staleEndpoint) rmSync(staleEndpoint, { force: true });
    rmSync(options.root, { recursive: true, force: true });
  }
}

/**
 * Prove public workflow start, resident execution, conservative recovery, and
 * response-loss reconciliation through one relocated SEA with no Node on PATH.
 * @param {{artifactPath: string, appId: string, cleanEnvironment: Record<string, string>, installedPackageRoot: string, revisionId: string, root: string, wharfieBin: string, appDirectory: string}} options - Matrix inputs.
 * @returns {Promise<void>} - Resolves after every exact boundary converges.
 */
async function verifyRelocatedSeaWorkflowCrashMatrix(options) {
  rmSync(options.root, { recursive: true, force: true });
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  try {
    // Source public start and packaged public replay share one stable request
    // identity. The relocated SEA then consumes that source-created run.
    const cross = await createRelocatedSeaWorkflowCase(
      options,
      'cross-surface-public-start',
    );
    try {
      rmSync(cross.controlPath, { recursive: true, force: true });
      const sourceEnvironment = {
        ...process.env,
        WHARFIE_CONTROL_ADAPTER: 'lmdb',
        WHARFIE_CONTROL_PATH: cross.controlPath,
        WHARFIE_EXECUTION_LEDGER_TABLE:
          cross.environment.WHARFIE_EXECUTION_LEDGER_TABLE,
        WHARFIE_EXECUTION_PAYLOAD_PATH: cross.payloadPath,
        WHARFIE_LEDGER_SERVICE_SESSION_PATH: cross.sessionPath,
        WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
        WHARFIE_APPLICATION_STATE_PATH: cross.applicationStatePath,
      };
      const sourceText = runCommand(
        process.execPath,
        [
          options.wharfieBin,
          'ops',
          'start',
          '--dir',
          options.appDirectory,
          ...cross.startArgs.slice(2),
        ],
        {
          cwd: cross.caseRoot,
          capture: true,
          env: sourceEnvironment,
        },
      ).stdout.trim();
      const sourceStart = parseFinalJsonLine(sourceText);
      assert.equal(sourceStart.run_id, cross.runId);
      assert.equal(sourceStart.revision, options.revisionId);
      assert.equal(sourceStart.reused, false);
      const sourceRun = await cross.fixture.readRun(cross.runId);
      assert.ok(sourceRun);
      const packagedReplay = parseFinalJsonLine(
        runCommand(options.artifactPath, cross.startArgs, {
          cwd: cross.caseRoot,
          capture: true,
          env: cross.environment,
        }).stdout,
      );
      assert.equal(packagedReplay.reused, true);
      assert.deepEqual(await cross.fixture.readRun(cross.runId), sourceRun);
      const completed = await completeSeaWorkflow(
        options,
        cross,
        'cross-surface public workflow',
      );
      await assertCompletedSeaWorkflow(options, cross, completed);
    } finally {
      rmSync(cross.caseRoot, { recursive: true, force: true });
    }

    // A moved executable can consume a runnable workflow cursor without ever
    // loading or dispatching authored activity code. Losing and retrying the
    // same public request must observe the one retained cancellation decision.
    const cancelled = await createRelocatedSeaWorkflowCase(
      options,
      'offline-cancellation',
    );
    try {
      const requestId = 'sea-workflow-offline-cancellation';
      const cancelArgs = [
        'wharfie',
        'cancel',
        '--run-id',
        cancelled.runId,
        '--request-id',
        requestId,
        '--json',
      ];
      const cancellationText = runCommand(options.artifactPath, cancelArgs, {
        cwd: cancelled.caseRoot,
        capture: true,
        env: cancelled.environment,
      }).stdout.trim();
      assert.deepEqual(parseFirstJsonLine(cancellationText), {
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.cancel',
        runId: cancelled.runId,
        requestId,
        outcome: 'cancellation-requested',
        delivery: 'not-required',
        runStatus: 'CANCELLED',
        invocationStatus: 'CANCELLED',
      });
      const cancelledRun = await cancelled.fixture.readRun(cancelled.runId);
      assert.ok(cancelledRun);
      assert.equal(cancelledRun.run.status, 'CANCELLED');
      assert.equal(cancelledRun.run.version, 2);
      assert.equal(cancelledRun.run.lastSequence, 2);
      assert.equal(cancelledRun.run.cancellationRequest.requestId, requestId);
      assert.equal(cancelledRun.workflowCursor.disposition, 'CANCELLED');
      assert.equal(cancelledRun.workflowCursor.stepId, 'first');
      assert.equal(cancelledRun.workflowCursor.stepIndex, 0);
      assert.deepEqual(cancelledRun.workflowCursor.outputs, []);
      assert.equal(cancelledRun.invocations.length, 1);
      assert.equal(cancelledRun.invocations[0].status, 'CANCELLED');
      assert.equal(
        cancelledRun.invocations[0].cancellationRequest.requestId,
        requestId,
      );
      assert.deepEqual(cancelledRun.attempts, []);
      assert.deepEqual(
        cancelledRun.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
        ['workflow-run-created', 'workflow-cancellation-requested'],
      );
      assert.deepEqual(
        await cancelled.fixture.listReadyWork(
          options.appId,
          options.revisionId,
        ),
        [],
      );
      assert.deepEqual(readdirSync(cancelled.markerDirectory), []);
      assert.equal(await cancelled.lifecycle.readOwnership(), null);
      assert.equal(
        readPayloadReachability(cancelled.payloadPath, cancelledRun).orphans
          .length,
        0,
      );
      for (const privateValue of [
        cancelled.secret,
        cancelled.callerSecret,
        cancelled.markerDirectory,
      ]) {
        assert.equal(cancellationText.includes(privateValue), false);
      }

      const replayText = runCommand(options.artifactPath, cancelArgs, {
        cwd: cancelled.caseRoot,
        capture: true,
        env: cancelled.environment,
      }).stdout.trim();
      assert.deepEqual(
        parseFirstJsonLine(replayText),
        parseFirstJsonLine(cancellationText),
      );
      assert.deepEqual(
        await cancelled.fixture.readRun(cancelled.runId),
        cancelledRun,
      );
      assert.deepEqual(readdirSync(cancelled.markerDirectory), []);
      assert.equal(await cancelled.lifecycle.readOwnership(), null);
    } finally {
      rmSync(cancelled.caseRoot, { recursive: true, force: true });
    }

    const claim = await createRelocatedSeaWorkflowCase(
      options,
      'claim-committed',
    );
    try {
      const paused = await pauseRelocatedSeaAtWorkflowBoundary(
        options.artifactPath,
        ['wharfie', 'worker'],
        {
          cwd: claim.caseRoot,
          env: claim.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow claim committed',
          target: SEA_WORKFLOW_CLAIMED_BREAKPOINT,
          expectedWorkflowDispatches: 0,
        },
      );
      const before = await claim.fixture.readRun(claim.runId);
      assert.ok(before);
      assert.equal(before.run.version, 2);
      assert.equal(before.workflowCursor.disposition, 'ACTIVITY_RUNNING');
      assert.equal(before.invocations[0].status, 'RUNNING');
      assert.equal(before.invocations[0].generation, 1);
      assert.equal(before.attempts[0].status, 'CLAIMED');
      assert.deepEqual(
        before.events.map((event) => event.type),
        ['workflow-run-created', 'workflow-activity-claimed'],
      );
      assert.equal(
        existsSync(path.join(claim.markerDirectory, '1.json')),
        false,
      );
      await killPausedWorkflowBoundary(
        paused,
        claim.lifecycle,
        claim.sessionPath,
      );
      const recovery = await runSeaWorkflowRecovery(
        options,
        claim,
        'claimed workflow recovery',
      );
      assert.deepEqual(recovery.value.recovery, {
        action: 'released-unstarted-claim',
        changed: true,
      });
      const recovered = await claim.fixture.readRun(claim.runId);
      assert.ok(recovered);
      assert.equal(recovered.run.version, 3);
      assert.equal(recovered.workflowCursor.disposition, 'ACTIVITY_RUNNABLE');
      assert.equal(recovered.invocations[0].status, 'RUNNABLE');
      assert.equal(recovered.attempts[0].status, 'ABANDONED');
      const abandonedClaimAttempt = JSON.parse(
        JSON.stringify(recovered.attempts[0]),
      );
      assert.deepEqual(
        recovered.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
        [
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-abandoned-before-start',
        ],
      );
      assert.deepEqual(
        workflowReadySummary(
          await claim.fixture.listReadyWork(options.appId, options.revisionId),
        ).map(({ kind, generation, stepId }) => ({ kind, generation, stepId })),
        [{ kind: 'ACTIVITY', generation: 1, stepId: 'first' }],
      );
      const replay = await runSeaWorkflowRecovery(
        options,
        claim,
        'claimed workflow recovery replay',
      );
      assert.deepEqual(replay.value.recovery, {
        action: 'none',
        changed: false,
      });
      assert.deepEqual(await claim.fixture.readRun(claim.runId), recovered);
      const completed = await completeSeaWorkflow(
        options,
        claim,
        'released workflow claim',
      );
      assert.deepEqual(
        completed.attempts.find(
          (/** @type {Record<string, any>} */ attempt) =>
            attempt.attemptId === abandonedClaimAttempt.attemptId,
        ),
        abandonedClaimAttempt,
      );
      await assertCompletedSeaWorkflow(options, claim, completed, {
        firstGeneration: 2,
        abandonedAttempts: 1,
        completedAttempts: 2,
        eventTypes: [
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-abandoned-before-start',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-succeeded',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-succeeded',
        ],
      });
    } finally {
      rmSync(claim.caseRoot, { recursive: true, force: true });
    }

    const started = await createRelocatedSeaWorkflowCase(
      options,
      'start-committed',
    );
    try {
      const paused = await pauseRelocatedSeaAtWorkflowBoundary(
        options.artifactPath,
        ['wharfie', 'worker'],
        {
          cwd: started.caseRoot,
          env: started.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow STARTED committed',
          target: SEA_WORKFLOW_DISPATCH_BREAKPOINT,
          expectedWorkflowDispatches: 0,
        },
      );
      const before = await started.fixture.readRun(started.runId);
      assert.ok(before);
      assert.equal(before.run.version, 3);
      assert.equal(before.workflowCursor.disposition, 'ACTIVITY_RUNNING');
      assert.equal(before.attempts[0].status, 'STARTED');
      assert.deepEqual(
        before.events.map((event) => event.type),
        [
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
        ],
      );
      assert.equal(
        existsSync(path.join(started.markerDirectory, '1.json')),
        false,
      );
      await killPausedWorkflowBoundary(
        paused,
        started.lifecycle,
        started.sessionPath,
      );
      const recovery = await runSeaWorkflowRecovery(
        options,
        started,
        'started workflow recovery',
      );
      assert.deepEqual(recovery.value.recovery, {
        action: 'marked-started-uncertain',
        changed: true,
      });
      const blocked = await started.fixture.readRun(started.runId);
      assert.ok(blocked);
      assert.equal(blocked.run.status, 'BLOCKED');
      assert.equal(blocked.run.version, 4);
      assert.equal(blocked.workflowCursor.disposition, 'ACTIVITY_UNCERTAIN');
      assert.equal(blocked.invocations[0].status, 'UNCERTAIN');
      assert.equal(blocked.attempts[0].status, 'ABANDONED');
      assert.deepEqual(
        blocked.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
        [
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-became-uncertain',
        ],
      );
      assert.deepEqual(
        await started.fixture.listReadyWork(options.appId, options.revisionId),
        [],
      );
      const previousLifecycle = await started.lifecycle.read();
      const previousGeneration = previousLifecycle?.generation ?? 0;
      const parkedWorker = spawnResidentService(options.artifactPath, {
        cwd: started.caseRoot,
        env: started.environment,
        args: ['wharfie', 'worker'],
      });
      try {
        const parkedReady = await waitForResidentLifecycle(
          started.lifecycle,
          (snapshot) =>
            snapshot?.status === 'READY' &&
            snapshot.generation === previousGeneration + 1,
          parkedWorker,
          'blocked workflow worker READY',
        );
        assert.notEqual(parkedReady.sessionId, previousLifecycle?.sessionId);
        const parkedOwnership = await started.lifecycle.readOwnership();
        assert.equal(parkedOwnership?.ownerKind, 'resident');
        assert.equal(parkedOwnership?.sessionId, parkedReady.sessionId);
        assert.equal(parkedOwnership?.appId, options.appId);
        assert.ok(
          Number.isSafeInteger(parkedOwnership?.generation) &&
            parkedOwnership.generation > 0,
        );
        await delay(250);
        assert.deepEqual(await started.fixture.readRun(started.runId), blocked);
        assert.equal(
          existsSync(path.join(started.markerDirectory, '1.json')),
          false,
        );
        assert.deepEqual(await signalResidentService(parkedWorker, 'SIGTERM'), {
          code: 0,
          signal: null,
        });
        const parkedStopped = await waitForDurableLifecycle(
          started.lifecycle,
          (snapshot) =>
            snapshot?.status === 'STOPPED' &&
            snapshot.generation === parkedReady.generation,
          'blocked workflow worker STOPPED',
        );
        assert.equal(parkedStopped.sessionId, parkedReady.sessionId);
        assert.equal(await started.lifecycle.readOwnership(), null);
      } finally {
        await stopResidentServiceForCleanup(parkedWorker);
      }
    } finally {
      rmSync(started.caseRoot, { recursive: true, force: true });
    }

    const terminal = await createRelocatedSeaWorkflowCase(
      options,
      'terminal-committed',
    );
    try {
      const paused = await pauseRelocatedSeaAtWorkflowBoundary(
        options.artifactPath,
        ['wharfie', 'worker'],
        {
          cwd: terminal.caseRoot,
          env: terminal.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow terminal committed',
          target: SEA_WORKFLOW_TERMINAL_COMMITTED_BREAKPOINT,
          expectedWorkflowDispatches: 1,
        },
      );
      const firstMarkerText = readFileSync(
        path.join(terminal.markerDirectory, '1.json'),
        'utf8',
      );
      assert.deepEqual(readdirSync(terminal.markerDirectory).sort(), [
        '1.json',
      ]);
      const before = await terminal.fixture.readRun(terminal.runId);
      assert.ok(before);
      assert.equal(before.run.version, 4);
      assert.equal(before.run.status, 'RUNNING');
      assert.equal(before.workflowCursor.disposition, 'ACTIVITY_RUNNABLE');
      assert.equal(before.workflowCursor.stepId, 'second');
      assert.deepEqual(
        before.workflowCursor.outputs.map((output) => ({
          stepId: output.stepId,
          stepIndex: output.stepIndex,
        })),
        [{ stepId: 'first', stepIndex: 0 }],
      );
      assert.deepEqual(
        [...before.invocations]
          .sort(
            (left, right) => left.workflow.stepIndex - right.workflow.stepIndex,
          )
          .map(
            (/** @type {Record<string, any>} */ invocation) =>
              invocation.status,
          ),
        ['COMPLETED', 'RUNNABLE'],
      );
      assert.deepEqual(
        before.attempts.map((attempt) => attempt.status),
        ['COMPLETED'],
      );
      assert.equal(
        readPayloadReachability(terminal.payloadPath, before).orphans.length,
        0,
      );
      await killPausedWorkflowBoundary(
        paused,
        terminal.lifecycle,
        terminal.sessionPath,
      );
      const completed = await completeSeaWorkflow(
        options,
        terminal,
        'terminal successor workflow',
      );
      assert.equal(
        readFileSync(path.join(terminal.markerDirectory, '1.json'), 'utf8'),
        firstMarkerText,
      );
      await assertCompletedSeaWorkflow(options, terminal, completed);
    } finally {
      rmSync(terminal.caseRoot, { recursive: true, force: true });
    }

    // One auxiliary pre-terminal crash retains an honestly completed authored
    // result for the public recovery/reconciliation response-loss boundaries.
    const response = await createRelocatedSeaWorkflowCase(
      options,
      'operator-response-loss',
    );
    try {
      const evidencePaused = await pauseRelocatedSeaAtWorkflowBoundary(
        options.artifactPath,
        ['wharfie', 'worker'],
        {
          cwd: response.caseRoot,
          env: response.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow terminal evidence returned',
          target: SEA_WORKFLOW_EVIDENCE_RETURNED_BREAKPOINT,
          expectedWorkflowDispatches: 1,
        },
      );
      const markerPath = path.join(response.markerDirectory, '1.json');
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
      assert.deepEqual(readdirSync(response.markerDirectory).sort(), [
        '1.json',
      ]);
      const startedBeforeRecovery = await response.fixture.readRun(
        response.runId,
      );
      assert.ok(startedBeforeRecovery);
      assert.equal(startedBeforeRecovery.run.version, 3);
      assert.equal(startedBeforeRecovery.attempts[0].status, 'STARTED');
      await killPausedWorkflowBoundary(
        evidencePaused,
        response.lifecycle,
        response.sessionPath,
      );

      const recoveryArgs = [
        'wharfie',
        'recover',
        '--run-id',
        response.runId,
        '--confirm-runner-stopped',
        '--json',
      ];
      const recoveryPaused = await pauseRelocatedSeaAtWorkflowBoundary(
        options.artifactPath,
        recoveryArgs,
        {
          cwd: response.caseRoot,
          env: response.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow recovery response returned',
          target: SEA_WORKFLOW_RECOVERY_RETURNED_BREAKPOINT,
          expectedWorkflowDispatches: 0,
        },
      );
      const blocked = await response.fixture.readRun(response.runId);
      assert.ok(blocked);
      assert.equal(blocked.run.version, 4);
      assert.equal(blocked.run.status, 'BLOCKED');
      assert.equal(blocked.workflowCursor.disposition, 'ACTIVITY_UNCERTAIN');
      const retainedAttempt = JSON.parse(JSON.stringify(blocked.attempts[0]));
      await killPausedWorkflowResponse(recoveryPaused, response.lifecycle);
      const recoveryReplay = await runSeaWorkflowRecovery(
        options,
        response,
        'workflow recovery response replay',
      );
      assert.deepEqual(recoveryReplay.value.recovery, {
        action: 'none',
        changed: false,
      });
      assert.deepEqual(await response.fixture.readRun(response.runId), blocked);
      assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), marker);

      const evidence = await response.fixture.createCompletedWorkflowEvidence(
        response.runId,
        marker.result,
      );
      const evidencePath = path.join(
        response.caseRoot,
        'workflow-evidence.json',
      );
      writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, {
        mode: 0o600,
      });
      const reconciliationId = 'sea-workflow-response-loss';
      const reconcileArgs = [
        'wharfie',
        'reconcile',
        '--run-id',
        response.runId,
        '--reconciliation-id',
        reconciliationId,
        '--evidence-file',
        evidencePath,
        '--confirm-runner-stopped',
        '--json',
      ];
      const reconciliationPaused = await pauseRelocatedSeaAtWorkflowBoundary(
        options.artifactPath,
        reconcileArgs,
        {
          cwd: response.caseRoot,
          env: response.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow reconciliation response returned',
          target: SEA_WORKFLOW_RECONCILIATION_RETURNED_BREAKPOINT,
          expectedWorkflowDispatches: 0,
        },
      );
      const reconciled = await response.fixture.readRun(response.runId);
      assert.ok(reconciled);
      assert.equal(reconciled.run.version, 5);
      assert.equal(reconciled.run.status, 'RUNNING');
      assert.equal(reconciled.workflowCursor.disposition, 'ACTIVITY_RUNNABLE');
      assert.equal(reconciled.workflowCursor.stepId, 'second');
      assert.deepEqual(reconciled.attempts, [retainedAttempt]);
      assert.deepEqual(
        reconciled.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
        [
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-became-uncertain',
          'workflow-activity-uncertainty-reconciled',
        ],
      );
      assert.deepEqual(
        workflowReadySummary(
          await response.fixture.listReadyWork(
            options.appId,
            options.revisionId,
          ),
        ).map(({ kind, generation, stepId }) => ({ kind, generation, stepId })),
        [{ kind: 'ACTIVITY', generation: 0, stepId: 'second' }],
      );
      assert.equal(
        readPayloadReachability(response.payloadPath, reconciled).orphans
          .length,
        0,
      );
      await killPausedWorkflowResponse(
        reconciliationPaused,
        response.lifecycle,
      );
      const reconciliationReplay = await runInspectorGuardedSeaJson(
        options.artifactPath,
        reconcileArgs,
        {
          cwd: response.caseRoot,
          env: response.environment,
          installedPackageRoot: options.installedPackageRoot,
          label: 'workflow reconciliation response replay',
          forbiddenTargets: [
            {
              name: 'workflow-activity-dispatch',
              target: SEA_WORKFLOW_DISPATCH_BREAKPOINT,
            },
            {
              name: 'manual-activity-dispatch',
              target: SEA_ACTIVITY_DISPATCH_BREAKPOINT,
            },
            {
              name: 'developer-cli-dispatch',
              target: SEA_APP_CLI_DISPATCH_BREAKPOINT,
            },
          ],
        },
      );
      assert.deepEqual(reconciliationReplay.value.reconciliation, {
        reconciliationId,
        changed: false,
      });
      assert.deepEqual(
        await response.fixture.readRun(response.runId),
        reconciled,
      );
      for (const privateValue of [
        response.secret,
        response.callerSecret,
        response.markerDirectory,
        retainedAttempt.fencingToken,
        marker.result.value,
      ]) {
        assert.equal(
          reconciliationReplay.serialized.includes(privateValue),
          false,
        );
      }
      const completed = await completeSeaWorkflow(
        options,
        response,
        'reconciled workflow successor',
      );
      assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), marker);
      assert.deepEqual(
        completed.attempts.find(
          (/** @type {Record<string, any>} */ attempt) =>
            attempt.attemptId === retainedAttempt.attemptId,
        ),
        retainedAttempt,
      );
      await assertCompletedSeaWorkflow(options, response, completed, {
        abandonedAttempts: 1,
        completedAttempts: 1,
        eventTypes: [
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-became-uncertain',
          'workflow-activity-uncertainty-reconciled',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-succeeded',
        ],
      });
    } finally {
      rmSync(response.caseRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(options.root, { recursive: true, force: true });
  }
}

if (!['darwin', 'linux'].includes(process.platform)) {
  throw new Error('The real package SEA smoke test requires macOS or Linux');
}
if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported SEA smoke-test architecture: ${process.arch}`);
}

// Every spawned npm/bin command must use the same exact Node binary as the SEA
// blob generator. Developer shells can otherwise resolve a newer global Node
// for an installed `#!/usr/bin/env node` bin and silently test another target.
process.env.PATH = [path.dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter);

const sourceMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
assert.equal(
  process.versions.node,
  sourceMetadata.engines.node,
  'the SEA smoke test must run under the exact repository Node version',
);

const packaged = createPackageTarball();
const installDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'wharfie-package-install-'),
);
const cleanRunDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'wharfie-generated-sea-run-'),
);

try {
  writeFileSync(
    path.join(installDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'wharfie-package-smoke',
        private: true,
        version: '0.0.0',
      },
      null,
      2,
    )}\n`,
  );

  runCommand(
    NPM_COMMAND,
    ['install', '--no-audit', '--no-fund', packaged.tarballPath],
    {
      cwd: installDirectory,
      env: {
        ...process.env,
        npm_config_cache: path.join(packaged.directory, 'npm-cache'),
      },
    },
  );

  const installedPackageRoot = path.join(
    installDirectory,
    'node_modules',
    '@wharfie',
    'wharfie',
  );
  const installedMetadata = readJson(
    path.join(installedPackageRoot, 'package.json'),
  );
  assert.equal(installedMetadata.version, sourceMetadata.version);
  const installedLmdbMetadata = readJson(
    path.join(installDirectory, 'node_modules', 'lmdb', 'package.json'),
  );

  const wharfieBin = path.join(
    installDirectory,
    'node_modules',
    '.bin',
    'wharfie',
  );
  assert.ok(
    existsSync(wharfieBin),
    `Missing installed bin link: ${wharfieBin}`,
  );

  const installedVersion = runCommand(wharfieBin, ['--version'], {
    cwd: installDirectory,
    capture: true,
  }).stdout.trim();
  assert.equal(installedVersion, installedMetadata.version);

  const appDirectory = path.join(installDirectory, 'portable-app');
  const sourceDirectory = path.join(appDirectory, 'src');
  const outputDirectory = path.join(appDirectory, 'dist');
  mkdirSync(sourceDirectory, { recursive: true });

  writeFileSync(
    path.join(appDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'wharfie-generated-sea-smoke',
        private: true,
        type: 'module',
        dependencies: {
          lmdb: installedLmdbMetadata.version,
        },
      },
      null,
      2,
    )}\n`,
  );
  runCommand(
    NPM_COMMAND,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `lmdb@${installedLmdbMetadata.version}`,
    ],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        npm_config_cache: path.join(packaged.directory, 'npm-cache'),
      },
    },
  );
  writeFileSync(
    path.join(sourceDirectory, 'activity.ts'),
    `import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { open } from 'lmdb';

type GreetInput = { name?: string };
type GreetRuntime = { caller?: { metadata?: { requestId?: string } } };
type WorkflowStepInput = {
  ordinal?: number;
  markerDirectory?: string;
  secret?: string;
};
type PersistInput = {
  key?: string;
  value?: unknown;
  crash?: {
    continuationMarkerPath: string;
    nonce: string;
    pauseAfterEffect: boolean;
  };
};
type PersistRuntime = {
  caller?: { metadata?: { requestId?: string } };
  effects: {
    request(request: {
      effectId: string;
      capability: 'application-state';
      operation: 'put-if-absent';
      input: { key: string; value: unknown };
      requestedReplayProperties: ['idempotent', 'transactional'];
    }): Promise<{ inserted: boolean }>;
  };
};

function writeDurableMarker(filePath: string, value: unknown) {
  const handle = openSync(filePath, 'wx', 0o600);
  try {
    writeFileSync(handle, JSON.stringify(value) + '\\n');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  const directory = openSync(dirname(filePath), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function waitForever() {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0);
}

export async function greet(
  input: GreetInput = {},
  runtime: GreetRuntime = {},
) {
  const dispatchMarkerPath =
    process.env.WHARFIE_SEA_VERIFIER_ACTIVITY_DISPATCH_MARKER;
  if (dispatchMarkerPath) {
    writeDurableMarker(dispatchMarkerPath, {
      kind: 'packaged-greet-activity-dispatch',
    });
  }
  const message = \`hello \${input.name || 'world'}\`;
  const database = open({
    path: './lmdb-smoke',
    eventTurnBatching: false,
    commitDelay: 0,
  });
  try {
    database.putSync('greeting', { message });
    return {
      message,
      requestId: runtime.caller?.metadata?.requestId || null,
      runtime: 'activity',
      nativeRecord: database.get('greeting'),
    };
  } finally {
    await database.close();
  }
}

export async function workflowStep(input: WorkflowStepInput = {}) {
  const ordinal = Number.isSafeInteger(input.ordinal) ? input.ordinal! : 1;
  if (ordinal < 1 || !input.markerDirectory) {
    throw new Error('workflowStep requires a positive ordinal and markerDirectory');
  }
  const result = {
    ordinal: ordinal + 1,
    markerDirectory: input.markerDirectory,
    secret: input.secret || null,
    value: 'portable-workflow-step-' + ordinal,
  };
  writeDurableMarker(join(input.markerDirectory, ordinal + '.json'), {
    kind: 'packaged-workflow-step',
    ordinal,
    executable: process.execPath,
    result,
  });
  return result;
}

export async function persistOnce(
  input: PersistInput,
  runtime: PersistRuntime,
) {
  const effect = await runtime.effects.request({
    effectId: 'persist-portable-state',
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: input.key || 'packaged-durable-key',
      value: input.value ?? null,
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  });
  if (input.crash?.pauseAfterEffect) {
    writeDurableMarker(input.crash.continuationMarkerPath, {
      kind: 'packaged-activity-continuation',
      nonce: input.crash.nonce,
      executable: process.execPath,
      effect,
    });
    waitForever();
  }
  return {
    continuedAfterEffectDelivery: true,
    effect,
    requestId: runtime.caller?.metadata?.requestId || null,
  };
}

export default greet;
`,
  );
  writeFileSync(
    path.join(sourceDirectory, 'cli.ts'),
    `import { invokeActivity } from '@wharfie/wharfie/app';

export async function main(argv: string[] = process.argv) {
  const [command, ...args] = argv.slice(2);
  if (command === 'probe-cli') {
    const [rawExitCode, ...applicationArgs] = args;
    const exitCode = Number(rawExitCode);
    if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
      throw new Error('probe-cli requires an exit code between 0 and 255');
    }

    let stdin = '';
    for await (const chunk of process.stdin) {
      stdin += String(chunk);
    }

    process.stdout.write(JSON.stringify({
      argvTail: argv.slice(2),
      applicationArgs,
      stdin,
    }) + '\\n');
    process.stderr.write('portable-stderr\\n');
    process.exitCode = exitCode;
    return;
  }

  if (command !== 'greet') {
    throw new Error("Usage: portable-app greet <name>");
  }

  const result = await invokeActivity('greet', {
    input: { name: args[0] || 'world' },
    callerMetadata: { requestId: 'portable-smoke' },
  });
  process.stdout.write(JSON.stringify(result) + '\\n');
}

export default main;
`,
  );
  writeFileSync(
    path.join(appDirectory, 'source-runner.js'),
    `import { main } from './src/cli.ts';
await main(process.argv);
`,
  );
  writeFileSync(
    path.join(appDirectory, 'wharfie.app.js'),
    `import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'portable-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activity.ts',
        export: 'greet',
      },
      externalPackages: [{
        name: 'lmdb',
        version: ${JSON.stringify(installedLmdbMetadata.version)},
      }],
    },
    'persist-once': {
      entrypoint: {
        kind: 'node',
        path: './src/activity.ts',
        export: 'persistOnce',
      },
      externalPackages: [{
        name: 'lmdb',
        version: ${JSON.stringify(installedLmdbMetadata.version)},
      }],
    },
    'workflow-step': {
      entrypoint: {
        kind: 'node',
        path: './src/activity.ts',
        export: 'workflowStep',
      },
      externalPackages: [{
        name: 'lmdb',
        version: ${JSON.stringify(installedLmdbMetadata.version)},
      }],
    },
  },
  workflows: {
    'portable-linear': {
      steps: [{
        id: 'first',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'workflow-input' },
      }, {
        id: 'second',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'step-output', step: 'first' },
      }],
    },
    'portable-timer-signal': {
      steps: [{
        id: 'first',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'workflow-input' },
      }, {
        id: 'pause',
        kind: 'timer',
        delayMs: 5_000,
      }, {
        id: 'continue',
        kind: 'signal',
      }, {
        id: 'second',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'step-output', step: 'continue' },
      }],
    },
  },
});
`,
  );

  const sourceResult = JSON.parse(
    runCommand(
      process.execPath,
      [path.join(appDirectory, 'source-runner.js'), 'greet', 'source-user'],
      { cwd: appDirectory, capture: true },
    ).stdout,
  );
  assert.deepEqual(sourceResult, {
    message: 'hello source-user',
    requestId: 'portable-smoke',
    runtime: 'activity',
    nativeRecord: { message: 'hello source-user' },
  });

  const cliProbeArgs = [
    'probe-cli',
    '23',
    'alpha',
    'two words',
    'snowman-☃',
    '',
  ];
  const cliProbeInput = 'first line\nsecond line without newline';
  const expectedCliProbe = {
    argvTail: cliProbeArgs,
    applicationArgs: cliProbeArgs.slice(2),
    stdin: cliProbeInput,
  };
  const sourceCliProbe = spawnSync(
    process.execPath,
    [path.join(appDirectory, 'source-runner.js'), ...cliProbeArgs],
    {
      cwd: appDirectory,
      encoding: 'utf8',
      env: process.env,
      input: cliProbeInput,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (sourceCliProbe.error) throw sourceCliProbe.error;
  assert.equal(sourceCliProbe.signal, null);
  assert.equal(sourceCliProbe.status, 23);
  assert.deepEqual(JSON.parse(sourceCliProbe.stdout), expectedCliProbe);
  assert.equal(sourceCliProbe.stderr, 'portable-stderr\n');

  rmSync(path.join(appDirectory, 'lmdb-smoke'), {
    recursive: true,
    force: true,
  });

  const packageOutput = runCommand(
    wharfieBin,
    [
      'app',
      'package',
      appDirectory,
      '--output-dir',
      outputDirectory,
      '--no-pretty',
    ],
    { cwd: appDirectory, capture: true },
  ).stdout;
  const packageResult = JSON.parse(
    packageOutput.trim().split('\n').filter(Boolean).at(-1),
  );
  assert.match(packageResult.revision.revisionId, /^wrv1_[A-Za-z0-9_-]{43}$/);
  assert.equal(packageResult.artifacts.length, 1);
  const packagedArtifact = packageResult.artifacts[0];
  const artifactName = packagedArtifact.fileName;
  const artifactPath = path.join(outputDirectory, artifactName);
  assert.ok(
    existsSync(artifactPath),
    `Missing generated SEA artifact: ${artifactPath}`,
  );
  assert.equal(packagedArtifact.path, artifactPath);
  assert.ok(
    existsSync(packagedArtifact.recordPath),
    `Missing generated artifact record: ${packagedArtifact.recordPath}`,
  );
  assert.deepEqual(
    readJson(packagedArtifact.recordPath),
    packagedArtifact.record,
  );

  const cleanArtifactPath = path.join(cleanRunDirectory, artifactName);
  copyFileSync(artifactPath, cleanArtifactPath);
  chmodSync(cleanArtifactPath, 0o755);

  const emptyBinDirectory = path.join(cleanRunDirectory, 'empty-bin');
  const cleanTemporaryDirectory = path.join(cleanRunDirectory, 'tmp');
  mkdirSync(emptyBinDirectory);
  mkdirSync(cleanTemporaryDirectory, { mode: 0o700 });
  const cleanEnvironment = {
    HOME: cleanRunDirectory,
    LANG: 'C.UTF-8',
    PATH: emptyBinDirectory,
    TMPDIR: cleanTemporaryDirectory,
    TZ: 'UTC',
  };
  const unavailableNode = spawnSync('node', ['--version'], {
    encoding: 'utf8',
    env: cleanEnvironment,
  });
  assert.equal(
    /** @type {NodeJS.ErrnoException | undefined} */ (unavailableNode.error)
      ?.code,
    'ENOENT',
    'Clean SEA smoke environment unexpectedly exposes a Node executable',
  );
  const operatorHelp = runCommand(cleanArtifactPath, ['wharfie', '--help'], {
    cwd: cleanRunDirectory,
    capture: true,
    env: cleanEnvironment,
  }).stdout;
  assert.match(operatorHelp, /\bretry-effect\b/);
  assert.match(operatorHelp, /\bstart\b/);
  assert.match(operatorHelp, /\bsignal\b/);
  assert.match(operatorHelp, /\bservice\b/);
  assert.match(operatorHelp, /\bdeployment\b/);
  const deploymentHelp = runCommand(
    cleanArtifactPath,
    ['wharfie', 'deployment', '--help'],
    {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    },
  ).stdout;
  assert.match(deploymentHelp, /\bplan\b/);
  assert.match(deploymentHelp, /\bapply\b/);
  assert.match(deploymentHelp, /\binspect\b/);
  assert.match(deploymentHelp, /\breconcile\b/);
  assert.match(deploymentHelp, /\bdestroy\b/);
  const deploymentPlanHelp = runCommand(
    cleanArtifactPath,
    ['wharfie', 'deployment', 'plan', '--help'],
    {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    },
  ).stdout;
  assert.doesNotMatch(deploymentPlanHelp, /--dir\b/);
  assert.doesNotMatch(deploymentPlanHelp, /--output-dir\b/);
  const serviceStatus = spawnSync(
    cleanArtifactPath,
    ['wharfie', 'service', 'status', '--json'],
    {
      cwd: cleanRunDirectory,
      encoding: 'utf8',
      env: {
        ...cleanEnvironment,
        XDG_DATA_HOME: path.join(cleanRunDirectory, 'service-data'),
        XDG_CONFIG_HOME: path.join(cleanRunDirectory, 'service-config'),
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (serviceStatus.error) throw serviceStatus.error;
  assert.equal(serviceStatus.signal, null);
  assert.equal(serviceStatus.stderr, '');
  const serviceStatusReceipt = JSON.parse(serviceStatus.stdout);
  if (serviceStatusReceipt.kind === 'wharfie.service.status') {
    assert.equal(serviceStatus.status, 0);
    assert.equal(serviceStatusReceipt.installation?.state, 'absent');
  } else {
    assert.equal(serviceStatus.status, 1);
    assert.equal(serviceStatusReceipt.kind, 'wharfie.service.error');
    assert.equal(serviceStatusReceipt.action, 'status');
  }
  const workflowStartHelp = spawnSync(
    cleanArtifactPath,
    ['wharfie', 'start', '--help'],
    {
      cwd: cleanRunDirectory,
      encoding: 'utf8',
      env: cleanEnvironment,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (workflowStartHelp.error) {
    throw workflowStartHelp.error;
  }
  assert.equal(workflowStartHelp.signal, null);
  assert.equal(workflowStartHelp.status, 0);
  for (const option of [
    '--workflow',
    '--idempotency-key',
    '--input',
    '--caller-metadata',
    '--json',
  ]) {
    assert.match(
      workflowStartHelp.stdout,
      new RegExp(`\\b${option.slice(2)}\\b`),
    );
  }
  assert.doesNotMatch(workflowStartHelp.stdout, /\bdir\b/);
  const workflowSignalHelp = spawnSync(
    cleanArtifactPath,
    ['wharfie', 'signal', '--help'],
    {
      cwd: cleanRunDirectory,
      encoding: 'utf8',
      env: cleanEnvironment,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (workflowSignalHelp.error) {
    throw workflowSignalHelp.error;
  }
  assert.equal(workflowSignalHelp.signal, null);
  assert.equal(workflowSignalHelp.status, 0);
  for (const option of [
    '--run-id',
    '--signal',
    '--delivery-id',
    '--payload',
    '--json',
  ]) {
    assert.match(
      workflowSignalHelp.stdout,
      new RegExp(`\\b${option.slice(2)}\\b`),
    );
  }
  assert.doesNotMatch(workflowSignalHelp.stdout, /\bdir\b/);
  const retryEffectHelp = spawnSync(
    cleanArtifactPath,
    ['wharfie', 'retry-effect', '--help'],
    {
      cwd: cleanRunDirectory,
      encoding: 'utf8',
      env: cleanEnvironment,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (retryEffectHelp.error) {
    throw retryEffectHelp.error;
  }
  assert.equal(retryEffectHelp.signal, null);
  assert.equal(retryEffectHelp.status, 0);
  for (const option of [
    '--run-id',
    '--effect-id',
    '--successor-id',
    '--confirm-runner-stopped',
  ]) {
    assert.match(
      retryEffectHelp.stdout,
      new RegExp(`\\b${option.slice(2)}\\b`),
    );
  }
  const generatedResult = JSON.parse(
    runCommand(cleanArtifactPath, ['greet', 'packaged-user'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.deepEqual(generatedResult, {
    message: 'hello packaged-user',
    requestId: 'portable-smoke',
    runtime: 'activity',
    nativeRecord: { message: 'hello packaged-user' },
  });

  const generatedCliProbe = spawnSync(cleanArtifactPath, cliProbeArgs, {
    cwd: cleanRunDirectory,
    encoding: 'utf8',
    env: cleanEnvironment,
    input: cliProbeInput,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (generatedCliProbe.error) throw generatedCliProbe.error;
  assert.equal(generatedCliProbe.signal, null);
  assert.equal(generatedCliProbe.status, 23);
  assert.deepEqual(JSON.parse(generatedCliProbe.stdout), expectedCliProbe);
  assert.equal(generatedCliProbe.stderr, 'portable-stderr\n');

  const embeddedManifest = JSON.parse(
    runCommand(cleanArtifactPath, ['wharfie', 'manifest', '--no-pretty'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.equal(embeddedManifest.schemaVersion, 2);
  assert.deepEqual(embeddedManifest.app, { id: 'portable-app' });
  assert.deepEqual(embeddedManifest.targets, [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
    },
  ]);
  assert.deepEqual(embeddedManifest.cli.entrypoint, {
    kind: 'node',
    path: 'src/cli.ts',
    export: 'main',
  });
  assert.equal(
    embeddedManifest.activities.greet.entrypoint.path,
    'src/activity.ts',
  );
  assert.deepEqual(embeddedManifest.activities.greet.externalPackages, [
    { name: 'lmdb', version: installedLmdbMetadata.version },
  ]);
  assert.deepEqual(embeddedManifest.activities['persist-once'], {
    entrypoint: {
      kind: 'node',
      path: 'src/activity.ts',
      export: 'persistOnce',
    },
    externalPackages: [
      { name: 'lmdb', version: installedLmdbMetadata.version },
    ],
  });
  assert.deepEqual(embeddedManifest.activities['workflow-step'], {
    entrypoint: {
      kind: 'node',
      path: 'src/activity.ts',
      export: 'workflowStep',
    },
    externalPackages: [
      { name: 'lmdb', version: installedLmdbMetadata.version },
    ],
  });
  assert.deepEqual(embeddedManifest.workflows['portable-linear'], {
    steps: [
      {
        id: 'first',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'workflow-input' },
      },
      {
        id: 'second',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'step-output', step: 'first' },
      },
    ],
  });
  assert.deepEqual(embeddedManifest.workflows['portable-timer-signal'], {
    steps: [
      {
        id: 'first',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'workflow-input' },
      },
      { id: 'pause', kind: 'timer', delayMs: 5_000 },
      { id: 'continue', kind: 'signal' },
      {
        id: 'second',
        kind: 'activity',
        activity: 'workflow-step',
        input: { kind: 'step-output', step: 'continue' },
      },
    ],
  });

  const embeddedMetadata = JSON.parse(
    runCommand(cleanArtifactPath, ['wharfie', 'metadata', '--no-pretty'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.equal(
    embeddedMetadata.revision.revisionId,
    packageResult.revision.revisionId,
  );
  assert.deepEqual(embeddedMetadata.revision, packageResult.revision);
  assert.deepEqual(embeddedMetadata.runtime.target, packagedArtifact.target);
  assert.equal(
    embeddedMetadata.runtime.revisionId,
    packagedArtifact.revisionId,
  );
  assert.equal(
    embeddedMetadata.artifact.artifactId,
    packagedArtifact.artifactId,
  );
  assert.deepEqual(
    embeddedMetadata.artifact.byteDigest,
    packagedArtifact.byteDigest,
  );
  assert.equal(embeddedMetadata.artifact.size, packagedArtifact.size);

  const controlPath = path.join(cleanRunDirectory, 'resident-control');
  const sessionPath = path.join(cleanRunDirectory, 'resident-sessions');
  const payloadPath = path.join(controlPath, 'execution-payloads');
  const applicationStatePath = path.join(
    cleanRunDirectory,
    'application-state',
  );
  const activeRecoveryProbePath = path.join(
    cleanRunDirectory,
    'active-recovery-probe-must-remain-absent',
  );
  const residentActivityDispatchMarkerPath = path.join(
    cleanRunDirectory,
    'resident-activity-dispatch-must-remain-absent.json',
  );
  const ledgerTableName = 'wharfie-package-sea-ledger-service';
  const lifecycleObserver = await createInstalledLedgerLifecycleObserver({
    installedPackageRoot,
    controlPath,
    tableName: ledgerTableName,
    appId: embeddedManifest.app.id,
  });
  const operatorEnvironment = {
    ...cleanEnvironment,
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: controlPath,
    WHARFIE_EXECUTION_LEDGER_TABLE: ledgerTableName,
    WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
    WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
    WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
  };
  const residentEnvironment = {
    ...operatorEnvironment,
    WHARFIE_RUNTIME_COMMAND: 'ledger-service',
    WHARFIE_SEA_VERIFIER_ACTIVITY_DISPATCH_MARKER:
      residentActivityDispatchMarkerPath,
  };
  const ledgerFixture = await createInstalledExecutionLedgerFixture({
    installedPackageRoot,
    controlPath,
    tableName: ledgerTableName,
    payloadPath,
    applicationStatePath,
    revisionId: packagedArtifact.revisionId,
  });
  const historicalOperatorRevisionId = `wrv1_${createHash('sha256')
    .update(
      `wharfie:sea-verifier:historical-operator-revision:v1\0${packagedArtifact.revisionId}`,
      'utf8',
    )
    .digest('base64url')}`;
  assert.notEqual(historicalOperatorRevisionId, packagedArtifact.revisionId);
  const operatorLedgerFixture = await createInstalledExecutionLedgerFixture({
    installedPackageRoot,
    controlPath,
    tableName: ledgerTableName,
    payloadPath,
    applicationStatePath,
    revisionId: historicalOperatorRevisionId,
  });
  const durableIdempotencyKey = 'packaged-durable-managed-effect';
  const durableRunId = ledgerFixture.createRunId(
    embeddedManifest.app.id,
    durableIdempotencyKey,
  );
  const durableInput = {
    key: 'packaged-durable-key',
    value: { message: 'packaged-durable-value', ordinal: 1 },
  };
  const durableCallerMetadata = {
    requestId: 'packaged-durable-request',
    channel: 'relocated-sea',
  };
  const durableRunArgs = [
    'wharfie',
    'run',
    '--activity',
    'persist-once',
    '--idempotency-key',
    durableIdempotencyKey,
    '--input',
    JSON.stringify(durableInput),
    '--caller-metadata',
    JSON.stringify(durableCallerMetadata),
    '--json',
  ];
  const firstDurableRunText = runCommand(cleanArtifactPath, durableRunArgs, {
    cwd: cleanRunDirectory,
    capture: true,
    env: operatorEnvironment,
  }).stdout.trim();
  assert.deepEqual(JSON.parse(firstDurableRunText), {
    idempotency_key: durableIdempotencyKey,
    run_id: durableRunId,
    revision: packagedArtifact.revisionId,
    activity: 'persist-once',
    status: ledgerFixture.RunStatus.COMPLETED,
    invocation_status: ledgerFixture.InvocationStatus.COMPLETED,
    attempt_generation: 1,
    attempt_status: ledgerFixture.AttemptStatus.COMPLETED,
  });
  for (const secret of [
    durableInput.key,
    durableInput.value.message,
    durableCallerMetadata.requestId,
    durableCallerMetadata.channel,
    'continuedAfterEffectDelivery',
  ]) {
    assert.equal(
      firstDurableRunText.includes(secret),
      false,
      `packaged durable-run row disclosed ${secret}`,
    );
  }

  const durableRunBeforeRetry = await ledgerFixture.readRun(durableRunId);
  assert.ok(durableRunBeforeRetry, 'packaged durable run was not retained');
  assert.deepEqual(
    {
      runId: durableRunBeforeRetry.run.runId,
      appId: durableRunBeforeRetry.run.appId,
      revisionId: durableRunBeforeRetry.run.revisionId,
      status: durableRunBeforeRetry.run.status,
      version: durableRunBeforeRetry.run.version,
    },
    {
      runId: durableRunId,
      appId: embeddedManifest.app.id,
      revisionId: packagedArtifact.revisionId,
      status: ledgerFixture.RunStatus.COMPLETED,
      version: 7,
    },
  );
  assert.deepEqual(
    durableRunBeforeRetry.invocations.map((invocation) => ({
      activityId: invocation.activityId,
      status: invocation.status,
      generation: invocation.generation,
    })),
    [
      {
        activityId: 'persist-once',
        status: ledgerFixture.InvocationStatus.COMPLETED,
        generation: 1,
      },
    ],
  );
  assert.equal(durableRunBeforeRetry.attempts.length, 1);
  assert.equal(
    durableRunBeforeRetry.attempts[0].status,
    ledgerFixture.AttemptStatus.COMPLETED,
  );
  assert.equal(durableRunBeforeRetry.attempts[0].generation, 1);
  assert.equal(durableRunBeforeRetry.effects.length, 1);
  const durableEffect = durableRunBeforeRetry.effects[0];
  assert.equal(durableEffect.effectId, 'persist-portable-state');
  assert.equal(durableEffect.status, ledgerFixture.EffectStatus.COMPLETED);
  assert.deepEqual(
    durableEffect.adapter,
    ledgerFixture.ApplicationStateAdapterDescriptor,
  );
  assert.deepEqual(durableEffect.requestedReplayProperties, [
    'idempotent',
    'transactional',
  ]);
  assert.deepEqual(durableEffect.substantiatedReplayProperties, [
    'idempotent',
    'transactional',
  ]);
  assert.deepEqual(
    {
      kind: durableEffect.destination.kind,
      namespace: durableEffect.destination.configuration.namespace,
    },
    {
      kind: 'application-state',
      namespace: embeddedManifest.app.id,
    },
  );
  const durableEventTypes = durableRunBeforeRetry.events.map(
    (event) => event.type,
  );
  assert.deepEqual(durableEventTypes, [
    'manual-run-created',
    'attempt-claimed',
    'attempt-started',
    'effect-requested',
    'effect-started',
    'effect-completed',
    'attempt-terminal',
  ]);
  const packagedActor = {
    kind: 'packaged-operator',
    id: packagedArtifact.revisionId,
  };
  const managedEffectActor = { kind: 'runtime', id: 'managed-effect' };
  assert.deepEqual(
    durableRunBeforeRetry.events.map((event) => event.actor),
    [
      packagedActor,
      packagedActor,
      packagedActor,
      managedEffectActor,
      managedEffectActor,
      managedEffectActor,
      packagedActor,
    ],
  );
  const durableEvidenceRef = durableRunBeforeRetry.attempts[0].evidenceRef;
  assert.ok(durableEvidenceRef, 'packaged durable run omitted evidence');
  const durableEvidence =
    await ledgerFixture.readExecutionPayload(durableEvidenceRef);
  assert.deepEqual(
    durableEvidence.frames.map(
      (/** @type {Record<string, any>} */ frame) => frame.type,
    ),
    ['start', 'effect-request', 'effect-result', 'completed'],
  );
  assert.equal(
    durableEvidence.frames[1].attemptId,
    durableEvidence.frames[0].attemptId,
  );
  assert.equal(
    durableEvidence.frames[2].attemptId,
    durableEvidence.frames[0].attemptId,
  );
  assert.equal(
    durableEvidence.frames[3].attemptId,
    durableEvidence.frames[0].attemptId,
  );
  assert.equal(durableEvidence.frames[1].effectId, SEA_CRASH_EFFECT_ID);
  assert.equal(durableEvidence.frames[2].effectId, SEA_CRASH_EFFECT_ID);
  assert.deepEqual(
    JSON.parse(JSON.stringify(durableEvidence.terminal.result)),
    {
      continuedAfterEffectDelivery: true,
      effect: { inserted: true },
      requestId: durableCallerMetadata.requestId,
    },
  );
  const durableReceiptBeforeRetry =
    await ledgerFixture.readApplicationStateReceipt(
      embeddedManifest.app.id,
      durableEffect.destinationEffectId,
    );
  assert.ok(
    durableReceiptBeforeRetry,
    'packaged durable effect has no receipt',
  );
  assert.deepEqual(
    {
      destinationEffectId: durableReceiptBeforeRetry.destination_effect_id,
      outcomeCode: durableReceiptBeforeRetry.outcome_code,
      inserted: durableReceiptBeforeRetry.inserted,
    },
    {
      destinationEffectId: durableEffect.destinationEffectId,
      outcomeCode: 'inserted',
      inserted: true,
    },
  );

  const secondDurableRunText = runCommand(cleanArtifactPath, durableRunArgs, {
    cwd: cleanRunDirectory,
    capture: true,
    env: operatorEnvironment,
  }).stdout.trim();
  assert.equal(secondDurableRunText, firstDurableRunText);
  assert.deepEqual(
    await ledgerFixture.readRun(durableRunId),
    durableRunBeforeRetry,
    'repeated packaged durable run changed ledger/effect history',
  );
  assert.deepEqual(
    await ledgerFixture.readApplicationStateReceipt(
      embeddedManifest.app.id,
      durableEffect.destinationEffectId,
    ),
    durableReceiptBeforeRetry,
    'repeated packaged durable run changed its destination receipt',
  );

  await verifyRelocatedSeaCrashMatrix({
    artifactPath: cleanArtifactPath,
    appId: embeddedManifest.app.id,
    cleanEnvironment,
    installedPackageRoot,
    revisionId: packagedArtifact.revisionId,
    root: path.join(cleanRunDirectory, 'managed-effect-crash-matrix'),
  });
  await verifyRelocatedSeaMixedSettlementCrashMatrix({
    artifactPath: cleanArtifactPath,
    appId: embeddedManifest.app.id,
    cleanEnvironment,
    installedPackageRoot,
    revisionId: packagedArtifact.revisionId,
    root: path.join(cleanRunDirectory, 'mixed-settlement-crash-matrix'),
  });
  await verifyRelocatedSeaEffectReconciliationCrashMatrix({
    artifactPath: cleanArtifactPath,
    appId: embeddedManifest.app.id,
    cleanEnvironment,
    installedPackageRoot,
    revisionId: packagedArtifact.revisionId,
    root: path.join(cleanRunDirectory, 'effect-reconciliation-crash-matrix'),
  });
  await verifyRelocatedSeaManagedEffectSuccessorCrashMatrix({
    artifactPath: cleanArtifactPath,
    appId: embeddedManifest.app.id,
    cleanEnvironment,
    installedPackageRoot,
    revisionId: packagedArtifact.revisionId,
    root: path.join(cleanRunDirectory, 'managed-effect-successor-crash-matrix'),
  });
  await verifyRelocatedSeaWorkflowCrashMatrix({
    artifactPath: cleanArtifactPath,
    appId: embeddedManifest.app.id,
    cleanEnvironment,
    installedPackageRoot,
    revisionId: packagedArtifact.revisionId,
    root: path.join(cleanRunDirectory, 'workflow-crash-matrix'),
    wharfieBin,
    appDirectory,
  });
  await verifyRelocatedSeaTimerSignalWorkflow({
    artifactPath: cleanArtifactPath,
    appId: embeddedManifest.app.id,
    cleanEnvironment,
    installedPackageRoot,
    revisionId: packagedArtifact.revisionId,
    root: path.join(cleanRunDirectory, 'timer-signal-workflow'),
  });

  const residentEffectBatch =
    await ledgerFixture.createApplicationStateRecoveryBatchRun(
      embeddedManifest.app.id,
      'resident-current-revision-effect-recovery',
      [
        { effectId: 'resident-pending', state: 'PENDING' },
        { effectId: 'resident-started', state: 'STARTED_ABSENT' },
      ],
    );
  const residentRunBeforeRecovery = await ledgerFixture.readRun(
    residentEffectBatch.runId,
  );
  assert.ok(residentRunBeforeRecovery);
  assert.deepEqual(
    residentRunBeforeRecovery.effects.map((effect) => effect.status),
    ['PENDING', 'STARTED'],
  );
  const residentDestinationsBeforeRecovery =
    await readManagedEffectBatchDestinations(
      ledgerFixture,
      embeddedManifest.app.id,
      residentEffectBatch,
    );
  assert.equal(existsSync(residentActivityDispatchMarkerPath), false);

  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let firstResidentService;
  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let secondResidentService;
  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let outputBlockedRecovery;
  /** @type {string | undefined} */
  let abruptlyTerminatedSessionEndpoint;
  try {
    firstResidentService = spawnResidentService(cleanArtifactPath, {
      cwd: cleanRunDirectory,
      env: residentEnvironment,
    });
    await waitForResidentControlVolume(controlPath, firstResidentService);
    const firstReady = await waitForResidentLifecycle(
      lifecycleObserver,
      (snapshot) => snapshot?.status === 'READY' && snapshot.generation === 1,
      firstResidentService,
      'READY generation 1',
    );
    assert.equal(firstReady.serviceId, lifecycleObserver.serviceId);
    assert.equal(firstReady.appId, embeddedManifest.app.id);
    assert.equal(firstReady.revisionId, packagedArtifact.revisionId);
    const firstSessionId = firstReady.sessionId;
    abruptlyTerminatedSessionEndpoint = lifecycleObserver.getSessionEndpoint(
      firstSessionId,
      sessionPath,
    );
    const firstOwnership = await lifecycleObserver.readOwnership();
    assert.equal(firstOwnership?.sessionId, firstSessionId);
    assert.equal(firstOwnership?.ownerKind, 'resident');
    assert.equal(firstOwnership?.generation, 1);

    const residentRunAfterRecovery = await waitForDurableRun(
      {
        read: async () =>
          await ledgerFixture.readRun(residentEffectBatch.runId),
      },
      (snapshot) =>
        snapshot?.events.length ===
          residentRunBeforeRecovery.events.length + 1 &&
        snapshot.events.at(-1)?.type === 'attempt-became-uncertain',
      firstResidentService,
      'atomic resident recovery of current-revision STARTED work',
    );
    assertSettledManagedEffectBatchRun(
      residentRunBeforeRecovery,
      residentRunAfterRecovery,
      residentEffectBatch,
      { kind: 'resident-recovery', id: embeddedManifest.app.id },
      undefined,
    );
    assert.deepEqual(
      await readManagedEffectBatchDestinations(
        ledgerFixture,
        embeddedManifest.app.id,
        residentEffectBatch,
      ),
      residentDestinationsBeforeRecovery,
    );
    assert.equal(existsSync(residentActivityDispatchMarkerPath), false);
    assert.equal(firstResidentService.getExit(), null);
    assert.equal((await lifecycleObserver.read())?.status, 'READY');

    const postRecoveryIdempotencyKey = 'resident-post-managed-effect-recovery';
    const postRecoveryRunId = ledgerFixture.createRunId(
      embeddedManifest.app.id,
      postRecoveryIdempotencyKey,
    );
    const postRecoverySubmit = JSON.parse(
      runCommand(
        cleanArtifactPath,
        [
          'wharfie',
          'submit',
          '--activity',
          'persist-once',
          '--idempotency-key',
          postRecoveryIdempotencyKey,
          '--input',
          JSON.stringify({
            key: 'resident-post-recovery-key',
            value: { message: 'resident worker remained usable' },
          }),
          '--caller-metadata',
          JSON.stringify({ requestId: 'resident-post-recovery-request' }),
          '--json',
        ],
        {
          cwd: cleanRunDirectory,
          capture: true,
          env: operatorEnvironment,
        },
      ).stdout,
    );
    assert.deepEqual(postRecoverySubmit, {
      idempotency_key: postRecoveryIdempotencyKey,
      run_id: postRecoveryRunId,
      revision: packagedArtifact.revisionId,
      activity: 'persist-once',
      status: ledgerFixture.RunStatus.RUNNING,
      invocation_status: ledgerFixture.InvocationStatus.RUNNABLE,
      attempt_generation: 0,
      attempt_status: '',
      reused: false,
    });
    const postRecoveryRun = await waitForDurableRun(
      { read: async () => await ledgerFixture.readRun(postRecoveryRunId) },
      (snapshot) =>
        snapshot?.run.status === ledgerFixture.RunStatus.COMPLETED &&
        snapshot.invocations[0]?.status ===
          ledgerFixture.InvocationStatus.COMPLETED &&
        snapshot.attempts[0]?.status === ledgerFixture.AttemptStatus.COMPLETED,
      firstResidentService,
      'post-recovery resident activity completion',
    );
    assert.equal(postRecoveryRun.attempts.length, 1);
    assert.equal(postRecoveryRun.attempts[0].generation, 1);
    assert.equal(postRecoveryRun.effects.length, 1);
    assert.equal(
      postRecoveryRun.effects[0].status,
      ledgerFixture.EffectStatus.COMPLETED,
    );
    assert.ok(
      await ledgerFixture.readApplicationStateReceipt(
        embeddedManifest.app.id,
        postRecoveryRun.effects[0].destinationEffectId,
      ),
    );
    assert.equal(existsSync(residentActivityDispatchMarkerPath), false);
    assert.equal(firstResidentService.getExit(), null);
    assert.equal((await lifecycleObserver.read())?.status, 'READY');

    // These runs exercise app-scoped, source-independent operator recovery for
    // historical revisions. Keeping them distinct from the resident's exact
    // embedded revision prevents the live worker from legitimately recovering
    // or dispatching verifier-injected work before the ownership assertions.
    const claimedRunId = await operatorLedgerFixture.createClaimedRun(
      embeddedManifest.app.id,
      'packaged-operator-claimed-run',
    );
    const crossAppRunId = await operatorLedgerFixture.createClaimedRun(
      'other-portable-app',
      'packaged-operator-cross-app-run',
    );
    const missingRunId = operatorLedgerFixture.createRunId(
      embeddedManifest.app.id,
      'packaged-operator-missing-run',
    );
    const recoveryEffectSpecs = (/** @type {string} */ prefix) => [
      {
        effectId: `${prefix}-01-pending`,
        state: /** @type {const} */ ('PENDING'),
      },
      {
        effectId: `${prefix}-02-receipt`,
        state: /** @type {const} */ ('STARTED_RECEIPT'),
      },
      {
        effectId: `${prefix}-03-absent`,
        state: /** @type {const} */ ('STARTED_ABSENT'),
      },
      {
        effectId: `${prefix}-04-terminal`,
        state: /** @type {const} */ ('TERMINAL'),
      },
    ];
    const sourceEffectBatch =
      await operatorLedgerFixture.createApplicationStateRecoveryBatchRun(
        embeddedManifest.app.id,
        'source-mixed-effect-recovery',
        recoveryEffectSpecs('source'),
      );
    const seaEffectBatch =
      await operatorLedgerFixture.createApplicationStateRecoveryBatchRun(
        embeddedManifest.app.id,
        'sea-mixed-effect-recovery',
        recoveryEffectSpecs('sea'),
      );
    const crashEffectIdSuffix = 'e'.repeat(470);
    const crashEffectSpecs = [
      ...Array.from(
        { length: CRASH_RECOVERY_TERMINAL_PADDING_EFFECTS },
        (_value, index) => ({
          effectId: `crash-terminal-${String(index).padStart(2, '0')}-${crashEffectIdSuffix}`,
          state: /** @type {const} */ ('TERMINAL'),
        }),
      ),
      {
        effectId: `crash-pending-${crashEffectIdSuffix}`,
        state: /** @type {const} */ ('PENDING'),
      },
      ...Array.from({ length: 15 }, (_value, index) => ({
        effectId: `crash-started-${String(index).padStart(2, '0')}-${crashEffectIdSuffix}`,
        state: /** @type {const} */ ('STARTED_ABSENT'),
      })),
    ];
    const seaCrashEffectBatch =
      await operatorLedgerFixture.createApplicationStateRecoveryBatchRun(
        embeddedManifest.app.id,
        'sea-output-backpressure-crash-recovery',
        crashEffectSpecs,
        {
          // These remain valid 500-byte opaque IDs. JSON's required control-
          // character escaping expands each public history row enough to
          // exceed ordinary Darwin/Linux child-pipe capacity with a modest
          // durable fixture.
          actor: {
            kind: '\u0001'.repeat(500),
            id: '\u0002'.repeat(500),
          },
        },
      );
    const effectRecoveryTargets = [
      {
        label: 'source mixed-effect batch',
        fixture: sourceEffectBatch,
        command: process.execPath,
        operatorPrefix: [wharfieBin, 'ops'],
        actor: { kind: 'local', id: 'cli' },
      },
      {
        label: 'SEA mixed-effect batch',
        fixture: seaEffectBatch,
        command: cleanArtifactPath,
        operatorPrefix: ['wharfie'],
        actor: {
          kind: 'packaged-operator',
          id: packagedArtifact.revisionId,
        },
      },
    ];
    const effectReceiptsBeforeRecovery = new Map();
    for (const target of effectRecoveryTargets) {
      for (const effect of target.fixture.effects) {
        const receipt = await ledgerFixture.readApplicationStateReceipt(
          embeddedManifest.app.id,
          effect.destinationEffectId,
        );
        effectReceiptsBeforeRecovery.set(effect.destinationEffectId, receipt);
        assert.equal(
          receipt !== null,
          effect.receiptPresent,
          `${target.label} ${effect.effectId} began with the wrong receipt state`,
        );
      }
    }
    const crashRunBeforeRecovery = await ledgerFixture.readRun(
      seaCrashEffectBatch.runId,
    );
    assert.ok(crashRunBeforeRecovery);
    assert.equal(
      crashRunBeforeRecovery.effects.length,
      crashEffectSpecs.length,
    );
    const crashReceiptIds = seaCrashEffectBatch.effects.map(
      (effect) => effect.destinationEffectId,
    );
    const crashReceiptsBeforeRecovery =
      await ledgerFixture.readApplicationStateReceipts(
        embeddedManifest.app.id,
        crashReceiptIds,
      );
    for (const effect of seaCrashEffectBatch.effects) {
      assert.equal(
        crashReceiptsBeforeRecovery.get(effect.destinationEffectId) !== null,
        effect.receiptPresent,
        `crash fixture ${effect.effectId} began with the wrong receipt state`,
      );
    }

    const sourceInspectionText = runCommand(
      process.execPath,
      [wharfieBin, 'ops', 'inspect', '--run-id', claimedRunId, '--json'],
      {
        cwd: cleanRunDirectory,
        capture: true,
        env: operatorEnvironment,
      },
    ).stdout.trim();
    const packagedInspectionText = runCommand(
      cleanArtifactPath,
      ['wharfie', 'inspect', '--run-id', claimedRunId, '--json'],
      {
        cwd: cleanRunDirectory,
        capture: true,
        env: operatorEnvironment,
      },
    ).stdout.trim();
    assert.deepEqual(
      JSON.parse(packagedInspectionText),
      JSON.parse(sourceInspectionText),
      'source and packaged exact-run inspection views diverged',
    );
    for (const secret of [
      'sea-input-secret',
      'sea-caller-secret',
      'sea-fencing-secret',
      'payload',
      'evidence',
      'transcript',
    ]) {
      assert.equal(
        packagedInspectionText.includes(secret),
        false,
        `packaged inspection disclosed ${secret}`,
      );
    }
    for (const target of effectRecoveryTargets) {
      const sourceEffectInspectionText = runCommand(
        process.execPath,
        [
          wharfieBin,
          'ops',
          'inspect',
          '--run-id',
          target.fixture.runId,
          '--json',
        ],
        {
          cwd: cleanRunDirectory,
          capture: true,
          env: operatorEnvironment,
        },
      ).stdout.trim();
      const seaEffectInspectionText = runCommand(
        cleanArtifactPath,
        ['wharfie', 'inspect', '--run-id', target.fixture.runId, '--json'],
        {
          cwd: cleanRunDirectory,
          capture: true,
          env: operatorEnvironment,
        },
      ).stdout.trim();
      const sourceEffectInspection = assertManagedEffectBatchInspectionView(
        sourceEffectInspectionText,
        target.fixture,
        ledgerFixture.ApplicationStateAdapterDescriptor,
      );
      const seaEffectInspection = assertManagedEffectBatchInspectionView(
        seaEffectInspectionText,
        target.fixture,
        ledgerFixture.ApplicationStateAdapterDescriptor,
      );
      assert.deepEqual(
        seaEffectInspection,
        sourceEffectInspection,
        `${target.label} source and SEA effect inspections diverged`,
      );
    }
    const crashInspectionBytes = Buffer.byteLength(
      runCommand(
        cleanArtifactPath,
        ['wharfie', 'inspect', '--run-id', seaCrashEffectBatch.runId, '--json'],
        {
          cwd: cleanRunDirectory,
          capture: true,
          env: operatorEnvironment,
        },
      ).stdout,
      'utf8',
    );
    assert.ok(
      crashInspectionBytes >= CRASH_RECOVERY_MIN_RESPONSE_BYTES,
      `crash fixture operator response is only ${crashInspectionBytes} bytes; ${CRASH_RECOVERY_MIN_RESPONSE_BYTES} bytes are required for deterministic stdout backpressure`,
    );

    for (const command of ['list']) {
      const result = spawnSync(cleanArtifactPath, ['wharfie', command], {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unknown command/i);
    }

    const missingCancellation = spawnSync(
      cleanArtifactPath,
      [
        'wharfie',
        'cancel',
        '--run-id',
        missingRunId,
        '--request-id',
        'sea-missing-cancel-request',
        '--json',
      ],
      {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      },
    );
    if (missingCancellation.error) throw missingCancellation.error;
    assert.equal(missingCancellation.status, 1);
    assert.match(
      missingCancellation.stderr,
      /cancellation refuses to create work/,
    );

    const missingInspection = spawnSync(
      cleanArtifactPath,
      ['wharfie', 'inspect', '--run-id', missingRunId, '--json'],
      {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      },
    );
    if (missingInspection.error) throw missingInspection.error;
    assert.equal(missingInspection.status, 1);
    assert.match(missingInspection.stderr, /No durable execution-ledger run/);
    const missingRecovery = spawnSync(
      cleanArtifactPath,
      [
        'wharfie',
        'recover',
        '--run-id',
        missingRunId,
        '--confirm-runner-stopped',
        '--json',
      ],
      {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      },
    );
    if (missingRecovery.error) throw missingRecovery.error;
    assert.equal(missingRecovery.status, 1);
    assert.match(missingRecovery.stderr, /refuses to create work/);
    const missingReconciliation = spawnSync(
      cleanArtifactPath,
      [
        'wharfie',
        'reconcile',
        '--run-id',
        missingRunId,
        '--reconciliation-id',
        'sea-missing-reconciliation-request',
        '--evidence-file',
        'evidence-is-not-read-for-a-missing-run.json',
        '--confirm-runner-stopped',
        '--json',
      ],
      {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      },
    );
    if (missingReconciliation.error) throw missingReconciliation.error;
    assert.equal(missingReconciliation.status, 1);
    assert.match(
      missingReconciliation.stderr,
      /reconciliation refuses to create work/,
    );
    assert.equal(await ledgerFixture.readRun(missingRunId), null);

    for (const command of ['inspect', 'recover', 'reconcile', 'cancel']) {
      const args = ['wharfie', command, '--run-id', crossAppRunId, '--json'];
      if (command === 'recover') args.push('--confirm-runner-stopped');
      if (command === 'reconcile') {
        args.push(
          '--reconciliation-id',
          'sea-cross-app-reconciliation-request',
          '--evidence-file',
          'evidence-is-not-read-for-a-cross-app-run.json',
          '--confirm-runner-stopped',
        );
      }
      if (command === 'cancel') {
        args.push('--request-id', 'sea-cross-app-cancel-request');
      }
      const result = spawnSync(cleanArtifactPath, args, {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /does not belong to packaged application/);
    }
    assert.equal(
      (await ledgerFixture.readRun(crossAppRunId))?.attempts[0].status,
      ledgerFixture.AttemptStatus.CLAIMED,
    );

    const activeRecovery = spawnSync(
      cleanArtifactPath,
      [
        'wharfie',
        'recover',
        '--run-id',
        claimedRunId,
        '--confirm-runner-stopped',
        '--json',
      ],
      {
        cwd: cleanRunDirectory,
        encoding: 'utf8',
        env: operatorEnvironment,
      },
    );
    if (activeRecovery.error) throw activeRecovery.error;
    assert.equal(activeRecovery.status, 1);
    assert.match(
      activeRecovery.stderr,
      /Local service session is already active/,
    );
    assert.equal(
      (await ledgerFixture.readRun(claimedRunId))?.attempts[0].status,
      ledgerFixture.AttemptStatus.CLAIMED,
    );

    const effectsBeforeActiveRefusal = new Map();
    for (const target of effectRecoveryTargets) {
      effectsBeforeActiveRefusal.set(
        target.fixture.runId,
        await ledgerFixture.readRun(target.fixture.runId),
      );
    }
    const activeRecoveryEnvironment = {
      ...operatorEnvironment,
      WHARFIE_APPLICATION_STATE_PATH: activeRecoveryProbePath,
    };
    for (const target of effectRecoveryTargets) {
      const refused = spawnSync(
        target.command,
        [
          ...target.operatorPrefix,
          'recover',
          '--run-id',
          target.fixture.runId,
          '--confirm-runner-stopped',
          '--json',
        ],
        {
          cwd: cleanRunDirectory,
          encoding: 'utf8',
          env: activeRecoveryEnvironment,
        },
      );
      if (refused.error) throw refused.error;
      assert.equal(refused.status, 1);
      assert.equal(refused.stdout, '');
      assert.match(
        refused.stderr,
        /Local service session is already active/,
        `${target.label} recovery did not refuse the active owner`,
      );
    }
    assert.equal(
      existsSync(activeRecoveryProbePath),
      false,
      'active-owner refusal probed or materialized application state',
    );
    for (const target of effectRecoveryTargets) {
      assert.deepEqual(
        await ledgerFixture.readRun(target.fixture.runId),
        effectsBeforeActiveRefusal.get(target.fixture.runId),
        `${target.label} active-owner refusal mutated its STARTED effect`,
      );
    }

    const firstExit = await signalResidentService(
      firstResidentService,
      'SIGKILL',
    );
    assert.equal(firstExit.code, null);
    assert.equal(firstExit.signal, 'SIGKILL');
    const afterKill = await waitForDurableLifecycle(
      lifecycleObserver,
      (snapshot) => snapshot?.status === 'READY' && snapshot.generation === 1,
      'READY generation 1 after abrupt termination',
    );
    assert.equal(afterKill.sessionId, firstSessionId);
    const staleFirstOwnership = await lifecycleObserver.readOwnership();
    assert.equal(staleFirstOwnership?.sessionId, firstSessionId);
    assert.equal(staleFirstOwnership?.ownerKind, 'resident');
    assert.equal(staleFirstOwnership?.generation, 1);
    if (process.platform !== 'win32') {
      assert.equal(
        existsSync(abruptlyTerminatedSessionEndpoint),
        true,
        'abrupt resident termination did not retain its exact Unix liveness socket',
      );
    }

    outputBlockedRecovery = spawnResidentService(cleanArtifactPath, {
      cwd: cleanRunDirectory,
      env: operatorEnvironment,
      args: [
        'wharfie',
        'recover',
        '--run-id',
        seaCrashEffectBatch.runId,
        '--confirm-runner-stopped',
        '--json',
      ],
      consumeStdout: false,
    });
    const crashRecoverySequence = crashRunBeforeRecovery.events.length + 1;
    await waitForDurableRun(
      {
        read: async () =>
          await ledgerFixture.readRun(seaCrashEffectBatch.runId),
      },
      (snapshot) =>
        snapshot?.events.length === crashRecoverySequence &&
        snapshot.events.at(-1)?.type === 'attempt-became-uncertain' &&
        snapshot.run.status === ledgerFixture.RunStatus.BLOCKED &&
        snapshot.invocations[0]?.status ===
          ledgerFixture.InvocationStatus.UNCERTAIN &&
        snapshot.attempts[0]?.status === ledgerFixture.AttemptStatus.ABANDONED,
      outputBlockedRecovery,
      'one compound managed-effect settlement',
    );
    const firstRecoveryResponseByte = await waitForPausedStdoutByte(
      outputBlockedRecovery,
    );
    assert.equal(firstRecoveryResponseByte.length, 1);
    assert.equal(firstRecoveryResponseByte.toString('utf8'), '{');
    // Mutation ownership is intentionally released before the command writes
    // its response. The crash boundary is therefore durable settlement after
    // a clean owner release, with only response delivery still in flight.
    assert.equal(await lifecycleObserver.readOwnership(), null);
    assert.equal(
      outputBlockedRecovery.getExit(),
      null,
      `Relocated SEA drained a ${crashInspectionBytes}-byte response after the verifier consumed only its first byte.`,
    );
    const outputBlockedExit = await signalResidentService(
      outputBlockedRecovery,
      'SIGKILL',
    );
    assert.equal(outputBlockedExit.code, null);
    assert.equal(outputBlockedExit.signal, 'SIGKILL');
    outputBlockedRecovery.child.stdout?.destroy();
    assert.equal(
      await lifecycleObserver.readOwnership(),
      null,
      'response-loss SIGKILL resurrected released mutation ownership',
    );

    const crashRunAfterKill = await ledgerFixture.readRun(
      seaCrashEffectBatch.runId,
    );
    assert.ok(crashRunAfterKill);
    assert.equal(
      crashRunAfterKill.events.length,
      crashRecoverySequence,
      'response-loss crash appended more than one compound recovery event',
    );
    assert.equal(
      crashRunAfterKill.events.at(-1)?.type,
      'attempt-became-uncertain',
    );
    assert.deepEqual(crashRunAfterKill.events.at(-1)?.actor, {
      kind: 'packaged-operator',
      id: packagedArtifact.revisionId,
    });
    const crashEffectsBeforeById = new Map(
      crashRunBeforeRecovery.effects.map((effect) => [effect.effectId, effect]),
    );
    const crashEffectsAfterKillById = new Map(
      crashRunAfterKill.effects.map((effect) => [effect.effectId, effect]),
    );
    const compoundRecoverySequence = crashRunAfterKill.events.at(-1).sequence;
    for (const effect of seaCrashEffectBatch.effects) {
      const before = crashEffectsBeforeById.get(effect.effectId);
      const after = crashEffectsAfterKillById.get(effect.effectId);
      assert.ok(before, `crash fixture lost pre-recovery ${effect.effectId}`);
      assert.ok(after, `crash recovery lost ${effect.effectId}`);
      assert.equal(
        after.status,
        effect.recoveredStatus || effect.initialStatus,
        `crash recovery settled ${effect.effectId} incorrectly`,
      );
      if (effect.recoveryAction) {
        assert.equal(
          after.lastSequence,
          compoundRecoverySequence,
          `crash recovery did not atomically settle ${effect.effectId}`,
        );
      } else {
        assert.deepEqual(
          after,
          before,
          `crash recovery rewrote terminal padding effect ${effect.effectId}`,
        );
      }
    }
    const crashReceiptsAfterKill =
      await ledgerFixture.readApplicationStateReceipts(
        embeddedManifest.app.id,
        crashReceiptIds,
      );
    assert.deepEqual(
      crashReceiptsAfterKill,
      crashReceiptsBeforeRecovery,
      'response-loss recovery dispatched an unresolved effect or rewrote a permanent receipt',
    );

    const repeatedCrashRecoveryText = runCommand(
      cleanArtifactPath,
      [
        'wharfie',
        'recover',
        '--run-id',
        seaCrashEffectBatch.runId,
        '--confirm-runner-stopped',
        '--json',
      ],
      {
        cwd: cleanRunDirectory,
        capture: true,
        env: operatorEnvironment,
      },
    ).stdout.trim();
    assert.ok(
      Buffer.byteLength(repeatedCrashRecoveryText, 'utf8') >=
        CRASH_RECOVERY_MIN_RESPONSE_BYTES,
      'restarted generic recovery response no longer exceeds the asserted backpressure floor',
    );
    const repeatedCrashRecovery = JSON.parse(repeatedCrashRecoveryText);
    assert.deepEqual(repeatedCrashRecovery.recovery, {
      action: 'none',
      changed: false,
    });
    assert.equal(repeatedCrashRecovery.run.status, 'BLOCKED');
    assert.equal(repeatedCrashRecovery.invocations[0].status, 'UNCERTAIN');
    assert.equal(repeatedCrashRecovery.attempts[0].status, 'ABANDONED');
    assert.equal(
      await lifecycleObserver.readOwnership(),
      null,
      'restarted recovery retained manual mutation ownership after output',
    );
    const crashRunAfterRestart = await ledgerFixture.readRun(
      seaCrashEffectBatch.runId,
    );
    assert.deepEqual(
      crashRunAfterRestart,
      crashRunAfterKill,
      'restarted packaged recovery changed durable run/effect/event truth',
    );
    assert.deepEqual(
      await ledgerFixture.readApplicationStateReceipts(
        embeddedManifest.app.id,
        crashReceiptIds,
      ),
      crashReceiptsBeforeRecovery,
      'restarted packaged recovery dispatched an unresolved effect or changed a receipt',
    );

    for (const target of effectRecoveryTargets) {
      const recoveryText = runCommand(
        target.command,
        [
          ...target.operatorPrefix,
          'recover',
          '--run-id',
          target.fixture.runId,
          '--confirm-runner-stopped',
          '--json',
        ],
        {
          cwd: cleanRunDirectory,
          capture: true,
          env: operatorEnvironment,
        },
      ).stdout.trim();
      assertManagedEffectBatchRecoveryView(recoveryText, target.fixture, {
        adapter: ledgerFixture.ApplicationStateAdapterDescriptor,
        actor: target.actor,
      });

      const durable = await ledgerFixture.readRun(target.fixture.runId);
      assert.equal(durable?.run.status, ledgerFixture.RunStatus.BLOCKED);
      assert.equal(
        durable?.invocations[0].status,
        ledgerFixture.InvocationStatus.UNCERTAIN,
      );
      assert.equal(
        durable?.attempts[0].status,
        ledgerFixture.AttemptStatus.ABANDONED,
      );
      const effectsById = new Map(
        durable?.effects.map((effect) => [effect.effectId, effect]),
      );
      const recoverySequence = durable?.events.at(-1)?.sequence;
      for (const effect of target.fixture.effects) {
        const retained = effectsById.get(effect.effectId);
        assert.ok(retained, `${target.label} lost ${effect.effectId}`);
        assert.equal(
          retained.status,
          effect.recoveredStatus || effect.initialStatus,
          `${target.label} settled ${effect.effectId} incorrectly`,
        );
        if (effect.recoveryAction) {
          assert.equal(
            retained.lastSequence,
            recoverySequence,
            `${target.label} did not settle ${effect.effectId} atomically`,
          );
        } else {
          assert.ok(
            retained.lastSequence < recoverySequence,
            `${target.label} rewrote terminal sibling ${effect.effectId}`,
          );
        }
      }
      const eventTypes = [
        ...seededManagedEffectEventTypes(target.fixture),
        'attempt-became-uncertain',
      ];
      const eventActors = [
        ...Array.from({ length: eventTypes.length - 1 }, () => ({
          kind: 'local',
          id: 'sea-verifier',
        })),
        target.actor,
      ];
      assert.deepEqual(
        durable?.events.map((/** @type {Record<string, any>} */ event) => ({
          type: event.type,
          actor: event.actor,
        })),
        eventTypes.map((type, index) => ({
          type,
          actor: eventActors[index],
        })),
        `${target.label} durable event truth diverged from its operator view`,
      );
      assert.equal(
        durable?.events.length,
        effectsBeforeActiveRefusal.get(target.fixture.runId).events.length + 1,
        `${target.label} recovery was not one compound ledger event`,
      );
      for (const effect of target.fixture.effects) {
        const durableReceipt = await ledgerFixture.readApplicationStateReceipt(
          embeddedManifest.app.id,
          effect.destinationEffectId,
        );
        assert.deepEqual(
          durableReceipt,
          effectReceiptsBeforeRecovery.get(effect.destinationEffectId),
          effect.receiptPresent
            ? `${target.label} recovery rewrote ${effect.effectId}'s permanent receipt`
            : `${target.label} recovery created a receipt for ${effect.effectId}`,
        );
      }
    }

    const packagedRecovery = JSON.parse(
      runCommand(
        cleanArtifactPath,
        [
          'wharfie',
          'recover',
          '--run-id',
          claimedRunId,
          '--confirm-runner-stopped',
          '--json',
        ],
        {
          cwd: cleanRunDirectory,
          capture: true,
          env: operatorEnvironment,
        },
      ).stdout,
    );
    assert.deepEqual(packagedRecovery.recovery, {
      action: 'released-unstarted-claim',
      changed: true,
    });
    assert.equal(packagedRecovery.run.revisionId, historicalOperatorRevisionId);
    assert.equal(
      packagedRecovery.invocations[0].status,
      ledgerFixture.InvocationStatus.RUNNABLE,
    );
    assert.equal(
      packagedRecovery.attempts[0].status,
      ledgerFixture.AttemptStatus.ABANDONED,
    );
    assert.equal(
      (await ledgerFixture.readRun(claimedRunId))?.attempts[0].status,
      ledgerFixture.AttemptStatus.ABANDONED,
    );

    secondResidentService = spawnResidentService(cleanArtifactPath, {
      cwd: cleanRunDirectory,
      env: residentEnvironment,
    });
    await waitForResidentControlVolume(controlPath, secondResidentService);
    const secondReady = await waitForResidentLifecycle(
      lifecycleObserver,
      (snapshot) => snapshot?.status === 'READY' && snapshot.generation === 2,
      secondResidentService,
      'READY generation 2 after recovery',
    );
    assert.notEqual(secondReady.sessionId, firstSessionId);
    assert.equal(secondReady.revisionId, packagedArtifact.revisionId);

    const secondExit = await signalResidentService(
      secondResidentService,
      'SIGTERM',
    );
    assert.equal(secondExit.code, 0);
    assert.equal(secondExit.signal, null);
    const stopped = await waitForDurableLifecycle(
      lifecycleObserver,
      (snapshot) => snapshot?.status === 'STOPPED' && snapshot.generation === 2,
      'STOPPED generation 2 after SIGTERM',
    );
    assert.equal(stopped.sessionId, secondReady.sessionId);
  } finally {
    await Promise.all([
      stopResidentServiceForCleanup(firstResidentService),
      stopResidentServiceForCleanup(secondResidentService),
      stopResidentServiceForCleanup(outputBlockedRecovery),
    ]);
    if (process.platform !== 'win32' && abruptlyTerminatedSessionEndpoint) {
      rmSync(abruptlyTerminatedSessionEndpoint, { force: true });
    }
  }

  if (process.platform !== 'win32' && abruptlyTerminatedSessionEndpoint) {
    assert.equal(
      existsSync(abruptlyTerminatedSessionEndpoint),
      false,
      'SEA verifier left the abruptly terminated resident socket behind',
    );
  }

  const artifactSize = statSync(cleanArtifactPath).size;
  const artifactSha256 = createHash('sha256')
    .update(readFileSync(cleanArtifactPath))
    .digest('hex');
  assert.equal(
    artifactSha256,
    Buffer.from(packagedArtifact.byteDigest.value, 'base64url').toString('hex'),
  );
  process.stdout.write(
    `Verified installed Wharfie ${installedVersion}, source and generated CLI argv/stdio/exit semantics, source CLI activity, clean generated ${process.platform} SEA activity, and relocated-SEA durable managed-effect execution/idempotent replay plus app-scoped exact-run inspection/recovery/reconciliation/cancellation command boundaries, eight-boundary relocated-SEA managed-effect SIGKILL recovery/replay without destination redispatch, three-boundary relocated-SEA mixed-settlement SIGKILL recovery/replay with exact payload reuse and no destination redispatch, four-disposition relocated-SEA effect reconciliation from a late receipt and permanent not-applied resolution with destination, payload-publication, and ledger-response SIGKILL replay and no authored app, activity, or normal adapter dispatch, six-boundary public-command relocated-SEA managed-effect successor authorization/start/destination/terminal SIGKILL recovery with response-loss replay, orphan payload reuse, inserted and already-present receipt outcomes, immutable causal source/target history, and no authored app, activity, or normal-adapter redispatch, cross-surface public workflow start/replay, offline run-level workflow cancellation, persisted timer-deadline SIGKILL/takeover plus current-wait signal acceptance and exact replay, and five-boundary relocated-SEA workflow claim/start/terminal/recovery-response/reconciliation-response SIGKILL recovery with exact linear successor authority and no authored redispatch, atomic mixed PENDING/STARTED managed-effect settlement from permanent receipt/absence evidence, live current-revision resident recovery without authored activity redispatch or process exit, relocated-SEA compound-recovery response-loss SIGKILL/restart, and durable ledger-service crash recovery with locked LMDB and Node unavailable on PATH (${artifactSize} bytes; sha256 ${artifactSha256})\n`,
  );
} finally {
  packaged.cleanup();
  rmSync(installDirectory, { recursive: true, force: true });
  rmSync(cleanRunDirectory, { recursive: true, force: true });
}
