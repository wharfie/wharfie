/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Internal acceptance fault injection uses compact typed helpers. */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createBoundedProcessRunner } from '../src/core/runtime/bounded-process.js';
import { createDeploymentOpenSshTransport } from '../src/core/runtime/deployment-openssh-transport.js';
import { readDeploymentSshHostKey } from '../src/core/runtime/deployment-ssh-host-key.js';
import { createDeploymentSshIdentityStore } from '../src/core/runtime/deployment-ssh-identity.js';
import {
  prepareSingleNodeDeploymentReleaseUpdate,
  validateSingleNodeDeploymentJournal,
} from '../src/core/runtime/single-node-deployment-journal.js';
import {
  getSingleNodeRemoteArtifactPaths,
  validateSingleNodeRemoteServiceStatus,
} from '../src/core/runtime/single-node-remote-activation.js';
import { runLiveDeploymentProcess } from './live-deployment-package.js';

const PS_ENV = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
const MAX_OUTPUT_BYTES = 256 * 1024;
const EXIT_TIMEOUT_MS = 15_000;
export const LIVE_DEPLOYMENT_UPDATE_FAULT_STAGES = Object.freeze([
  'validate-authority',
  'read-identity',
  'read-host-pin',
  'prepare-command',
  'spawn-controller',
  'find-converge-child',
  'read-child-command',
  'pause-controller',
  'confirm-controller-paused',
  'verify-paused-journal',
  'observe-target',
  'verify-target',
  'verify-observed-journal',
  'publish-boundary',
  'kill-controller-group',
  'confirm-controller-exit',
  'verify-interrupted-journal',
  'confirm-process-group-exit',
]);
export const LIVE_DEPLOYMENT_UPDATE_FAULT_CODES = Object.freeze([
  'assertion-failed',
  'process-observation-failed',
  'controller-exited',
  'aborted',
  'deadline',
  'output-limit',
  'spawn-failed',
  'unexpected-error',
]);

/** @param {unknown} actual @param {unknown} expected */
function sameJson(actual, expected) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual)),
    JSON.parse(JSON.stringify(expected)),
  );
}

/** Read identities without collecting unrelated processes' argument strings. */
async function listProcesses() {
  const result = await runLiveDeploymentProcess({
    file: '/bin/ps',
    args: ['-ax', '-o', 'pid=,ppid=,pgid=,stat='],
    cwd: '/',
    env: PS_ENV,
    timeoutMs: 5000,
    phase: 'update-process-observation',
  });
  assert.ok(Buffer.byteLength(result.stdout) <= 1024 * 1024);
  return result.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const match =
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z+<NsLslWXI-]+)\s*$/.exec(line);
      assert.ok(match, 'Controller process observation was malformed.');
      return {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        groupId: Number(match[3]),
        state: match[4],
      };
    });
}

/** Read only one already-owned direct child's command; never retain it. @param {number} pid */
async function readProcessCommand(pid) {
  const result = await runLiveDeploymentProcess({
    file: '/bin/ps',
    args: ['-ww', '-p', String(pid), '-o', 'command='],
    cwd: '/',
    env: PS_ENV,
    timeoutMs: 5000,
    phase: 'update-child-observation',
  }).catch((error) => {
    // A short-lived SSH child can disappear between the two read-only probes.
    if (error?.diagnostic?.status === 1) return null;
    throw error;
  });
  if (result === null) return null;
  assert.ok(Buffer.byteLength(result.stdout) <= MAX_OUTPUT_BYTES);
  return result.stdout.trim();
}

/**
 * Hold the submitting controller immediately after its exact target-converge
 * SSH child starts. SIGSTOP affects only our controller, so that child can
 * finish the production guest operation while the local journal cannot settle.
 * After independent pinned observation proves the target healthy, SIGKILL the
 * entire owned group and wait for its exit before returning recovery authority.
 * No shipped operator code, executable bytes, SSH options, or journal files are
 * patched to create this guest-active / controller-unsettled fault boundary.
 * @param {Record<string, any>} options
 * @param {Record<string, any>} [dependencies]
 */
