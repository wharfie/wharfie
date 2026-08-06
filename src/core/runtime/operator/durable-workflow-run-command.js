import { Command, InvalidArgumentError } from 'commander';

import { resolveManifestActivityExecutionIdentity } from '../app-runs.js';
import { resolveManifestWorkflowStartBinding } from '../durable-workflow-host.js';
import { LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE } from '../local-app-storage.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { createWorkflowRunId } from '../../lib/ledger/workflow-execution-contract.js';
import { LocalServiceSessionActiveError } from '../local-service-session.js';
import {
  runLocalResidentActivityService,
  startLocalDurableManifestWorkflow,
} from '../services/resident-activity-worker.js';
import {
  projectExecutionLedgerRunOutput,
  readExecutionLedgerRunOutput,
} from './execution-ledger-run-output-command.js';
import {
  projectVerifiedDurableCliInput,
  withOperatorStdoutReserved,
} from './durable-workflow-start-command.js';
import { createDurableWorkflowStartReceipt } from './durable-operation-receipt.js';
import { inspectExecutionLedgerRun } from './execution-ledger-operator.js';
import { renderTerminalSafeJson } from './terminal-safe-json.js';

const DEFAULT_POLL_INTERVAL_MS = 200;
const DEFAULT_OWNER_RETRY_INTERVAL_MS = 500;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * @typedef DurableWorkflowRunOutput
 * @property {(message: string) => void} info - Write run identity text.
 * @property {(message: string) => void} progress - Write one durable progress line.
 * @property {(message: string) => void} success - Write terminal success text.
 * @property {(value: any, rendered: string) => void} result - Write the terminal application result.
 * @property {(message: string) => void} paused - Write an interruption and resume instruction.
 * @property {(error: unknown) => void} failure - Write one safe failure.
 */

/**
 * @typedef DurableWorkflowRunExecutionHandle
 * @property {import('../durable-activity-host.js').ManifestActivityExecution} execution - Embedded immutable execution descriptor.
 * @property {() => void | Promise<void>} [cleanup] - Release execution resources.
 */

/**
 * @typedef DurableWorkflowRunProcess
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => unknown} once - Register one signal listener.
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => unknown} removeListener - Remove one signal listener.
 * @property {string} [execPath] - Packaged executable path.
 * @property {string[]} [argv] - Original packaged invocation.
 * @property {number | undefined} exitCode - Process exit status.
 */

/**
 * @typedef {(execution: import('../durable-activity-host.js').ManifestActivityExecution) => Promise<Record<string, any> | null> | Record<string, any> | null} DurableWorkflowRunCliModuleLoader
 */

/**
 * @typedef {(options: {execution: import('../durable-activity-host.js').ManifestActivityExecution, workflowId: string, idempotencyKey: string, input: any, callerMetadata: Record<string, any>, actor?: {kind: string, id: string}}) => Promise<Readonly<Record<string, any>>> | Readonly<Record<string, any>>} DurableWorkflowRunStarter
 */

/**
 * @typedef {(options: {execution: import('../durable-activity-host.js').ManifestActivityExecution, signal: AbortSignal}) => Promise<unknown> | unknown} DurableWorkflowForegroundWorker
 */

/**
 * @param {Partial<DurableWorkflowRunOutput> | undefined} provided - Optional output hooks.
 * @returns {DurableWorkflowRunOutput} - Complete human output adapter.
 */
function resolveOutput(provided) {
  return {
    info: provided?.info || ((message) => console.log(message)),
    progress: provided?.progress || ((message) => console.log(message)),
    success:
      provided?.success ||
      ((message) => {
        console.log(message);
      }),
    result:
      provided?.result ||
      ((_value, rendered) => {
        console.log(rendered);
      }),
    paused:
      provided?.paused ||
      ((message) => {
        console.log(message);
      }),
    failure:
      provided?.failure ||
      ((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
      }),
  };
}

/**
 * Parse the stable, human-selected durable identity. Restricting the display
 * name to shell-safe characters makes the printed resume command exact and
 * terminal-inert without changing the ledger's broader idempotency contract.
 * @param {string} value - Commander option value.
 * @returns {string} - Valid stable name.
 */
function parseRunName(value) {
  try {
    assertLedgerOpaqueId(value, '--name');
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error ? error.message : '--name is invalid.',
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new InvalidArgumentError(
      '--name must start with an alphanumeric character and contain only letters, numbers, dot, underscore, or dash.',
    );
  }
  return value;
}

