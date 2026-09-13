/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Bounded live acceptance orchestration. */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createLiveDeploymentHost } from './live-deployment-host.js';
import {
  LIVE_DEPLOYMENT_INPUT_BYTES,
  LIVE_DEPLOYMENT_TIMER_DELAY_MS,
} from './live-deployment-package.js';

/**
 * Verify the useful application result against known, host-local input.
 * @param {Record<string, any>} value
 * @param {string} inputPath
 */
export function assertLiveDeploymentFileOutput(value, inputPath) {
  const fingerprint = {
    bytes: Buffer.byteLength(LIVE_DEPLOYMENT_INPUT_BYTES),
    sha256: createHash('sha256')
      .update(LIVE_DEPLOYMENT_INPUT_BYTES)
      .digest('hex'),
    readStable: true,
  };
  assert.deepEqual(value, {
    path: inputPath,
    stable: true,
    baseline: fingerprint,
    current: fingerprint,
  });
}

/**
 * Check the public run identity before using its lifecycle observations.
 * @param {Record<string, any>} view
 * @param {Record<string, any>} state
 * @param {string} runId
 */
export function assertRun(view, state, runId) {
  assert.equal(view.kind, 'wharfie.execution-ledger.run');
  assert.deepEqual(view.integrity, { verified: true });
  assert.equal(view.run.runId, runId);
  assert.equal(view.run.appId, state.appId);
  assert.equal(view.run.revisionId, state.guestRevisionId);
  assert.equal(view.run.trigger.kind, 'workflow');
  assert.equal(view.run.trigger.workflowId, 'verify-stable');
  assert.equal(view.workflowCursor.runId, runId);
  assert.equal(view.workflowCursor.appId, state.appId);
  assert.equal(view.workflowCursor.revisionId, state.guestRevisionId);
}

/**
 * Retain only fixed identity and execution evidence from a public view.
 * @param {Record<string, any>} view
 */
export function runReceipt(view) {
  return {
    runId: view.run.runId,
    revisionId: view.run.revisionId,
    status: view.run.status,
    disposition: view.workflowCursor.disposition,
    timers: view.timers.map((/** @type {Record<string, any>} */ timer) => ({
      timerId: timer.timerId,
      scheduledAt: timer.scheduledAt,
      dueAt: timer.dueAt,
      status: timer.status,
    })),
    invocations: view.invocations.map(
      (/** @type {Record<string, any>} */ invocation) => ({
        invocationId: invocation.invocationId,
        activityId: invocation.activityId,
        status: invocation.status,
        generation: invocation.generation,
      }),
    ),
    attempts: view.attempts.map(
      (/** @type {Record<string, any>} */ attempt) => ({
        invocationId: attempt.invocationId,
        attemptId: attempt.attemptId,
        status: attempt.status,
        generation: attempt.generation,
      }),
    ),
  };
}

/**
 * A completed activity must remain the same committed physical execution.
 * @param {Record<string, any>} view
 * @param {string[]} expected
 */
export function assertActivities(view, expected) {
  assert.deepEqual(
    view.invocations
      .map((/** @type {Record<string, any>} */ entry) => entry.activityId)
      .sort(),
    [...expected].sort(),
  );
  assert.equal(view.attempts.length, expected.length);
  for (const invocation of view.invocations) {
    assert.equal(invocation.status, 'COMPLETED');
    const attempts = view.attempts.filter(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.invocationId === invocation.invocationId,
    );
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'COMPLETED');
    assert.equal(attempts[0].generation, invocation.generation);
  }
}

/**
 * Fail if work finished before the fault, or a replacement timer was admitted.
 * @param {Record<string, any>} view
 * @param {Record<string, any>} [original]
 */
export function assertWaiting(view, original) {
  assert.equal(view.run.status, 'RUNNING');
  assert.equal(view.workflowCursor.disposition, 'TIMER_WAITING');
  assert.equal(view.workflowCursor.stepId, 'stability-window');
  assert.equal(view.timers.length, 1);
  const timer = view.timers[0];
  assert.equal(timer.status, 'WAITING');
  assert.equal(timer.stepId, 'stability-window');
  assert.equal(timer.timerId, view.workflowCursor.timerId);
  assert.equal(timer.dueAt - timer.scheduledAt, LIVE_DEPLOYMENT_TIMER_DELAY_MS);
  if (original) {
    assert.equal(timer.timerId, original.timers[0].timerId);
    assert.equal(timer.scheduledAt, original.timers[0].scheduledAt);
    assert.equal(timer.dueAt, original.timers[0].dueAt);
    assert.deepEqual(view.invocations, original.invocations);
    assert.deepEqual(view.attempts, original.attempts);
  }
  assertActivities(view, ['capture']);
}