export async function interruptLiveDeploymentUpdate(
  options,
  dependencies = {},
) {
  const started = performance.now();
  const diagnostic = {
    phase: 'update-controller-interruption',
    command: 'packaged-app',
    durationMs: 0,
    status: /** @type {number|null} */ (null),
    signal: /** @type {string|null} */ (null),
    timedOut: false,
    aborted: false,
    outputLimitExceeded: false,
    spawnError: false,
    controllerPaused: false,
    controllerExitConfirmed: false,
    faultStage: 'validate-authority',
    faultCode: /** @type {string|null} */ (null),
  };
  /** @type {import('node:child_process').ChildProcess|undefined} */
  let child;
  let closed = false;
  let exited = false;
  let unexpectedExit = false;
  let killed = false;
  let outputBytes = 0;
  let failureReason = false;
  const observationAbort = new AbortController();
  /** @type {(error: Error) => void} */
  let rejectInterrupted;
  const interrupted = new Promise((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  // A fault can happen between bounded awaits. The next race still receives it.
  interrupted.catch(() => undefined);
  const interrupt = () => {
    observationAbort.abort();
    rejectInterrupted(
      new Error('The owned update controller was interrupted.'),
    );
  };
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let deadlineTimer;
  const signalProcess =
    dependencies.signalProcess ?? process.kill.bind(process);
  /** The PID/group comes only from this live, unreaped child process. */
  const killGroup = () => {
    if (!child?.pid || closed || killed) return;
    killed = true;
    try {
      signalProcess(-child.pid, 'SIGKILL');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH')
        failureReason = true;
    }
  };
  const abort = () => {
    diagnostic.aborted = true;
    failureReason = true;
    interrupt();
    killGroup();
  };
  /** @type {Promise<void>|undefined} */
  let completion;
  try {
    assert.ok(['darwin', 'linux'].includes(process.platform));
    for (const name of ['executable', 'cwd', 'dataRoot']) {
      assert.ok(
        typeof options[name] === 'string' && path.isAbsolute(options[name]),
      );
    }
    assert.ok(options.env && typeof options.env === 'object');
    assert.equal(typeof options.readJournal, 'function');
    assert.equal(typeof options.observeTarget, 'function');
    if (options.signal?.aborted) abort();
    assert.ok(!failureReason);
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    assert.ok(
      Number.isSafeInteger(timeoutMs) &&
        timeoutMs > 0 &&
        timeoutMs <= 30 * 60 * 1000,
    );
    const prior = validateSingleNodeDeploymentJournal(options.journal);
    assert.equal(prior.phase, 'active');
    assert.equal(prior.release.transition, null);
    assert.ok(prior.release.current?.activation && prior.sshHost);
    const pending = prepareSingleNodeDeploymentReleaseUpdate(
      prior,
      options.targetDesired,
    );
    assert.ok(pending.release.transition);
    const target = pending.release.transition.target.desired;
    sameJson(await options.readJournal(), prior);
    diagnostic.faultStage = 'read-identity';
    const identity = await (
      dependencies.readIdentity ??
      (async () =>
        await createDeploymentSshIdentityStore({
          root: path.join(options.dataRoot, 'single-node-deployment-ssh', 'v1'),
          runProcess: createBoundedProcessRunner(),
        }).readIdentity({
          deploymentInstanceId: prior.deploymentInstanceId,
          incarnationId: prior.incarnationId,
        }))
    )();
    assert.equal(
      identity.publicKeyFingerprint,
      prior.release.current.activation.bootstrap.sshPublicKeyFingerprint,
    );
    diagnostic.faultStage = 'read-host-pin';
    sameJson(
      await (dependencies.readHostKey ?? readDeploymentSshHostKey)({
        address: prior.sshHost.address,
        knownHostsPath: identity.knownHostsPath,
      }),
      prior.sshHost,
    );
    // Obtain exact production SSH argv without making a connection.
    diagnostic.faultStage = 'prepare-command';
    let expectedCommand = '';
    const transport = (
      dependencies.createTransport ?? createDeploymentOpenSshTransport
    )({
      address: prior.sshHost.address,
      privateKeyPath: identity.privateKeyPath,
      knownHostsPath: identity.knownHostsPath,
      runProcess: {
        async run(/** @type {unknown} */ request) {
          const input = /** @type {Record<string, any>} */ (request);
          expectedCommand = [input.file, ...input.args].join(' ');
          return {
            status: 'exited',
            exitCode: 0,
            signal: null,
            timedOut: false,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
          };
        },
      },
    });
    await transport.runRemoteArgv({
      argv: [
        getSingleNodeRemoteArtifactPaths(target, prior.incarnationId)
          .remoteArtifactPath,
        'wharfie',
        'service',
        'converge',
        '--json',
      ],
      stdin: null,
      timeoutMilliseconds: 600_000,
      maximumStdoutBytes: MAX_OUTPUT_BYTES,
      maximumStderrBytes: 16 * 1024,
    });
    assert.ok(expectedCommand.startsWith('/usr/bin/ssh '));
    if (options.signal?.aborted) abort();
    assert.ok(!failureReason);
    diagnostic.faultStage = 'spawn-controller';
    child = (dependencies.spawn ?? spawn)(
      options.executable,
      [
        'wharfie',
        'deployment',
        'update',
        '--deployment-instance',
        prior.deploymentInstanceId,
        '--data-root',
        options.dataRoot,
        '--json',
      ],
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.ok(child);
    const controller = child;
    completion = new Promise((resolve) => {
      controller.once('exit', (status, signal) => {
        exited = true;
        diagnostic.status = status;
        diagnostic.signal = signal;
        if (!killed) {
          unexpectedExit = true;
          interrupt();
        }
        // Reap inherited SSH pipe holders even on unexpected early exit.
        killGroup();
      });
      controller.once('close', () => {
        closed = true;
        diagnostic.controllerExitConfirmed = true;
        resolve();
      });
      controller.once('error', () => {
        diagnostic.spawnError = true;
        failureReason = true;
        interrupt();
        killGroup();
      });
    });
    assert.ok(controller.pid && controller.stdout && controller.stderr);
    const pid = controller.pid;
    /** Discard raw output, retaining only a bounded byte count. @param {Buffer} chunk */
    const collect = (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        diagnostic.outputLimitExceeded = true;
        failureReason = true;
        interrupt();
        killGroup();
      }
    };
    controller.stdout.on('data', collect);
    controller.stderr.on('data', collect);
    deadlineTimer = setTimeout(() => {
      diagnostic.timedOut = true;
      failureReason = true;
      interrupt();
      killGroup();
    }, timeoutMs);
    deadlineTimer.unref();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const processes = dependencies.listProcesses ?? listProcesses;
    const command = dependencies.readProcessCommand ?? readProcessCommand;
    const sleep = dependencies.sleep ?? delay;
    const checkRunning = () => {
      assert.ok(
        !failureReason && !exited && !closed,
        'Update controller exited before the fault boundary.',
      );
    };
    /** @type {Record<string, any>|undefined} */
    let convergeChild;
    while (!convergeChild) {
      diagnostic.faultStage = 'find-converge-child';
      checkRunning();
      for (const candidate of await processes()) {
        if (
          candidate.parentPid !== pid ||
          candidate.groupId !== pid ||
          candidate.state.startsWith('Z')
        )
          continue;
        diagnostic.faultStage = 'read-child-command';
        if ((await command(candidate.pid)) !== expectedCommand) continue;
        checkRunning();
        diagnostic.faultStage = 'pause-controller';
        signalProcess(pid, 'SIGSTOP');
        diagnostic.controllerPaused = true;
        convergeChild = candidate;
        break;
      }
      if (!convergeChild) await sleep(40);
    }
    // Observe the stop itself before trusting the journal cannot advance.
    diagnostic.faultStage = 'confirm-controller-paused';
    for (;;) {
      checkRunning();
      const processIdentity = (await processes()).find(
        (/** @type {Record<string, any>} */ entry) => entry.pid === pid,
      );
      assert.equal(processIdentity?.groupId, pid);
      if (processIdentity.state.includes('T')) break;
      await sleep(20);
    }
    diagnostic.faultStage = 'verify-paused-journal';
    sameJson(await options.readJournal(), pending);
    diagnostic.faultStage = 'observe-target';
    const observation = await Promise.race([
      options.observeTarget({ signal: observationAbort.signal }),
      interrupted,
    ]);
    diagnostic.faultStage = 'verify-target';
    checkRunning();
    assert.equal(observation.deploymentInstanceId, prior.deploymentInstanceId);
    assert.equal(observation.incarnationId, prior.incarnationId);
    assert.equal(observation.artifactId, target.artifact.artifactId);
    assert.equal(observation.revisionId, target.artifact.revisionId);
    validateSingleNodeRemoteServiceStatus(observation.service, target);
    assert.ok(
      Number.isSafeInteger(observation.process?.pid) &&
        observation.process.pid > 0,
    );
    diagnostic.faultStage = 'verify-observed-journal';
    sameJson(await options.readJournal(), pending);
    const receipt = {
      schemaVersion: 1,
      kind: 'wharfie.live-deployment.update-interruption',
      deploymentInstanceId: prior.deploymentInstanceId,
      incarnationId: prior.incarnationId,
      priorDesiredRevisionId: prior.release.current.desired.desiredRevisionId,
      targetDesiredRevisionId: target.desiredRevisionId,
      targetArtifactId: target.artifact.artifactId,
      targetRevisionId: target.artifact.revisionId,
      pendingJournalId: pending.journalId,
      pendingJournalGeneration: pending.generation,
      boundary: 'guest-active-controller-unsettled',
      controllerPid: pid,
      convergeChildPid: convergeChild.pid,
      controllerPaused: true,
      guestHealthy: true,
      guestPid: observation.process.pid,
    };
    diagnostic.faultStage = 'publish-boundary';
    await Promise.race([
      options.publish?.({ ...receipt, controllerExitConfirmed: false }),
      interrupted,
    ]);
    checkRunning();
    diagnostic.faultStage = 'kill-controller-group';
    killGroup();
    diagnostic.faultStage = 'confirm-controller-exit';
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let exitTimer;
    try {
      await Promise.race([
        completion,
        new Promise((_resolve, reject) => {
          exitTimer = setTimeout(
            () => reject(new Error('Controller exit was not confirmed.')),
            EXIT_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(exitTimer);
    }
    assert.equal(diagnostic.signal, 'SIGKILL');
    assert.ok(!failureReason);
    diagnostic.faultStage = 'verify-interrupted-journal';
    sameJson(await options.readJournal(), pending);
    diagnostic.faultStage = 'confirm-process-group-exit';
    const survivors = (await processes()).filter(
      (/** @type {Record<string, any>} */ entry) =>
        entry.groupId === pid && !entry.state.startsWith('Z'),
    );
    assert.deepEqual(
      survivors,
      [],
      'Owned controller process group did not exit.',
    );
    return {
      ...receipt,
      controllerExitConfirmed: true,
      processGroupExitConfirmed: true,
      status: diagnostic.status,
      signal: diagnostic.signal,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    // Snapshot the cause before cleanup's SIGKILL changes the process result.
    const cause =
      /** @type {{code?: unknown, diagnostic?: {phase?: unknown}}|null} */ (
        error
      );
    diagnostic.faultCode = diagnostic.aborted
      ? 'aborted'
      : diagnostic.timedOut
        ? 'deadline'
        : diagnostic.outputLimitExceeded
          ? 'output-limit'
          : diagnostic.spawnError
            ? 'spawn-failed'
            : unexpectedExit
              ? 'controller-exited'
              : cause?.diagnostic?.phase === 'update-process-observation' ||
                  cause?.diagnostic?.phase === 'update-child-observation'
                ? 'process-observation-failed'
                : cause?.code === 'ERR_ASSERTION'
                  ? 'assertion-failed'
                  : 'unexpected-error';
    observationAbort.abort();
    killGroup();
    if (completion && !closed) {
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let exitTimer;
      try {
        await Promise.race([
          completion,
          new Promise((resolve) => {
            exitTimer = setTimeout(resolve, EXIT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(exitTimer);
      }
    }
    diagnostic.durationMs = Math.round(performance.now() - started);
    throw Object.assign(
      new Error(
        'Live deployment failed during update-controller-interruption.',
      ),
      { diagnostic },
    );
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener('abort', abort);
  }
}
