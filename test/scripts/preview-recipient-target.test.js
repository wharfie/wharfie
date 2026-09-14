/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { getBuildTargetId } from '../../src/core/runtime/build-target.js';
import {
  PREVIEW_RECIPIENT_TARGET as target,
  cleanupPreviewRecipientTarget,
  finishPreviewRecipientTarget,
  preparePreviewRecipientTarget,
} from '../../scripts/preview-recipient-target.js';

const inputBytes = 'Wharfie preview recipient input.\n';
const runId = '4a0d2185-cbe4-48f9-b209-c9bde2bfa192';
const appRoot = `${target.home}/.local/share/wharfie-nodejs/applications/steady-file-demo`;
const unit = 'wharfie-steady-file-demo.service';
const unitPath = `${target.home}/.config/systemd/user/${unit}`;
const wantsPath = `${target.home}/.config/systemd/user/default.target.wants/${unit}`;
const appBytes = 'verified recipient SEA bytes';
const artifactDigest = createHash('sha256').update(appBytes).digest();
const inputDigest = createHash('sha256').update(inputBytes).digest('hex');
const workflowRunId = `wfr_${Buffer.alloc(32, 5).toString('base64url')}`;
const revisionId = `wrv1_${Buffer.alloc(32, 6).toString('base64url')}`;
const artifactId = `waf1_${artifactDigest.toString('base64url')}`;
const buildTarget = {
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
  nodeVersion: '24.13.1',
};
const artifactRecord = {
  schemaVersion: 1,
  kind: 'artifactRecord',
  appId: 'steady-file-demo',
  artifactId,
  revisionId,
  byteDigest: {
    algorithm: 'sha256',
    value: artifactDigest.toString('base64url'),
  },
  size: Buffer.byteLength(appBytes),
  target: buildTarget,
  targetId: getBuildTargetId(buildTarget),
  format: { kind: 'node-sea', version: 1 },
  provenance: {
    fixture: 'Parent independently validates provenance before transfer.',
  },
};
const fingerprint = {
  bytes: Buffer.byteLength(inputBytes),
  sha256: inputDigest,
  readStable: true,
};
const decision = {
  path: target.inputPath,
  stable: true,
  baseline: fingerprint,
  current: fingerprint,
};