/**
 * Render one exact shell argument without allowing terminal controls. Common
 * path/name arguments remain readable; every other byte uses ANSI-C quoting.
 * @param {string} value - Argument value.
 * @returns {string} - Shell-safe argument.
 */
function quoteShellArgument(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  const bytes = Buffer.from(value, 'utf8');
  let encoded = '';
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e && byte !== 0x27 && byte !== 0x5c) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `\\x${byte.toString(16).padStart(2, '0')}`;
    }
  }
  return `$'${encoded}'`;
}

/**
 * @param {DurableWorkflowRunProcess} processRef - Packaged process seam.
 * @param {string} name - Stable run name.
 * @param {string[]} appArgs - Original application arguments.
 * @param {Record<string, string | undefined>} environment - Foreground storage environment.
 * @returns {string} - Exact repeatable foreground command.
 */
function formatResumeCommand(processRef, name, appArgs, environment) {
  const executable =
    typeof processRef.execPath === 'string' && processRef.execPath.length > 0
      ? processRef.execPath
      : '<app>';
  const dataRoot = environment[LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE];
  const prefix =
    typeof dataRoot === 'string' && dataRoot.length > 0
      ? [
          `${LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE}=${quoteShellArgument(
            dataRoot,
          )}`,
        ]
      : [];
  return [
    ...prefix,
    ...[executable, 'wharfie', 'run', '--name', name, '--', ...appArgs].map(
      quoteShellArgument,
    ),
  ].join(' ');
}

/**
 * Remove JSON's structural string quotes while preserving terminal-safety.
 * Printable quotes and backslashes are restored as authored; JSON escapes for
 * control/format characters remain visible rather than activating a terminal.
 * @param {string} value - Application string result.
 * @returns {string} - Terminal-inert text without JSON wrapper quotes.
 */
function renderTerminalSafeString(value) {
  const rendered = renderTerminalSafeJson(value).slice(1, -1);
  return rendered.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
}

/**
 * Turn SIGINT/SIGTERM into a foreground drain request. It deliberately does
 * not call the durable cancellation API. A second signal receives the normal
 * process behavior because the one-shot listeners are removed immediately.
 * @param {Pick<DurableWorkflowRunProcess, 'once' | 'removeListener'>} processRef - Signal source.
 * @returns {{signal: AbortSignal, stop: () => void, close: () => void, requestedSignal: () => 'SIGINT'|'SIGTERM'|undefined}} - Drain handle.
 */
export function createForegroundWorkflowDrain(processRef = process) {
  const controller = new AbortController();
  /** @type {'SIGINT'|'SIGTERM'|undefined} */
  let received;

  /** Remove only the foreground drain listeners installed here. */
  function close() {
    processRef.removeListener('SIGINT', onSigint);
    processRef.removeListener('SIGTERM', onSigterm);
  }

  /** @param {'SIGINT'|'SIGTERM'} signalName - Received process signal. */
  function request(signalName) {
    received = signalName;
    close();
    controller.abort(
      Object.assign(
        new Error(`Foreground durable run drain requested with ${signalName}.`),
        {
          name: 'ForegroundDurableRunDrainRequested',
          code: 'foreground-durable-run-drain-requested',
          details: { signal: signalName },
        },
      ),
    );
  }

  /** Request a foreground drain after SIGINT. */
  function onSigint() {
    request('SIGINT');
  }

  /** Request a foreground drain after SIGTERM. */
  function onSigterm() {
    request('SIGTERM');
  }

  processRef.once('SIGINT', onSigint);
  processRef.once('SIGTERM', onSigterm);
  return {
    signal: controller.signal,
    stop: () => {
      if (!controller.signal.aborted) controller.abort();
    },
    close,
    requestedSignal: () => received,
  };
}

/**
 * Wait without keeping a foreground run alive after its drain request.
 * @param {number} milliseconds - Maximum delay.
 * @param {AbortSignal} signal - Foreground lifetime.
 * @returns {Promise<void>} - Resolves on timeout or abort.
 */
