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
      anchor: 'const view = await ledger.rebuildRun(options.runId);',
    },
    settledAtBoundary: true,
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
 * @returns {Promise<{createDestinationEffectId: (appId: string, runId: string, effectId: string) => string, createRunId: (appId: string, idempotencyKey: string) => string, createClaimedRun: (appId: string, idempotencyKey: string) => Promise<string>, createApplicationStateRecoveryBatchRun: (appId: string, idempotencyKey: string, effectSpecs: {effectId: string, state: 'PENDING'|'STARTED_RECEIPT'|'STARTED_ABSENT'|'TERMINAL'}[], fixtureOptions?: {actor?: {kind: string, id: string}}) => Promise<{runId: string, attemptId: string, storeId: string, payloadStoreId: string, effects: {effectId: string, initialStatus: string, destinationEffectId: string, requestKey: string, receiptPresent: boolean, recoveryAction?: string, recoveredStatus?: string}[], secrets: string[]}>, readApplicationStateDestination: (appId: string, destinationEffectId: string, logicalKey: string) => Promise<{receipt: Record<string, any> | null, business: Record<string, any> | null}>, readApplicationStateReceipt: (appId: string, destinationEffectId: string) => Promise<Record<string, any> | null>, readApplicationStateReceipts: (appId: string, destinationEffectIds: string[]) => Promise<Map<string, Record<string, any> | null>>, readExecutionPayload: (reference: Record<string, any>) => Promise<any>, readManagedEffectDelivery: (runId: string, effectId: string) => Promise<Record<string, any> | null>, readRun: (runId: string) => Promise<Record<string, any> | null>, ApplicationStateAdapterDescriptor: Record<string, any>, AttemptStatus: Record<string, string>, EffectStatus: Record<string, string>, InvocationStatus: Record<string, string>, RunStatus: Record<string, string>}>} - Exact-run fixture API.
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
  return {
    createDestinationEffectId: (appId, runId, effectId) =>
      ledgerContractModule.createManagedEffectDestinationId({
        appId,
        runId,
        invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
        effectId,
      }),
    createRunId,
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
        return { receipt, business };
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
    readRun: async (runId) => {
      const { db, ledger } = openLedger(true);
      try {
        return await ledger.rebuildRun(runId);
      } finally {
        await db.close();
      }
    },
    ApplicationStateAdapterDescriptor:
      applicationStateEffectModule.APPLICATION_STATE_ADAPTER_DESCRIPTOR,
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
 * @param {{runId: string, storeId: string, effects: {effectId: string, initialStatus: string, destinationEffectId: string, requestKey: string, receiptPresent: boolean, recoveryAction?: string, recoveredStatus?: string}[], secrets: string[]}} fixture - Seeded retained effect set.
 * @param {Record<string, any>} view - Parsed operator view.
 * @param {{adapter: Record<string, any>, statuses: Map<string, string>}} expected - Public effect rows.
 */
function assertManagedEffectOperatorRedaction(
  serialized,
  fixture,
  view,
  expected,
) {
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
      'fence',
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
  ]);
  assert.equal(view.schemaVersion, 4);
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
  ]);
  assert.equal(view.schemaVersion, 4);
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
 * @param {{key: string, size: number, sha256: string}} recoveredPayloadFile - Exact recovered outcome payload bytes.
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
 * @param {{readApplicationStateDestination: (appId: string, destinationEffectId: string, logicalKey: string) => Promise<{receipt: Record<string, any> | null, business: Record<string, any> | null}>}} ledgerFixture - Installed fixture reader.
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
 * Run a normally terminating moved-SEA JSON command while a source-mapped
 * breakpoints prove the physical destination adapter and its low-level write
 * entry are never entered.
 * @param {string} artifactPath - Relocated standalone SEA.
 * @param {string[]} args - Packaged command arguments.
 * @param {{cwd: string, env: Record<string, string>, installedPackageRoot: string, label: string}} options - Guard inputs.
 * @returns {Promise<{serialized: string, value: Record<string, any>}>} - Exact command response.
 */
async function runInspectorGuardedSeaJson(artifactPath, args, options) {
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
        SEA_CRASH_DESTINATION_WRITE_BREAKPOINT,
      ),
    );
    const forbiddenBreakpoints = [adapterBreakpoint, writeBreakpoint];
    const pause = inspector.waitForPause().then(
      (value) => ({ kind: 'pause', value }),
      (error) => ({ kind: 'inspector-error', error }),
    );
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
        const forbidden = forbiddenBreakpoints.find((breakpoint) => {
          const ids = new Set(
            breakpoint.breakpointIds || [breakpoint.breakpointId],
          );
          return hits.some((breakpointId) => ids.has(breakpointId));
        });
        assert.ok(
          forbidden,
          `${options.label} paused outside its physical destination guards: ${JSON.stringify(hits)}`,
        );
        assertExactInspectorPause(next.value, forbidden, options.label);
        throw residentServiceError(
          service,
          `${options.label} entered forbidden physical destination path ${forbidden.name}.`,
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
      { code: 0, signal: null },
      residentServiceError(service, `${options.label} exited unsuccessfully.`)
        .message,
    );
    return { serialized, value };
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
  assert.equal(view.schemaVersion, 4);
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
import { dirname } from 'node:path';
import { open } from 'lmdb';

type GreetInput = { name?: string };
type GreetRuntime = { caller?: { metadata?: { requestId?: string } } };
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
    unavailableNode.error?.code,
    'ENOENT',
    'Clean SEA smoke environment unexpectedly exposes a Node executable',
  );
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
  };
  const ledgerFixture = await createInstalledExecutionLedgerFixture({
    installedPackageRoot,
    controlPath,
    tableName: ledgerTableName,
    payloadPath,
    applicationStatePath,
    revisionId: packagedArtifact.revisionId,
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

    const claimedRunId = await ledgerFixture.createClaimedRun(
      embeddedManifest.app.id,
      'packaged-operator-claimed-run',
    );
    const crossAppRunId = await ledgerFixture.createClaimedRun(
      'other-portable-app',
      'packaged-operator-cross-app-run',
    );
    const missingRunId = ledgerFixture.createRunId(
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
      await ledgerFixture.createApplicationStateRecoveryBatchRun(
        embeddedManifest.app.id,
        'source-mixed-effect-recovery',
        recoveryEffectSpecs('source'),
      );
    const seaEffectBatch =
      await ledgerFixture.createApplicationStateRecoveryBatchRun(
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
      await ledgerFixture.createApplicationStateRecoveryBatchRun(
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
    assert.equal(packagedRecovery.run.revisionId, packagedArtifact.revisionId);
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
  process.stdout.write(
    `Verified installed Wharfie ${installedVersion}, source and generated CLI argv/stdio/exit semantics, source CLI activity, clean generated ${process.platform} SEA activity, and relocated-SEA durable managed-effect execution/idempotent replay plus app-scoped exact-run inspection/recovery/reconciliation/cancellation command boundaries, eight-boundary relocated-SEA managed-effect SIGKILL recovery/replay without destination redispatch, three-boundary relocated-SEA mixed-settlement SIGKILL recovery/replay with exact payload reuse and no destination redispatch, atomic mixed PENDING/STARTED managed-effect settlement from permanent receipt/absence evidence, relocated-SEA compound-recovery response-loss SIGKILL/restart, and durable ledger-service crash recovery with locked LMDB and Node unavailable on PATH (${artifactSize} bytes)\n`,
  );
} finally {
  packaged.cleanup();
  rmSync(installDirectory, { recursive: true, force: true });
  rmSync(cleanRunDirectory, { recursive: true, force: true });
}