function fixture() {
  let time = 1_000_000;
  let timerScheduledAt = 0;
  let installed = false;
  let hasInstallation = false;
  let controllerPid = 100;
  /** @type {Array<{command:string,args:string[],options:Record<string,any>}>} */
  const calls = [];
  /** @type {Array<{phase:string,receipt:Record<string,any>}>} */
  const checkpoints = [];
  /** @type {Set<string>} */
  const existing = new Set([
    target.home,
    target.executable,
    target.artifactRecordPath,
    target.inputPath,
  ]);
  /** @type {((command:string,args:string[],result:{status:number,stdout:string,stderr:string})=>{status:number,stdout:string,stderr:string}|Promise<{status:number,stdout:string,stderr:string}>)|null} */
  let intercept = null;
  const reference = { artifactId, revisionId };
  const releasePath = `${appRoot}/releases/${artifactId}/app`;

  function serviceStatus() {
    if (!installed)
      return {
        schemaVersion: 3,
        kind: 'wharfie.service.status',
        appId: 'steady-file-demo',
        unit,
        health: 'absent',
        installation: { state: hasInstallation ? 'uninstalled' : 'absent' },
      };
    return {
      schemaVersion: 3,
      kind: 'wharfie.service.status',
      appId: 'steady-file-demo',
      unit,
      health: 'healthy',
      persistence: { linger: true, unitEnabled: true, bootEnabled: true },
      systemd: { fragmentPath: unitPath, dropInPaths: '', mainPid: 801 },
      runtime: {
        processId: 801,
        status: 'READY',
        session: 'active',
        currentOwner: true,
        generation: 1,
      },
      integrity: { status: 'verified' },
      installation: {
        activeArtifactId: artifactId,
        activeRevisionId: revisionId,
        previousArtifactId: null,
        previousRevisionId: null,
      },
      activation: { phase: 'ACTIVE', selected: reference, rollback: null },
      desiredConvergence: { disposition: 'authorized', desired: reference },
    };
  }
  function view() {
    const done = time >= timerScheduledAt + 60_000;
    const activities = done ? ['capture', 'verify'] : ['capture'];
    return {
      kind: 'wharfie.execution-ledger.run',
      integrity: { verified: true },
      run: {
        runId: workflowRunId,
        appId: 'steady-file-demo',
        revisionId,
        status: done ? 'COMPLETED' : 'RUNNING',
        trigger: { kind: 'workflow', workflowId: 'verify-stable' },
      },
      workflowCursor: {
        runId: workflowRunId,
        appId: 'steady-file-demo',
        revisionId,
        disposition: done ? 'COMPLETED' : 'TIMER_WAITING',
        stepId: 'stability-window',
        timerId: 'timer-1',
      },
      timers: [
        {
          timerId: 'timer-1',
          status: done ? 'FIRED' : 'WAITING',
          stepId: 'stability-window',
          scheduledAt: timerScheduledAt,
          dueAt: timerScheduledAt + 60_000,
          firedAt: done ? timerScheduledAt + 60_000 : null,
        },
      ],
      invocations: activities.map((activityId) => ({
        activityId,
        invocationId: `invocation-${activityId}`,
        status: 'COMPLETED',
        generation: 1,
      })),
      attempts: activities.map((activityId) => ({
        invocationId: `invocation-${activityId}`,
        attemptId: `attempt-${activityId}`,
        status: 'COMPLETED',
        generation: 1,
      })),
    };
  }
  /** @param {string} command @param {string[]} args */
  function answer(command, args) {
    if (command === '/usr/bin/id')
      return args[0] === '-u' ? String(target.uid) : target.username;
    if (command === '/usr/bin/uname') return 'Linux x86_64';
    if (command === '/usr/bin/printenv')
      return args[0] === 'HOME' ? target.home : target.path;
    if (command === '/usr/bin/env')
      return { status: 127, stdout: '', stderr: 'unavailable' };
    if (command === '/usr/bin/loginctl') return 'yes';
    if (command === '/usr/bin/stat') {
      const file = args.at(-1);
      if (file === target.home) return `700:${target.uid}`;
      if (file === target.executable)
        return `regular file:${artifactRecord.size}:700:${target.uid}`;
      if (file === target.inputPath)
        return `regular file:${fingerprint.bytes}:600:${target.uid}`;
      if (file === '/proc/801') return String(target.uid);
    }
    if (command === '/usr/bin/test')
      return {
        status: args[0] === '-e' && existing.has(args[1]) ? 0 : 1,
        stdout: '',
        stderr: '',
      };
    if (command === '/usr/bin/sha256sum')
      return `${args.at(-1) === target.inputPath ? inputDigest : artifactDigest.toString('hex')}  ${args.at(-1)}`;
    if (command === '/usr/bin/cat') {
      if (args[0] === target.artifactRecordPath)
        return JSON.stringify(artifactRecord);
      if (args[0] === '/proc/801/environ')
        return `PATH=${target.path}\0HOME=${target.home}\0`;
    }
    if (command === '/usr/bin/readlink') return releasePath;
    if (command === '/usr/bin/systemctl') {
      if (args.includes('show-environment'))
        return `PATH=${target.path}\nHOME=${target.home}`;
      if (args.includes('show'))
        return 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nFragmentPath=\nDropInPaths=\nNeedDaemonReload=no';
    }
    if (command === target.executable) {
      if (args[0] === target.inputPath) return JSON.stringify(decision);
      if (args[1] === 'start') {
        existing.add(appRoot);
        return JSON.stringify({
          kind: 'wharfie.execution-ledger.workflow-start',
          appId: 'steady-file-demo',
          revisionId,
          workflowId: 'verify-stable',
          reused: false,
          runStatus: 'RUNNING',
          runId: workflowRunId,
        });
      }
      if (args[1] === 'inspect') return JSON.stringify(view());
      if (args[1] === 'list')
        return JSON.stringify({
          kind: 'wharfie.execution-ledger.run-page',
          integrity: { verified: true },
          scope: { appId: 'steady-file-demo' },
          nextCursor: null,
          items: [
            {
              runId: workflowRunId,
              revisionId,
              kind: 'workflow',
              status: view().run.status,
            },
          ],
        });
      if (args[1] === 'output')
        return JSON.stringify({
          kind: 'wharfie.execution-ledger.run-output',
          disclosure: 'application-sensitive-unredacted',
          integrity: { verified: true },
          scope: {
            appId: 'steady-file-demo',
            revisionId,
            runId: workflowRunId,
          },
          snapshot: { runKind: 'workflow', status: 'COMPLETED' },
          outputs: [
            { stepId: 'baseline' },
            { stepId: 'stability-window' },
            { stepId: 'comparison', value: decision },
          ],
          terminal: { type: 'completed', result: decision },
        });
      if (args[1] === 'service') {
        if (args[2] === 'status') return JSON.stringify(serviceStatus());
        if (args[2] === 'install') {
          installed = true;
          hasInstallation = true;
          existing.add(unitPath);
          existing.add(wantsPath);
          existing.add(releasePath);
          timerScheduledAt = time;
          return JSON.stringify({
            action: 'install',
            requestStatus: 'fulfilled',
            outcome: 'target-active',
            activeArtifactId: artifactId,
          });
        }
        if (args[2] === 'uninstall') {
          installed = false;
          existing.delete(unitPath);
          existing.delete(wantsPath);
          return JSON.stringify({
            action: 'uninstall',
            outcome: hasInstallation ? 'uninstalled' : 'already-uninstalled',
            health: 'absent',
          });
        }
        if (args[2] === 'prune')
          return JSON.stringify({
            kind: 'wharfie.service.release-prune',
            installationState: 'uninstalled',
            selected: reference,
            rollback: null,
            retainedReleaseCount: 1,
            removedCount: 0,
          });
        if (args[2] === 'purge') {
          existing.delete(appRoot);
          existing.delete(releasePath);
          hasInstallation = false;
          return JSON.stringify({
            action: 'purge',
            requestStatus: 'fulfilled',
            outcome: 'purged',
          });
        }
      }
    }
    throw new Error(
      `Unexpected fixture command: ${command} ${JSON.stringify(args)}`,
    );
  }
  const ports = {
    /** @param {string} command @param {string[]} args @param {Record<string,any>} options */
    async run(command, args, options) {
      calls.push({ command, args, options });
      const value = answer(command, args);
      const result =
        typeof value === 'string'
          ? { status: 0, stdout: `${value}\n`, stderr: '' }
          : value;
      return intercept ? await intercept(command, args, result) : result;
    },
    now: () => time,
    /** @param {number} duration */
    wait: async (duration) => {
      time += duration;
    },
    /** @param {string} phase @param {Record<string,any>} receipt */
    checkpoint: async (phase, receipt) => {
      checkpoints.push({ phase, receipt: JSON.parse(JSON.stringify(receipt)) });
    },
    get controllerProcessId() {
      return controllerPid;
    },
  };
  return {
    input: {
      artifactRecord: JSON.parse(JSON.stringify(artifactRecord)),
      inputBytes,
      runId,
    },
    ports,
    calls,
    checkpoints,
    existing,
    /** @param {(command:string,args:string[],result:{status:number,stdout:string,stderr:string})=>{status:number,stdout:string,stderr:string}|Promise<{status:number,stdout:string,stderr:string}>} value */
    intercept(value) {
      intercept = value;
    },
    /** @param {number} [duration] */
    advance(duration = 1000) {
      time += duration;
    },
    reconnect() {
      controllerPid++;
    },
    owned() {
      return checkpoints.find((entry) => entry.phase === 'owned')?.receipt;
    },
  };
}