/**
 * Exercise one run across controller exit, resident death and provider reboot.
 * The caller retains its run lock and always performs cleanup after this returns
 * or throws. Every command starts a separate packaged controller process.
 * @param {Record<string, any>} options
 * @param {Record<string, any>} [dependencies]
 */
export async function verifyLiveDeploymentDurability(
  options,
  dependencies = {},
) {
  const { state, command, phase, receipt } = options;
  const ports = {
    createHost: createLiveDeploymentHost,
    wait: delay,
    now: () => performance.now(),
    wallNow: () => Date.now(),
    ...dependencies,
  };
  const host = await ports.createHost(options);
  const selectors = [
    '--deployment-instance',
    state.deploymentInstanceId,
    '--data-root',
    options.dataRoot,
  ];
  const inputPath = `/home/wharfie/live-acceptance-${state.runId}.txt`;
  /** @param {string} name @param {string[]} args @param {number} [timeoutMs] */
  const call = async (name, args, timeoutMs = 60_000) =>
    JSON.parse(
      (await command(name, ['wharfie', 'deployment', ...args], timeoutMs))
        .stdout,
    );
  /** @param {string} name @param {string[]} args */
  const exec = (name, args) =>
    call(name, ['exec', ...selectors, '--', ...args]);
  /** @param {string} name */
  const coordinator = (name) =>
    call(name, ['coordinator', 'inspect', ...selectors, '--json']);
  /**
   * Poll under a monotonic deadline; tolerate a proved process-observation race.
   * @param {()=>Promise<any>} observe
   * @param {(value: Record<string, any>)=>boolean} accept
   * @param {number} timeoutMs
   * @param {boolean} [retryDisconnected]
   */
  const waitFor = async (
    observe,
    accept,
    timeoutMs,
    retryDisconnected = false,
  ) => {
    const end = ports.now() + timeoutMs;
    do {
      options.signal?.throwIfAborted();
      let value;
      try {
        value = await observe();
      } catch (error) {
        const raced =
          /** @type {any} */ (error)?.diagnostic?.retryable === true;
        if ((!retryDisconnected && !raced) || options.signal?.aborted)
          throw error;
      }
      if (value !== undefined && accept(value)) return value;
      if (ports.now() >= end) break;
      await ports.wait(2_000, undefined, { signal: options.signal });
    } while (ports.now() < end);
    throw new Error('Durable live acceptance observation timed out.');
  };

  await phase('guest-input', async () => {
    await host.stageInput(inputPath, LIVE_DEPLOYMENT_INPUT_BYTES);
    const ordinary = await exec('remote-cli', [inputPath]);
    assertLiveDeploymentFileOutput(ordinary, inputPath);
    assert.deepEqual(await host.readMarkers(inputPath), []);
  });
  const initialHost = await phase('host-before', async () => {
    const value = await host.observe();
    assert.equal(value.service.health, 'healthy');
    receipt('host-before.json', value);
    return value;
  });
  const started = await phase('workflow-start', async () => {
    const value = await exec('workflow-start', [
      'wharfie',
      'start',
      '--json',
      '--',
      inputPath,
    ]);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.kind, 'wharfie.execution-ledger.workflow-start');
    assert.equal(value.appId, state.appId);
    assert.equal(value.revisionId, state.guestRevisionId);
    assert.equal(value.workflowId, 'verify-stable');
    assert.equal(value.reused, false);
    assert.match(value.runId, /^[A-Za-z0-9_.:-]{1,128}$/);
    receipt('workflow-start.json', value);
    return value;
  });
  /** @param {string} name @param {boolean} [direct] */
  const inspect = async (name, direct = false) => {
    const view = direct
      ? await host.inspectRun(started.runId)
      : await exec(name, [
          'wharfie',
          'inspect',
          '--run-id',
          started.runId,
          '--json',
        ]);
    assertRun(view, state, started.runId);
    return view;
  };
  const waiting = await phase('controller-exited', async () => {
    // runLiveDeploymentProcess returned only after the submitting child and
    // its descendants exited. This inspection is a new packaged controller.
    const view = await waitFor(
      () => inspect('controller-exited'),
      (value) => value.workflowCursor.disposition === 'TIMER_WAITING',
      60_000,
    );
    assertWaiting(view);
    receipt('controller-exited.json', {
      submittingControllerExited: true,
      ...runReceipt(view),
    });
    return view;
  });
  const firstMarkers = await host.readMarkers(inputPath);
  assert.deepEqual(
    firstMarkers.map(
      (/** @type {Record<string, any>} */ entry) => entry.activity,
    ),
    ['capture'],
  );
  assert.equal(firstMarkers[0].bootId, initialHost.bootId);
  receipt('activities-before.json', firstMarkers);
  if (options.onWaiting) {
    await options.onWaiting({
      host,
      inputPath,
      runId: started.runId,
      waiting,
      firstMarkers,
    });
    const retained = await inspect('after-update-refusal');
    assertWaiting(retained, waiting);
    assert.deepEqual(await host.readMarkers(inputPath), firstMarkers);
  }

  /**
   * Recheck actual unfinished work immediately around each interruption.
   * @param {string} name
   * @param {number} [minimumRemainingMs]
   */
  const unfinished = async (name, minimumRemainingMs = 0) => {
    const view = await inspect(name, true);
    assertWaiting(view, waiting);
    if (minimumRemainingMs > 0)
      assert.ok(
        view.timers[0].dueAt - ports.wallNow() >= minimumRemainingMs,
        'The durable timer no longer has enough margin for the fault.',
      );
    assert.deepEqual(await host.readMarkers(inputPath), firstMarkers);
    receipt(`${name}.json`, runReceipt(view));
    return view;
  };
  /**
   * Persist exact replacement authority before any takeover; never refresh on retry.
   * @param {string} name
   * @param {Record<string, any>} predecessor
   * @param {Record<string, any>} before
   */
  const recover = async (name, predecessor, before) => {
    const inspection = await coordinator(`${name}-inspect`);
    assert.deepEqual(
      inspection.observedAuthority,
      predecessor.observedAuthority,
    );
    receipt(`${name}-inspection.json`, inspection);
    let takeover = null;
    let takeoverArgs = null;
    if (inspection.observedAuthority.status === 'ACTIVE') {
      const ids = {
        coordinatorId: `acceptance-${randomUUID()}`,
        requestId: `acceptance-${randomUUID()}`,
      };
      receipt(`${name}-request.json`, ids);
      takeoverArgs = [
        'coordinator',
        'takeover',
        ...selectors,
        '--inspection-file',
        path.join(options.runDir, `${name}-inspection.json`),
        '--coordinator-id',
        ids.coordinatorId,
        '--request-id',
        ids.requestId,
        '--confirm-authority-replacement',
        '--json',
      ];
      takeover = await call(`${name}-takeover`, takeoverArgs);
      assert.equal(takeover.resultAuthority.status, 'RELEASED');
      assert.equal(
        takeover.takeoverAuthority.epoch,
        inspection.observedAuthority.epoch + 1,
      );
      receipt(`${name}-takeover.json`, takeover);
    } else assert.equal(inspection.observedAuthority.status, 'RELEASED');
    const repaired = await call(
      `${name}-recover`,
      ['recover', ...selectors, '--json'],
      180_000,
    );
    assert.equal(repaired.action, 'repair');
    receipt(`${name}-recover.json`, repaired);
    const healthy = await waitFor(
      () => host.observe(),
      (value) => value.service.health === 'healthy',
      60_000,
    );
    assert.equal(healthy.bootId, before.bootId);
    const successor = await coordinator(`${name}-successor`);
    assert.equal(successor.observedAuthority.status, 'ACTIVE');
    assert.ok(
      successor.observedAuthority.epoch > inspection.observedAuthority.epoch,
    );
    if (takeoverArgs) {
      const replay = await call(`${name}-replay`, takeoverArgs);
      assert.equal(replay.applied, false);
      assert.deepEqual(await coordinator(`${name}-replay-inspect`), successor);
      const afterReplay = await host.observe();
      assert.equal(afterReplay.bootId, healthy.bootId);
      assert.deepEqual(afterReplay.process, healthy.process);
      assert.equal(afterReplay.service.health, 'healthy');
      receipt(`${name}-replay.json`, replay);
    }
    receipt(`${name}-healthy.json`, healthy);
    return healthy;
  };

  const afterCrash = await phase('resident-crash', async () => {
    const predecessor = await coordinator('crash-predecessor');
    assert.equal(predecessor.observedAuthority.status, 'ACTIVE');
    const before = await host.observe();
    await unfinished('before-crash', 60_000);
    receipt('crash-intent.json', { host: before, predecessor });
    const killed = await host.killResident(before);
    assert.equal(killed.predecessorExited, true);
    receipt('resident-kill.json', killed);
    const failed = await waitFor(
      () => host.observe(),
      (value) =>
        value.service.health !== 'healthy' &&
        value.service.systemd.mainPid !== before.service.systemd.mainPid,
      60_000,
    );
    assert.equal(failed.bootId, before.bootId);
    receipt('crashed-host.json', failed);
    await unfinished('after-crash');
    const healthy = await recover('crash', predecessor, before);
    assert.notEqual(
      healthy.service.systemd.mainPid,
      before.service.systemd.mainPid,
    );
    return healthy;
  });
  const afterReboot = await phase('host-reboot', async () => {
    const before = await host.observe();
    assert.equal(before.bootId, afterCrash.bootId);
    assert.equal(before.service.health, 'healthy');
    const predecessor = await coordinator('reboot-predecessor');
    await unfinished('before-reboot', 30_000);
    receipt('reboot-intent.json', {
      host: before,
      predecessor,
      mode: 'provider-reboot',
    });
    receipt('provider-reboot-request.json', await host.reboot(before));
    const booted = await waitFor(
      () => host.observe(),
      (value) => value.bootId !== before.bootId,
      180_000,
      true,
    );
    receipt('rebooted-host.json', booted);
    await unfinished('after-reboot');
    let healthy = booted;
    let recovery = 'automatic';
    if (healthy.service.health !== 'healthy') {
      // Give systemd its ordinary boot opportunity before deciding recovery is
      // needed. Do not mistake a newly healthy resident for stale authority.
      const end = ports.now() + 20_000;
      while (healthy.service.health !== 'healthy' && ports.now() < end) {
        await ports.wait(2_000, undefined, { signal: options.signal });
        try {
          healthy = await host.observe();
        } catch (error) {
          if (/** @type {any} */ (error)?.diagnostic?.retryable !== true)
            throw error;
        }
      }
      if (healthy.service.health !== 'healthy') {
        const retained = await coordinator('reboot-retained');
        if (retained.observedAuthority.status === 'ACTIVE')
          assert.deepEqual(
            retained.observedAuthority,
            predecessor.observedAuthority,
          );
        healthy = await recover('reboot', retained, booted);
        recovery = 'explicit';
      }
    }
    assert.equal(healthy.bootId, booted.bootId);
    assert.equal(healthy.service.health, 'healthy');
    receipt('reboot-recovery.json', { recovery, host: healthy });
    return healthy;
  });
  return await phase('workflow-completed', async () => {
    const completed = await waitFor(
      () => inspect('workflow-completed'),
      (view) => view.workflowCursor.disposition === 'COMPLETED',
      LIVE_DEPLOYMENT_TIMER_DELAY_MS + 120_000,
    );
    assert.equal(completed.run.status, 'COMPLETED');
    assert.equal(completed.timers.length, 1);
    assert.equal(completed.timers[0].timerId, waiting.timers[0].timerId);
    assert.equal(
      completed.timers[0].scheduledAt,
      waiting.timers[0].scheduledAt,
    );
    assert.equal(completed.timers[0].dueAt, waiting.timers[0].dueAt);
    assert.equal(completed.timers[0].status, 'FIRED');
    assertActivities(completed, ['capture', 'verify']);
    assert.deepEqual(
      completed.invocations.find(
        (/** @type {Record<string, any>} */ entry) =>
          entry.invocationId === waiting.invocations[0].invocationId,
      ),
      waiting.invocations[0],
    );
    assert.deepEqual(
      completed.attempts.find(
        (/** @type {Record<string, any>} */ entry) =>
          entry.attemptId === waiting.attempts[0].attemptId,
      ),
      waiting.attempts[0],
    );
    const markers = await host.readMarkers(inputPath);
    assert.deepEqual(
      markers.map((/** @type {Record<string, any>} */ entry) => entry.activity),
      ['capture', 'verify'],
    );
    assert.deepEqual(markers[0], firstMarkers[0]);
    assert.equal(markers[1].bootId, afterReboot.bootId);
    receipt('activities-completed.json', markers);
    const output = await exec('workflow-output', [
      'wharfie',
      'output',
      '--run-id',
      started.runId,
      '--confirm-sensitive-output',
      '--json',
    ]);
    assert.equal(output.kind, 'wharfie.execution-ledger.run-output');
    assert.deepEqual(output.integrity, { verified: true });
    assert.deepEqual(output.scope, {
      appId: state.appId,
      revisionId: state.guestRevisionId,
      runId: started.runId,
    });
    assert.equal(output.snapshot.status, 'COMPLETED');
    assert.equal(output.terminal.type, 'completed');
    assert.deepEqual(
      output.outputs.map(
        (/** @type {Record<string, any>} */ entry) => entry.stepId,
      ),
      ['baseline', 'stability-window', 'comparison'],
    );
    assertLiveDeploymentFileOutput(output.terminal.result, inputPath);
    assertLiveDeploymentFileOutput(output.outputs.at(-1).value, inputPath);
    receipt('workflow-completed.json', {
      ...runReceipt(completed),
      outputVerified: true,
      submittingControllerExited: true,
      residentCrashVerified: true,
      hostRebootVerified: true,
      initialBootId: initialHost.bootId,
      finalBootId: afterReboot.bootId,
    });
    return {
      runId: started.runId,
      inputPath,
      completed: runReceipt(completed),
      output,
      markers,
      bootId: afterReboot.bootId,
    };
  });
}
