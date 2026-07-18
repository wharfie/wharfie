import assert from 'node:assert/strict';
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
  const ledgerTableName = 'wharfie-package-sea-ledger-service';
  const lifecycleObserver = await createInstalledLedgerLifecycleObserver({
    installedPackageRoot,
    controlPath,
    tableName: ledgerTableName,
    appId: embeddedManifest.app.id,
  });
  const residentEnvironment = {
    ...cleanEnvironment,
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: controlPath,
    WHARFIE_EXECUTION_LEDGER_TABLE: ledgerTableName,
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
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
    `Verified installed Wharfie ${installedVersion}, source and generated CLI argv/stdio/exit semantics, source CLI activity, and clean generated ${process.platform} SEA activity plus durable ledger-service crash recovery with locked LMDB and Node unavailable on PATH (${artifactSize} bytes)\n`,
  );
} finally {
  packaged.cleanup();
  rmSync(installDirectory, { recursive: true, force: true });
  rmSync(cleanRunDirectory, { recursive: true, force: true });
}
