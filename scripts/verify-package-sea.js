import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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

const RESIDENT_SERVICE_TIMEOUT_MS = 20_000;
const RESIDENT_SERVICE_POLL_INTERVAL_MS = 50;

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
 * @param {{cwd: string, env: Record<string, string>}} options - Child process options.
 * @returns {{child: import('node:child_process').ChildProcess, exited: Promise<ResidentServiceExit>, getExit: () => ResidentServiceExit | null, getOutput: () => {stdout: string, stderr: string}}} - Resident process handle.
 */
function spawnResidentService(command, options) {
  const child = spawn(command, [], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  /** @type {ResidentServiceExit | null} */
  let exitResult = null;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-64 * 1024);
  });
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
 * Force cleanup without replacing the primary verifier error.
 * @param {{child: import('node:child_process').ChildProcess, exited: Promise<ResidentServiceExit>, getExit: () => ResidentServiceExit | null} | undefined} service - Optional resident process handle.
 * @returns {Promise<void>} - Best-effort cleanup completion.
 */
async function stopResidentServiceForCleanup(service) {
  if (!service || service.getExit()) return;
  try {
    service.child.kill('SIGKILL');
    await waitWithTimeout(
      service.exited,
      RESIDENT_SERVICE_TIMEOUT_MS,
      'resident SEA cleanup',
    );
  } catch {
    // The outer verifier error remains the useful failure. CI worker teardown
    // will reap a pathological child that ignored SIGKILL.
  }
}