describe('clean Linux preview recipient lifecycle', () => {
  it('runs a verified SEA without Node, reconnects while waiting, completes once and independently cleans its state', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    expect(prepared.waiting.timers[0].status).toBe('WAITING');
    expect(prepared.submittingProcessExited).toBe(true);
    expect(f.owned()).toEqual(prepared.owned);
    expect(f.existing.has(appRoot)).toBe(true);
    f.reconnect();
    const completed = await finishPreviewRecipientTarget(
      { ...f.input, prepared },
      f.ports,
    );
    expect(completed.sameRunCompleted).toBe(true);
    expect(completed.committedWorkPreserved).toBe(true);
    expect(completed.output.terminal.result).toEqual(decision);
    expect(completed.cleanup.applicationRootAbsent).toBe(true);
    expect(f.existing.has(appRoot)).toBe(false);
    expect(f.existing.has(target.executable)).toBe(true);
    expect(f.calls.filter((call) => call.args[1] === 'start')).toHaveLength(1);
    expect(f.calls.filter((call) => call.args[2] === 'install')).toHaveLength(
      1,
    );
    expect(
      f.calls.every(
        (call) =>
          call.options.timeoutMs > 0 &&
          call.options.timeoutMs <= 120_000 &&
          call.options.maxOutputBytes === 512 * 1024,
      ),
    ).toBe(true);
    expect(f.checkpoints.map((entry) => entry.phase)).toEqual([
      'owned',
      'prepare',
      'reconnected',
      'cleanup',
      'complete',
    ]);
  });

  it.each([
    'uid',
    'node',
    'manager-path',
    'artifact-digest',
    'record',
    'input',
    'existing-state',
  ])(
    'refuses %s before claiming or mutating application state',
    async (condition) => {
      const f = fixture();
      if (condition === 'existing-state') f.existing.add(appRoot);
      f.intercept((command, args, result) => {
        if (condition === 'uid' && command === '/usr/bin/id')
          return { ...result, stdout: '1000\n' };
        if (
          condition === 'node' &&
          command === '/usr/bin/env' &&
          args[0] === 'node'
        )
          return { status: 0, stdout: 'v24.13.1\n', stderr: '' };
        if (condition === 'manager-path' && args.includes('show-environment'))
          return { ...result, stdout: 'PATH=/usr/bin:/bin\n' };
        if (
          condition === 'artifact-digest' &&
          command === '/usr/bin/sha256sum' &&
          args.at(-1) === target.executable
        )
          return {
            ...result,
            stdout: `${'a'.repeat(64)}  ${target.executable}\n`,
          };
        if (
          condition === 'record' &&
          command === '/usr/bin/cat' &&
          args[0] === target.artifactRecordPath
        )
          return {
            ...result,
            stdout: JSON.stringify({ ...artifactRecord, provenance: {} }),
          };
        if (
          condition === 'input' &&
          command === '/usr/bin/sha256sum' &&
          args.at(-1) === target.inputPath
        )
          return {
            ...result,
            stdout: `${'b'.repeat(64)}  ${target.inputPath}\n`,
          };
        return result;
      });
      await expect(
        preparePreviewRecipientTarget(f.input, f.ports),
      ).rejects.toThrow('Preview recipient target proof failed.');
      expect(f.owned()).toBeUndefined();
      expect(
        f.calls.some((call) =>
          ['start', 'install', 'purge'].some((action) =>
            call.args.includes(action),
          ),
        ),
      ).toBe(false);
    },
  );

  it('records ownership before submitting and keeps failure diagnostics free of raw command output', async () => {
    const f = fixture();
    f.intercept((command, args, result) => {
      if (command === target.executable && args[1] === 'start') {
        expect(f.owned()).toBeDefined();
        return {
          status: 1,
          stdout: 'secret application output',
          stderr: 'credential=private',
        };
      }
      return result;
    });
    await expect(
      preparePreviewRecipientTarget(f.input, f.ports),
    ).rejects.toMatchObject({
      diagnostic: {
        phase: 'submit-workflow',
        code: 'command-failed',
        command: { status: 1, signal: null },
      },
    });
    expect(JSON.stringify(f.checkpoints)).not.toMatch(
      /secret application|credential=private/,
    );
    const cleanup = await cleanupPreviewRecipientTarget(
      { ...f.input, owned: f.owned() },
      f.ports,
    );
    expect(cleanup.applicationRootAbsent).toBe(true);
    expect(cleanup.prune).toBeNull();
  });

  it('requires exact proof ownership before attempting cleanup', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    const count = f.calls.length;
    await expect(
      cleanupPreviewRecipientTarget(
        {
          ...f.input,
          owned: {
            ...prepared.owned,
            artifactId: `waf1_${Buffer.alloc(32).toString('base64url')}`,
          },
        },
        f.ports,
      ),
    ).rejects.toThrow();
    expect(f.calls).toHaveLength(count);
  });

  it('requires a distinct controller and the same still-unfinished timer', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    await expect(
      finishPreviewRecipientTarget({ ...f.input, prepared }, f.ports),
    ).rejects.toThrow();
    f.reconnect();
    f.advance(60_000);
    await expect(
      finishPreviewRecipientTarget({ ...f.input, prepared }, f.ports),
    ).rejects.toThrow('Preview recipient target proof failed.');
    expect(f.calls.some((call) => call.args[2] === 'uninstall')).toBe(false);
  });

  it.each(['resident', 'timer', 'baseline'])(
    'rejects a changed %s as completion proof',
    async (condition) => {
      const f = fixture();
      const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
      f.reconnect();
      f.intercept((command, args, result) => {
        if (command !== target.executable) return result;
        if (condition === 'resident' && args[2] === 'status') {
          const value = JSON.parse(result.stdout);
          value.runtime.generation++;
          return { ...result, stdout: JSON.stringify(value) };
        }
        if (args[1] === 'inspect') {
          const value = JSON.parse(result.stdout);
          if (condition === 'timer') value.timers[0].dueAt++;
          if (condition === 'baseline' && value.run.status === 'COMPLETED')
            value.attempts[0].attemptId = 'replacement-attempt';
          return { ...result, stdout: JSON.stringify(value) };
        }
        return result;
      });
      await expect(
        finishPreviewRecipientTarget({ ...f.input, prepared }, f.ports),
      ).rejects.toThrow('Preview recipient target proof failed.');
      expect(f.calls.some((call) => call.args[2] === 'uninstall')).toBe(false);
    },
  );

  it('retries only the exact documented incomplete purge response once', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    let purgeCalls = 0;
    f.intercept((command, args, result) => {
      if (
        command === target.executable &&
        args[2] === 'purge' &&
        ++purgeCalls === 1
      )
        return {
          status: 1,
          stdout: '',
          stderr: JSON.stringify({
            schemaVersion: 1,
            kind: 'wharfie.service.error',
            action: 'purge',
            code: 'systemd-user-service-purge-incomplete',
            message:
              'Systemd user-service purge was interrupted and is safe to retry.',
            remediation:
              'Retry service purge with the same --confirm-data-loss application ID.',
          }),
        };
      return result;
    });
    const result = await cleanupPreviewRecipientTarget(
      { ...f.input, owned: prepared.owned },
      f.ports,
    );
    expect(result.purgeAttempts).toBe(2);
    expect(purgeCalls).toBe(2);
    const replay = await cleanupPreviewRecipientTarget(
      { ...f.input, owned: prepared.owned },
      f.ports,
    );
    expect(replay.prune).toBeNull();
    expect(replay.applicationRootAbsent).toBe(true);
  });

  it('does not turn an unrelated purge failure into a successful retry', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    f.intercept((command, args, result) =>
      command === target.executable && args[2] === 'purge'
        ? {
            status: 1,
            stdout: '',
            stderr: JSON.stringify({
              code: 'foreign-state',
              message: 'private value',
            }),
          }
        : result,
    );
    await expect(
      cleanupPreviewRecipientTarget(
        { ...f.input, owned: prepared.owned },
        f.ports,
      ),
    ).rejects.toThrow('Preview recipient target proof failed.');
    expect(f.calls.filter((call) => call.args[2] === 'purge')).toHaveLength(1);
    expect(JSON.stringify(f.checkpoints)).not.toContain('private value');
  });

  it('rejects an observation that resolves after the bounded phase deadline', async () => {
    const f = fixture();
    f.intercept((_command, _args, result) => {
      f.advance(180_000);
      return result;
    });
    await expect(
      preparePreviewRecipientTarget(f.input, f.ports),
    ).rejects.toMatchObject({ diagnostic: { code: 'deadline' } });
    expect(f.calls).toHaveLength(1);
    expect(f.owned()).toBeUndefined();
  });

  it('retains only fixed command diagnostics when the bounded transport rejects', async () => {
    const f = fixture();
    f.intercept(() => {
      throw Object.assign(new Error('private credential and raw stderr'), {
        diagnostic: {
          status: 137,
          signal: 'SIGKILL',
          timedOut: true,
          environment: 'private credential',
        },
      });
    });
    await expect(
      preparePreviewRecipientTarget(f.input, f.ports),
    ).rejects.toMatchObject({
      diagnostic: {
        phase: 'validate-target',
        code: 'command-failed',
        command: {
          executable: 'id',
          status: 137,
          signal: 'SIGKILL',
          timedOut: true,
        },
      },
    });
    expect(JSON.stringify(f.checkpoints)).not.toMatch(
      /private|credential|stderr/,
    );
  });

  it('does not return success when persisting the final checkpoint overruns its deadline', async () => {
    const f = fixture();
    const save = f.ports.checkpoint;
    f.ports.checkpoint = async (phase, receipt) => {
      await save(phase, receipt);
      if (phase === 'prepare') f.advance(180_000);
    };
    await expect(
      preparePreviewRecipientTarget(f.input, f.ports),
    ).rejects.toMatchObject({ diagnostic: { code: 'deadline' } });
    expect(f.checkpoints.at(-1)?.phase).toBe('failure');
    expect(f.owned()).toBeDefined();
  });

  it('independently rejects wiring left behind after purge', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    f.intercept((command, args, result) => {
      if (command === target.executable && args[2] === 'purge')
        f.existing.add(unitPath);
      return result;
    });
    await expect(
      cleanupPreviewRecipientTarget(
        { ...f.input, owned: prepared.owned },
        f.ports,
      ),
    ).rejects.toMatchObject({ diagnostic: { phase: 'cleanup-final-absence' } });
  });

  it('preserves the recognized purge refusal through nested completion cleanup without retaining its message', async () => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    f.reconnect();
    f.intercept((command, args, result) => {
      if (command === target.executable && args[2] === 'purge')
        return {
          status: 1,
          stdout: '',
          stderr: JSON.stringify({
            schemaVersion: 1,
            kind: 'wharfie.service.error',
            action: 'purge',
            code: 'systemd-user-service-purge-not-quiescent',
            message: 'private application value',
            remediation: 'private path',
            arbitrary: { token: 'private token' },
          }),
        };
      return result;
    });
    await expect(
      finishPreviewRecipientTarget({ ...f.input, prepared }, f.ports),
    ).rejects.toMatchObject({
      diagnostic: {
        phase: 'cleanup-purge',
        command: {
          executable: 'app',
          status: 1,
          serviceError: {
            action: 'purge',
            code: 'systemd-user-service-purge-not-quiescent',
          },
        },
      },
    });
    expect(f.checkpoints.at(-1)?.receipt).toMatchObject({
      phase: 'cleanup-purge',
      command: {
        serviceError: {
          action: 'purge',
          code: 'systemd-user-service-purge-not-quiescent',
        },
      },
    });
    expect(JSON.stringify(f.checkpoints)).not.toMatch(
      /private application|private path|private token/,
    );
    expect(f.calls.filter((call) => call.args[2] === 'purge')).toHaveLength(1);
  });

  it.each([
    { schemaVersion: 2 },
    { kind: 'another.kind' },
    { action: 'uninstall' },
    { code: 'secret /private/path' },
    { code: 'a'.repeat(97) },
  ])('drops unsupported service diagnostics %j', async (override) => {
    const f = fixture();
    const prepared = await preparePreviewRecipientTarget(f.input, f.ports);
    f.intercept((command, args, result) =>
      command === target.executable && args[2] === 'purge'
        ? {
            status: 1,
            stdout: JSON.stringify({
              schemaVersion: 1,
              kind: 'wharfie.service.error',
              action: 'purge',
              code: 'systemd-user-service-purge-state-conflict',
              ...override,
            }),
            stderr: '',
          }
        : result,
    );
    await expect(
      cleanupPreviewRecipientTarget(
        { ...f.input, owned: prepared.owned },
        f.ports,
      ),
    ).rejects.toThrow('Preview recipient target proof failed.');
    expect(f.checkpoints.at(-1)?.receipt.command).not.toHaveProperty(
      'serviceError',
    );
  });
});