function waitForPoll(milliseconds, signal) {
  if (signal.aborted || milliseconds === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    /** Settle the wait and remove its abort listener. */
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * @param {unknown} error - Resident startup failure.
 * @returns {boolean} - Whether another healthy local resident owns the app.
 */
function isResidentAlreadyActive(error) {
  return (
    error instanceof LocalServiceSessionActiveError ||
    (error instanceof Error && error.name === 'LocalServiceSessionActiveError')
  );
}

/**
 * Keep trying to host execution while no resident owns the app. An ownership
 * conflict is the follower path, not a failure; if that resident exits before
 * the selected run completes, one waiting foreground process can take over.
 * @param {{execution: import('../durable-activity-host.js').ManifestActivityExecution, signal: AbortSignal, runWorker: DurableWorkflowForegroundWorker, retryIntervalMs: number}} options - Driver inputs.
 * @returns {Promise<void>} - Resolves only after foreground stop.
 */
async function driveOrFollow(options) {
  while (!options.signal.aborted) {
    try {
      await options.runWorker({
        execution: options.execution,
        signal: options.signal,
      });
      if (!options.signal.aborted) {
        throw new Error(
          'The foreground resident worker stopped before the durable run completed.',
        );
      }
    } catch (error) {
      if (!isResidentAlreadyActive(error)) throw error;
      if (options.signal.aborted) return;
      await waitForPoll(options.retryIntervalMs, options.signal);
      continue;
    }
    return;
  }
}

/**
 * Present one durable timer exactly once while it is the active workflow
 * cursor. On reopen, the persisted timer identity and deadline are described
 * as the same timer rather than a newly-created delay.
 * @param {{view: Record<string, any> | null, retainedTimers: Set<string>, seenTimers: Set<string>, now: () => number, output: DurableWorkflowRunOutput}} options - Timer presentation state.
 * @returns {boolean} - Whether an active timer was presented or already seen.
 */
function presentActiveTimer(options) {
  const cursor = options.view?.workflowCursor;
  if (!cursor || cursor.disposition !== 'TIMER_WAITING') return false;
  const timer = options.view?.timers?.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.timerId === cursor.timerId,
  );
  if (!timer || timer.status !== 'WAITING') return false;
  if (options.seenTimers.has(timer.timerId)) return true;
  options.seenTimers.add(timer.timerId);
  const remainingMilliseconds = Math.max(0, timer.dueAt - options.now());
  const remainingSeconds = (remainingMilliseconds / 1_000).toFixed(1);
  options.output.progress(
    `◷ ${timer.stepId} — ${
      options.retainedTimers.has(timer.timerId)
        ? 'same durable timer'
        : 'durable timer'
    }, ${remainingSeconds}s remaining`,
  );
  return true;
}

/**
 * Read, validate, and scope one run snapshot.
 * @param {{appId: string, runId: string, readRunOutput: (request: {appId: string, runId: string}) => unknown | Promise<unknown>}} options - Read request.
 * @returns {Promise<ReturnType<typeof projectExecutionLedgerRunOutput>>} - Verified projection.
 */
async function readProjectedRunOutput(options) {
  const request = { appId: options.appId, runId: options.runId };
  const raw = await options.readRunOutput(request);
  if (raw === null) {
    throw new Error(
      `Durable run ${options.runId} was accepted but its retained output snapshot is unavailable.`,
    );
  }
  return projectExecutionLedgerRunOutput(raw, request);
}

/**
 * Create the packaged-app magnetic foreground durable command. This is a
 * composite convenience path: `start` remains admission-only and `worker`
 * remains a long-lived app resident.
 * @param {{loadExecution: (options: Record<string, any>) => Promise<DurableWorkflowRunExecutionHandle> | DurableWorkflowRunExecutionHandle, loadCliModule?: DurableWorkflowRunCliModuleLoader, output?: Partial<DurableWorkflowRunOutput>, startWorkflow?: DurableWorkflowRunStarter, runWorker?: DurableWorkflowForegroundWorker, readRunOutput?: (request: {appId: string, runId: string}) => unknown | Promise<unknown>, inspectRun?: (request: {runId: string, expectedAppId: string}) => Record<string, any> | null | Promise<Record<string, any> | null>, processRef?: DurableWorkflowRunProcess, environment?: Record<string, string | undefined>, pollIntervalMs?: number, ownerRetryIntervalMs?: number, now?: () => number}} options - Packaged host seams.
 * @returns {Command} - Fresh foreground workflow command.
 */
export function createDurableWorkflowRunCommand(options) {
  if (!options || typeof options.loadExecution !== 'function') {
    throw new TypeError(
      'createDurableWorkflowRunCommand requires loadExecution.',
    );
  }
  const output = resolveOutput(options.output);
  const startWorkflow =
    options.startWorkflow || startLocalDurableManifestWorkflow;
  const runWorker = options.runWorker || runLocalResidentActivityService;
  const readRunOutput = options.readRunOutput || readExecutionLedgerRunOutput;
  const inspectRun = options.inspectRun || inspectExecutionLedgerRun;
  const now = options.now || (() => Date.now());
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function when provided.');
  }
  const processRef = /** @type {DurableWorkflowRunProcess} */ (
    options.processRef || process
  );
  const environment = options.environment || process.env;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const ownerRetryIntervalMs =
    options.ownerRetryIntervalMs ?? DEFAULT_OWNER_RETRY_INTERVAL_MS;
  for (const [label, value] of /** @type {Array<[string, number]>} */ ([
    ['pollIntervalMs', pollIntervalMs],
    ['ownerRetryIntervalMs', ownerRetryIntervalMs],
  ])) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${label} must be a nonnegative safe integer.`);
    }
  }

  const command = new Command('run').description(
    'Run or resume the app’s named durable workflow in the foreground',
  );
  command.argument(
    '[appArgs...]',
    'Application arguments for the declared durable CLI adapter',
  );
  command
    .requiredOption(
      '--name <stableName>',
      'Stable name; repeat the same command to resume this run',
      parseRunName,
    )
    .action(async (appArgs, commandOptions) => {
      /** @type {DurableWorkflowRunExecutionHandle | undefined} */
      let loaded;
      /** @type {unknown} */
      let actionError;
      /** @type {ReturnType<typeof projectExecutionLedgerRunOutput> | undefined} */
      let terminalOutput;
      /** @type {'SIGINT'|'SIGTERM'|undefined} */
      let interruptedBy;
      let runId = '';
      let appId = '';
      let resumeCommand = '';
      try {
        loaded = await options.loadExecution(commandOptions);
        if (
          !loaded ||
          typeof loaded !== 'object' ||
          Array.isArray(loaded) ||
          !loaded.execution
        ) {
          throw new TypeError(
            'Foreground workflow execution loader must return { execution, cleanup? }.',
          );
        }
        if (
          loaded.cleanup !== undefined &&
          typeof loaded.cleanup !== 'function'
        ) {
          throw new TypeError(
            'Foreground workflow execution cleanup must be a function when provided.',
          );
        }
        if (typeof options.loadCliModule !== 'function') {
          throw new TypeError(
            'This packaged application cannot load its durable CLI adapter.',
          );
        }

        const execution = loaded.execution;
        const loadCliModule = options.loadCliModule;
        const identity = resolveManifestActivityExecutionIdentity(execution);
        appId = identity.appId;
        const durableCli = identity.manifest.cli?.durable;
        if (!durableCli) {
          throw new TypeError(
            'This application does not declare cli.durable; use `wharfie start --workflow ...` for expert workflow admission.',
          );
        }
        const workflow = resolveManifestWorkflowStartBinding({
          identity,
          workflowId: durableCli.workflow,
        });
        runId = createWorkflowRunId({
          appId,
          idempotencyKey: commandOptions.name,
        });
        resumeCommand = formatResumeCommand(
          processRef,
          commandOptions.name,
          appArgs,
          environment,
        );

        const input = await withOperatorStdoutReserved(
          async () =>
            await projectVerifiedDurableCliInput({
              execution,
              moduleLike: await loadCliModule(execution),
              exportName: durableCli.export,
              appArgs,
            }),
        );
        const started = await startWorkflow({
          execution,
          workflowId: durableCli.workflow,
          idempotencyKey: commandOptions.name,
          input,
          callerMetadata: {},
          actor: {
            kind: 'packaged-foreground',
            id: identity.revisionId,
          },
        });
        const startReceipt = createDurableWorkflowStartReceipt(started, {
          runId,
          appId,
          revisionId: identity.revisionId,
          workflowId: durableCli.workflow,
          idempotencyKey: commandOptions.name,
          planId: workflow.planId,
          definition: workflow.planPayload.definition,
        });
        const reused = startReceipt.reused;
        const retainedTimers = new Set();
        const admittedTimerId = started?.outcome?.workflowCursor?.timerId;
        if (reused && typeof admittedTimerId === 'string') {
          retainedTimers.add(admittedTimerId);
        }

        output.info(
          reused
            ? `↻ Resuming ${commandOptions.name} (${runId}).`
            : `• ${appId} · new durable run ${commandOptions.name} (${runId}).`,
        );

        const drain = createForegroundWorkflowDrain(processRef);
        /** @type {unknown} */
        let driverError;
        let driver = Promise.resolve();
        const seenOutputs = new Set();
        const seenTimers = new Set();
        let waitingPrinted = false;
        try {
          const baseline = await readProjectedRunOutput({
            appId,
            runId,
            readRunOutput,
          });
          for (const step of baseline.outputs) {
            seenOutputs.add(step.stepId);
            output.progress(
              reused
                ? `✓ ${step.stepId} — retained; not run again`
                : `✓ ${step.stepId} — committed`,
            );
          }
          if (TERMINAL_STATUSES.has(baseline.snapshot.status)) {
            terminalOutput = baseline;
          }
          if (!terminalOutput && !drain.signal.aborted) {
            driver = driveOrFollow({
              execution,
              signal: drain.signal,
              runWorker,
              retryIntervalMs: ownerRetryIntervalMs,
            }).catch((error) => {
              driverError = error;
            });
            const timerPresented = presentActiveTimer({
              view: await inspectRun({ runId, expectedAppId: appId }),
              retainedTimers,
              seenTimers,
              now,
              output,
            });
            if (!waitingPrinted && !timerPresented) {
              output.progress('◷ Waiting for durable workflow progress…');
              waitingPrinted = true;
            }
          }
          while (!drain.signal.aborted && !terminalOutput) {
            if (driverError !== undefined) throw driverError;
            const current = await readProjectedRunOutput({
              appId,
              runId,
              readRunOutput,
            });
            for (const step of current.outputs) {
              if (seenOutputs.has(step.stepId)) continue;
              seenOutputs.add(step.stepId);
              output.progress(`✓ ${step.stepId} — committed`);
            }
            if (TERMINAL_STATUSES.has(current.snapshot.status)) {
              terminalOutput = current;
              break;
            }
            const timerPresented = presentActiveTimer({
              view: await inspectRun({ runId, expectedAppId: appId }),
              retainedTimers,
              seenTimers,
              now,
              output,
            });
            if (!waitingPrinted && !timerPresented) {
              output.progress('◷ Waiting for durable workflow progress…');
              waitingPrinted = true;
            }
            await waitForPoll(pollIntervalMs, drain.signal);
          }
          interruptedBy = drain.requestedSignal();
        } finally {
          drain.stop();
          await driver;
          drain.close();
        }
        if (driverError !== undefined) throw driverError;
      } catch (error) {
        actionError = error;
      } finally {
        if (typeof loaded?.cleanup === 'function') {
          try {
            await loaded.cleanup();
          } catch (cleanupError) {
            actionError = actionError
              ? new AggregateError(
                  [actionError, cleanupError],
                  'Foreground durable workflow and cleanup both failed.',
                )
              : cleanupError;
          }
        }
      }

      if (actionError) {
        output.failure(actionError);
        processRef.exitCode = 1;
        return;
      }
      if (interruptedBy) {
        output.paused(
          `Paused ${commandOptions.name} without cancelling durable work. Resume with: ${resumeCommand}`,
        );
        processRef.exitCode = interruptedBy === 'SIGINT' ? 130 : 143;
        return;
      }
      if (!terminalOutput?.terminal) {
        output.failure(
          new Error(`Durable run ${runId} stopped without a terminal result.`),
        );
        processRef.exitCode = 1;
        return;
      }
      if (terminalOutput.terminal.type !== 'completed') {
        output.failure(
          new Error(
            `Durable run ${runId} finished ${terminalOutput.snapshot.status}. Retained failure evidence is available through inspect and output.`,
          ),
        );
        processRef.exitCode = 1;
        return;
      }
      output.success(`✓ Completed ${commandOptions.name}; result retained.`);
      const result = terminalOutput.terminal.result;
      output.result(
        result,
        typeof result === 'string'
          ? renderTerminalSafeString(result)
          : renderTerminalSafeJson(result),
      );
    });

  return command;
}

export default createDurableWorkflowRunCommand;