/**
 * Load a host-side durable lifecycle reader from the installed tarball. The
 * observer is intentionally not part of the clean process environment; it
 * only reads the control store written by the copied standalone SEA.
 * @param {{installedPackageRoot: string, controlPath: string, tableName: string, appId: string}} options - Observer inputs.
 * @returns {Promise<{serviceId: string, read: () => Promise<Record<string, any> | null>}>} - Lifecycle observer.
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
  const serviceId = lifecycleModule.createLedgerServiceId({
    appId: options.appId,
  });
  return {
    serviceId,
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
  };
}

/**
 * Load the installed ledger implementation used to seed and observe exact-run
 * operator fixtures. The moved SEA still performs every operation under test;
 * this host helper only prepares independently verifiable durable state.
 * @param {{installedPackageRoot: string, controlPath: string, tableName: string, payloadPath: string, applicationStatePath: string, revisionId: string}} options - Installed-package fixture inputs.
 * @returns {Promise<{createRunId: (appId: string, idempotencyKey: string) => string, createClaimedRun: (appId: string, idempotencyKey: string) => Promise<string>, createStartedApplicationStateRun: (appId: string, idempotencyKey: string, effectId: string, commitReceipt: boolean) => Promise<{runId: string, effectId: string, destinationEffectId: string, storeId: string, requestKey: string, secrets: string[]}>, readApplicationStateReceipt: (appId: string, destinationEffectId: string) => Promise<Record<string, any> | null>, readRun: (runId: string) => Promise<Record<string, any> | null>, ApplicationStateAdapterDescriptor: Record<string, any>, AttemptStatus: Record<string, string>, EffectStatus: Record<string, string>, InvocationStatus: Record<string, string>, RunStatus: Record<string, string>}>} - Exact-run fixture API.
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
    applicationStateEffectModule,
    builtinCatalogModule,
  ] = await Promise.all([
    installedModule('src/core/lib/db/adapters/lmdb.js'),
    installedModule('src/core/lib/db/tables/execution-ledger.js'),
    installedModule('src/core/lib/payload-store/local.js'),
    installedModule('src/core/runtime/manual-ledger-run.js'),
    installedModule('src/core/lib/config/db.js'),
    installedModule('src/core/runtime/effects/application-state.js'),
    installedModule('src/core/runtime/effects/builtin-catalog.js'),
  ]);
  const payloadStoreId = `payload-${createHash('sha256')
    .update(path.resolve(options.payloadPath), 'utf8')
    .digest('hex')
    .slice(0, 55)}`;

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
        payloadStore: payloadModule.createLocalExecutionPayloadStore({
          path: options.payloadPath,
          storeId: payloadStoreId,
        }),
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
    /** @type {{appId: string, idempotencyKey: string, inputSecret: string, callerSecret: string, fencingToken: string}} */ seed,
  ) => {
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
      actor: { kind: 'local', id: 'sea-verifier' },
    });
    const claimed = await ledger.claimInvocation({
      runId,
      invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: seed.fencingToken,
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim:1',
      actor: { kind: 'local', id: 'sea-verifier' },
    });
    return { runId, claimed };
  };
  return {
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
    createStartedApplicationStateRun: async (
      appId,
      idempotencyKey,
      effectId,
      commitReceipt,
    ) => {
      const inputSecret = `sea-effect-input-secret-${effectId}`;
      const callerSecret = `sea-effect-caller-secret-${effectId}`;
      const fencingToken = `sea-effect-fencing-secret-${effectId}`;
      const stateSecret = `sea-application-state-secret-${effectId}`;
      const requestKey = `sea-recovery-key-${effectId}`;
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
        });
        const started = await ledger.markAttemptStarted({
          runId: seeded.runId,
          invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
          attemptId: seeded.claimed.attempt.attemptId,
          fencingToken,
          generation: seeded.claimed.attempt.generation,
          expectedVersion: seeded.claimed.run.version,
          transitionId: `start:${seeded.claimed.attempt.attemptId}`,
          actor: { kind: 'local', id: 'sea-verifier' },
        });
        const request = {
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'effect-request',
          attemptId: started.attempt.attemptId,
          sequence: 1,
          effectId,
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
          expectedVersion: started.run.version,
          transitionId: `effect-request:${effectId}`,
          request,
          adapter: adapter.descriptor,
          destination: adapter.destination,
          verifier: adapter.verifier,
          substantiatedReplayProperties: adapter.substantiatedReplayProperties,
          actor: { kind: 'local', id: 'sea-verifier' },
        });
        const effectStarted = await ledger.markManagedEffectStarted({
          runId: seeded.runId,
          invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId,
          fencingToken,
          generation: started.attempt.generation,
          expectedVersion: requested.run.version,
          expectedEffectVersion: requested.effect.version,
          transitionId: `effect-start:${effectId}`,
          actor: { kind: 'local', id: 'sea-verifier' },
        });
        if (commitReceipt) {
          await adapter.execute({
            destinationEffectId: effectStarted.effect.destinationEffectId,
            destination: adapter.destination,
            identity: {
              runId: seeded.runId,
              invocationId: manualModule.MANUAL_LEDGER_INVOCATION_ID,
              attemptId: started.attempt.attemptId,
              effectId,
            },
            request,
          });
        }
        return {
          runId: seeded.runId,
          effectId,
          destinationEffectId: effectStarted.effect.destinationEffectId,
          storeId: catalog.storeId,
          requestKey,
          secrets: [inputSecret, callerSecret, fencingToken, stateSecret],
        };
      } finally {
        await applicationDb.close();
        await db.close();
      }
    },
    readApplicationStateReceipt: async (appId, destinationEffectId) => {
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
        return await catalog.readReceipt(destinationEffectId);
      } finally {
        await applicationDb.close();
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
 * @param {{runId: string, effectId: string, destinationEffectId: string, storeId: string, requestKey: string, secrets: string[]}} fixture - Seeded retained effect.
 * @param {Record<string, any>} view - Parsed operator view.
 * @param {{adapter: Record<string, any>, effectStatus: string}} expected - Public effect row.
 */
function assertManagedEffectOperatorRedaction(
  serialized,
  fixture,
  view,
  expected,
) {
  assert.equal(view.effects.length, 1);
  assert.deepEqual(Object.keys(view.effects[0]).sort(), [
    'adapter',
    'createdAt',
    'effectId',
    'invocationId',
    'lastSequence',
    'status',
    'updatedAt',
    'version',
  ]);
  assert.equal(view.effects[0].effectId, fixture.effectId);
  assert.equal(view.effects[0].status, expected.effectStatus);
  assert.deepEqual(view.effects[0].adapter, expected.adapter);
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
    fixture.requestKey,
    fixture.destinationEffectId,
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
 * Assert source and packaged pre-recovery inspection expose the same exact
 * schema-v3 STARTED effect row without its retained request or destination.
 * @param {string} serialized - Exact CLI JSON output.
 * @param {{runId: string, effectId: string, destinationEffectId: string, storeId: string, requestKey: string, secrets: string[]}} fixture - Seeded retained effect.
 * @param {Record<string, any>} adapter - Expected public adapter descriptor.
 * @returns {Record<string, any>} - Parsed inspection view.
 */
function assertStartedManagedEffectInspectionView(
  serialized,
  fixture,
  adapter,
) {
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
  assert.equal(view.schemaVersion, 3);
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
    effectStatus: 'STARTED',
  });
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.type),
    [
      'manual-run-created',
      'attempt-claimed',
      'attempt-started',
      'effect-requested',
      'effect-started',
    ],
  );
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.actor),
    Array.from({ length: 5 }, () => ({
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
 * @param {{runId: string, effectId: string, destinationEffectId: string, storeId: string, requestKey: string, secrets: string[]}} fixture - Seeded retained effect.
 * @param {{adapter: Record<string, any>, recoveryAction: string, managedEffectAction: string, effectStatus: string, eventTypes: string[], eventActors: Record<string, any>[]}} expected - Recovery truth.
 * @returns {Record<string, any>} - Parsed recovery view.
 */
function assertManagedEffectRecoveryView(serialized, fixture, expected) {
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
  assert.equal(view.schemaVersion, 3);
  assert.equal(view.kind, 'wharfie.execution-ledger.recovery');
  assert.deepEqual(view.integrity, { verified: true });
  assert.equal(view.run.runId, fixture.runId);
  assert.equal(view.run.status, 'BLOCKED');
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].status, 'UNCERTAIN');
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].status, 'ABANDONED');
  assert.deepEqual(view.recovery, {
    action: expected.recoveryAction,
    changed: true,
    managedEffect: {
      action: expected.managedEffectAction,
      changed: true,
      effectId: fixture.effectId,
    },
  });
  assertManagedEffectOperatorRedaction(serialized, fixture, view, {
    adapter: expected.adapter,
    effectStatus: expected.effectStatus,
  });
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.type),
    expected.eventTypes,
  );
  assert.deepEqual(
    view.history.map((/** @type {Record<string, any>} */ event) => event.actor),
    expected.eventActors,
  );
  return view;
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
    `import { open } from 'lmdb';

type GreetInput = { name?: string };
type GreetRuntime = { caller?: { metadata?: { requestId?: string } } };

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
  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let firstResidentService;
  /** @type {ReturnType<typeof spawnResidentService> | undefined} */
  let secondResidentService;
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

    const ledgerFixture = await createInstalledExecutionLedgerFixture({
      installedPackageRoot,
      controlPath,
      tableName: ledgerTableName,
      payloadPath,
      applicationStatePath,
      revisionId: packagedArtifact.revisionId,
    });
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
    const sourceReceiptEffect =
      await ledgerFixture.createStartedApplicationStateRun(
        embeddedManifest.app.id,
        'source-started-effect-with-receipt',
        'source-receipt-effect',
        true,
      );
    const sourceAbsentEffect =
      await ledgerFixture.createStartedApplicationStateRun(
        embeddedManifest.app.id,
        'source-started-effect-without-receipt',
        'source-absent-effect',
        false,
      );
    const seaReceiptEffect =
      await ledgerFixture.createStartedApplicationStateRun(
        embeddedManifest.app.id,
        'sea-started-effect-with-receipt',
        'sea-receipt-effect',
        true,
      );
    const seaAbsentEffect =
      await ledgerFixture.createStartedApplicationStateRun(
        embeddedManifest.app.id,
        'sea-started-effect-without-receipt',
        'sea-absent-effect',
        false,
      );
    const effectRecoveryTargets = [
      {
        label: 'source receipt-present',
        fixture: sourceReceiptEffect,
        receiptPresent: true,
        command: process.execPath,
        operatorPrefix: [wharfieBin, 'ops'],
        actor: { kind: 'local', id: 'cli' },
      },
      {
        label: 'source strict-absent',
        fixture: sourceAbsentEffect,
        receiptPresent: false,
        command: process.execPath,
        operatorPrefix: [wharfieBin, 'ops'],
        actor: { kind: 'local', id: 'cli' },
      },
      {
        label: 'SEA receipt-present',
        fixture: seaReceiptEffect,
        receiptPresent: true,
        command: cleanArtifactPath,
        operatorPrefix: ['wharfie'],
        actor: {
          kind: 'packaged-operator',
          id: packagedArtifact.revisionId,
        },
      },
      {
        label: 'SEA strict-absent',
        fixture: seaAbsentEffect,
        receiptPresent: false,
        command: cleanArtifactPath,
        operatorPrefix: ['wharfie'],
        actor: {
          kind: 'packaged-operator',
          id: packagedArtifact.revisionId,
        },
      },
    ];
    for (const target of effectRecoveryTargets) {
      const receipt = await ledgerFixture.readApplicationStateReceipt(
        embeddedManifest.app.id,
        target.fixture.destinationEffectId,
      );
      assert.equal(
        receipt !== null,
        target.receiptPresent,
        `${target.label} fixture began with the wrong receipt state`,
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
      const sourceEffectInspection = assertStartedManagedEffectInspectionView(
        sourceEffectInspectionText,
        target.fixture,
        ledgerFixture.ApplicationStateAdapterDescriptor,
      );
      const seaEffectInspection = assertStartedManagedEffectInspectionView(
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

    const seededEffectEventTypes = [
      'manual-run-created',
      'attempt-claimed',
      'attempt-started',
      'effect-requested',
      'effect-started',
    ];
    const seededEffectEventActors = Array.from({ length: 5 }, () => ({
      kind: 'local',
      id: 'sea-verifier',
    }));
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
      const eventTypes = target.receiptPresent
        ? [
            ...seededEffectEventTypes,
            'effect-completed',
            'attempt-became-uncertain',
          ]
        : [...seededEffectEventTypes, 'effect-became-uncertain'];
      const eventActors = [
        ...seededEffectEventActors,
        target.actor,
        ...(target.receiptPresent ? [target.actor] : []),
      ];
      assertManagedEffectRecoveryView(recoveryText, target.fixture, {
        adapter: ledgerFixture.ApplicationStateAdapterDescriptor,
        recoveryAction: target.receiptPresent
          ? 'marked-started-uncertain'
          : 'none',
        managedEffectAction: target.receiptPresent
          ? 'outcome-recovered'
          : 'outcome-uncertain',
        effectStatus: target.receiptPresent
          ? ledgerFixture.EffectStatus.COMPLETED
          : ledgerFixture.EffectStatus.UNCERTAIN,
        eventTypes,
        eventActors,
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
      assert.equal(
        durable?.effects[0].status,
        target.receiptPresent
          ? ledgerFixture.EffectStatus.COMPLETED
          : ledgerFixture.EffectStatus.UNCERTAIN,
      );
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
      const durableReceipt = await ledgerFixture.readApplicationStateReceipt(
        embeddedManifest.app.id,
        target.fixture.destinationEffectId,
      );
      assert.equal(
        durableReceipt !== null,
        target.receiptPresent,
        target.receiptPresent
          ? `${target.label} recovery lost its permanent destination receipt`
          : `${target.label} recovery unexpectedly created a destination receipt`,
      );
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
    ]);
  }

  const artifactSize = statSync(cleanArtifactPath).size;
  process.stdout.write(
    `Verified installed Wharfie ${installedVersion}, source and generated CLI argv/stdio/exit semantics, source CLI activity, and clean generated ${process.platform} SEA activity plus app-scoped exact-run inspection/recovery/reconciliation/cancellation command boundaries, STARTED managed-effect receipt/absence recovery, and durable ledger-service crash recovery with locked LMDB and Node unavailable on PATH (${artifactSize} bytes)\n`,
  );
} finally {
  packaged.cleanup();
  rmSync(installDirectory, { recursive: true, force: true });
  rmSync(cleanRunDirectory, { recursive: true, force: true });
}
