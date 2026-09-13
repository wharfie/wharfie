/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Offline acceptance fixtures. */
import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';

import {
  assertLiveDeploymentFileOutput,
  verifyLiveDeploymentDurability,
} from '../../scripts/live-deployment-durability.js';
import {
  LIVE_DEPLOYMENT_INPUT_BYTES,
  LIVE_DEPLOYMENT_TIMER_DELAY_MS,
} from '../../scripts/live-deployment-package.js';

/** Assemble a provider-free host with real public command document shapes. */
function fixture(settings = /** @type {Record<string, any>} */ ({})) {
  const state = {
    appId: 'steady-file-demo',
    runId: '00000000-0000-4000-8000-000000000001',
    deploymentInstanceId: 'deployment-instance',
    guestRevisionId: 'guest-revision',
  };
  const inputPath = `/home/wharfie/live-acceptance-${state.runId}.txt`;
  const runId = 'durable-run';
  const fingerprint = {
    bytes: Buffer.byteLength(LIVE_DEPLOYMENT_INPUT_BYTES),
    sha256: createHash('sha256')
      .update(LIVE_DEPLOYMENT_INPUT_BYTES)
      .digest('hex'),
    readStable: true,
  };
  const output = {
    path: inputPath,
    stable: true,
    baseline: fingerprint,
    current: fingerprint,
  };
  const commands = /** @type {Array<{name: string, args: string[]}>} */ ([]);
  const receipts = /** @type {Record<string, any>} */ ({});
  const events = /** @type {string[]} */ ([]);
  let phase = '';
  let clock = 0;
  let bootId = 'first-boot';
  let pid = 100;
  let healthy = true;
  let crashed = false;
  let rebooted = false;
  let completed = false;
  let epoch = 1;
  let authorityStatus = 'ACTIVE';
  const takeovers = new Set();
  const capture = {
    invocationId: 'capture-invocation',
    activityId: 'capture',
    generation: 0,
    status: 'COMPLETED',
  };
  const captureAttempt = {
    invocationId: capture.invocationId,
    attemptId: 'capture-attempt',
    generation: 0,
    status: 'COMPLETED',
  };
  const firstMarker = {
    activity: 'capture',
    bootId: 'first-boot',
    processId: 101,
  };
  const view = () => {
    const terminal =
      completed || (settings.prematureCompletion && phase === 'resident-crash');
    const timerId =
      settings.replacedTimer && crashed
        ? 'replacement-timer'
        : 'original-timer';
    return {
      kind: 'wharfie.execution-ledger.run',
      integrity: { verified: true },
      run: {
        runId: settings.wrongRun ? 'another-run' : runId,
        appId: state.appId,
        revisionId: state.guestRevisionId,
        status: terminal ? 'COMPLETED' : 'RUNNING',
        trigger: { kind: 'workflow', workflowId: 'verify-stable' },
      },
      workflowCursor: {
        runId,
        appId: state.appId,
        revisionId: state.guestRevisionId,
        disposition: terminal ? 'COMPLETED' : 'TIMER_WAITING',
        stepId: 'stability-window',
        timerId,
      },
      timers: [
        {
          timerId,
          status: terminal ? 'FIRED' : 'WAITING',
          stepId: 'stability-window',
          scheduledAt: 1000,
          dueAt: 1000 + LIVE_DEPLOYMENT_TIMER_DELAY_MS,
        },
      ],
      invocations: [
        capture,
        ...(terminal
          ? [
              {
                invocationId: 'verify-invocation',
                activityId: 'verify',
                generation: 0,
                status: 'COMPLETED',
              },
            ]
          : []),
      ],
      attempts: [
        captureAttempt,
        ...(terminal
          ? [
              {
                invocationId: 'verify-invocation',
                attemptId: 'verify-attempt',
                generation: 0,
                status: 'COMPLETED',
              },
            ]
          : []),
      ],
    };
  };
  const observation = () => ({
    bootId,
    service: {
      health: healthy ? 'healthy' : 'unhealthy',
      systemd: { mainPid: pid },
    },
    process: pid ? { pid, startTicks: pid * 100 } : null,
  });
  const coordinator = () => ({
    observedAuthority: {
      status: authorityStatus,
      epoch,
      coordinatorId: `resident-${epoch}`,
    },
  });
  const host = {
    /** @param {string} selected @param {string} bytes */
    stageInput: async (selected, bytes) => {
      expect(selected).toBe(inputPath);
      expect(bytes).toBe(LIVE_DEPLOYMENT_INPUT_BYTES);
    },
    readMarkers: async () => {
      if (phase === 'guest-input') return [];
      return [
        firstMarker,
        ...(settings.repeatedCapture && crashed ? [firstMarker] : []),
        ...(completed ? [{ activity: 'verify', bootId, processId: 102 }] : []),
      ];
    },
    observe: async () => {
      if (settings.processRace && crashed && !healthy) {
        settings.processRace = false;
        throw Object.assign(new Error('process disappeared'), {
          diagnostic: { retryable: true },
        });
      }
      if (
        settings.rebootDisconnect &&
        rebooted &&
        !receipts['rebooted-host.json']
      ) {
        settings.rebootDisconnect = false;
        throw new Error('connection refused');
      }
      return observation();
    },
    /** @param {string} selected */
    inspectRun: async (selected) => {
      expect(selected).toBe(runId);
      return view();
    },
    /** @param {Record<string, any>} before */
    killResident: async (before) => {
      events.push('kill');
      expect(before).toEqual(observation());
      expect(receipts['crash-intent.json']).toBeDefined();
      crashed = true;
      healthy = false;
      pid = 0;
      return { signal: 'SIGKILL', predecessorExited: true };
    },
    /** @param {Record<string, any>} before */
    reboot: async (before) => {
      events.push('reboot');
      expect(before).toEqual(observation());
      expect(receipts['reboot-intent.json']).toBeDefined();
      rebooted = true;
      if (!settings.unchangedBoot) bootId = 'second-boot';
      healthy = !settings.explicitRebootRecovery;
      if (healthy) epoch++;
      if (settings.releasedReboot) authorityStatus = 'RELEASED';
      // PID reuse on another boot is legitimate.
      pid = healthy ? 100 : 0;
      return { action: 'reboot-requested' };
    },
  };
  const options = {
    state,
    runDir: '/private/acceptance',
    dataRoot: '/private/acceptance/controller',
    signal: settings.signal,
    /** @param {string} name @param {any} value */
    receipt: (name, value) => {
      receipts[name] = structuredClone(value);
    },
    /** @param {string} name @param {()=>Promise<any>} action */
    phase: async (name, action) => {
      phase = name;
      events.push(name);
      return action();
    },
    /** @param {string} name @param {string[]} args */
    command: async (name, args) => {
      commands.push({ name, args });
      expect(args.slice(0, 2)).toEqual(['wharfie', 'deployment']);
      let result;
      if (name === 'remote-cli') result = output;
      else if (name === 'workflow-start')
        result = {
          schemaVersion: 1,
          kind: 'wharfie.execution-ledger.workflow-start',
          appId: state.appId,
          revisionId: state.guestRevisionId,
          workflowId: 'verify-stable',
          runId,
          reused: false,
        };
      else if (name === 'workflow-output')
        result = {
          kind: 'wharfie.execution-ledger.run-output',
          integrity: { verified: true },
          scope: {
            appId: state.appId,
            revisionId: state.guestRevisionId,
            runId,
          },
          snapshot: { status: 'COMPLETED' },
          outputs: [
            { stepId: 'baseline' },
            { stepId: 'stability-window' },
            { stepId: 'comparison', value: output },
          ],
          terminal: {
            type: 'completed',
            result: settings.wrongOutput
              ? { ...output, stable: false }
              : output,
          },
        };
      else if (args[2] === 'exec') {
        if (name === 'workflow-completed') completed = true;
        result = view();
        if (completed && settings.reverseInvocations)
          result.invocations.reverse();
        if (completed && settings.reverseAttempts) result.attempts.reverse();
      } else if (args[2] === 'coordinator' && args[3] === 'inspect')
        result = coordinator();
      else if (args[2] === 'coordinator' && args[3] === 'takeover') {
        const key = args[args.indexOf('--request-id') + 1];
        const inspection = args[args.indexOf('--inspection-file') + 1]
          .split('/')
          .at(-1);
        if (!inspection) throw new Error('Missing persisted inspection path.');
        expect(receipts[inspection]).toBeDefined();
        expect(
          receipts[inspection.replace('-inspection.json', '-request.json')]
            .requestId,
        ).toBe(key);
        const applied = !takeovers.has(key);
        if (applied) {
          takeovers.add(key);
          epoch++;
          authorityStatus = 'RELEASED';
        }
        result = {
          applied,
          resultAuthority: { status: 'RELEASED' },
          takeoverAuthority: { epoch },
        };
      } else if (args[2] === 'recover') {
        epoch++;
        authorityStatus = 'ACTIVE';
        healthy = true;
        pid = 200;
        result = { action: 'repair' };
      } else throw new Error(`unexpected ${name}`);
      return { stdout: JSON.stringify(result), status: 0 };
    },
  };
  return {
    commands,
    receipts,
    events,
    output,
    inputPath,
    run: () =>
      verifyLiveDeploymentDurability(options, {
        createHost: async () => host,
        /** @param {number} ms */
        wait: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        wallNow: () => 1000 + clock,
      }),
  };
}

describe('durable live acceptance', () => {
  test('one run and timer cross controller exit, SIGKILL, exact recovery replay and a new boot', async () => {
    const setup = fixture({ rebootDisconnect: true });
    await setup.run();
    expect(setup.events.indexOf('controller-exited')).toBeLessThan(
      setup.events.indexOf('kill'),
    );
    expect(setup.events.indexOf('kill')).toBeLessThan(
      setup.events.indexOf('reboot'),
    );
    expect(
      setup.commands.filter((call) => call.name === 'workflow-start'),
    ).toHaveLength(1);
    const takeover = setup.commands.find(
      (call) => call.name === 'crash-takeover',
    );
    expect(
      setup.commands.find((call) => call.name === 'crash-replay')?.args,
    ).toEqual(takeover?.args);
    expect(setup.commands.some((call) => call.name === 'reboot-takeover')).toBe(
      false,
    );
    expect(setup.receipts['reboot-recovery.json'].recovery).toBe('automatic');
    expect(setup.receipts['workflow-completed.json']).toMatchObject({
      runId: 'durable-run',
      status: 'COMPLETED',
      outputVerified: true,
      timers: [{ timerId: 'original-timer', status: 'FIRED' }],
      initialBootId: 'first-boot',
      finalBootId: 'second-boot',
    });
  });

  test.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    'matches hashed ledger records by identity: invocations reversed=%s, attempts reversed=%s',
    async (reverseInvocations, reverseAttempts) => {
      const setup = fixture({ reverseInvocations, reverseAttempts });
      await setup.run();
      expect(setup.receipts['workflow-completed.json'].outputVerified).toBe(
        true,
      );
    },
  );

  test('retries a proved disappearing-process observation without repeating a fault', async () => {
    const setup = fixture({ processRace: true });
    await setup.run();
    expect(setup.events.filter((event) => event === 'kill')).toHaveLength(1);
    expect(setup.receipts['workflow-completed.json'].outputVerified).toBe(true);
  });

  test.each([false, true])(
    'reboot explicitly recovers retained authority, released=%s',
    async (releasedReboot) => {
      const setup = fixture({ explicitRebootRecovery: true, releasedReboot });
      await setup.run();
      expect(setup.receipts['reboot-recovery.json'].recovery).toBe('explicit');
      expect(
        setup.commands.some((call) => call.name === 'reboot-takeover'),
      ).toBe(!releasedReboot);
      expect(
        setup.commands.some((call) => call.name === 'reboot-recover'),
      ).toBe(true);
    },
  );

  test.each([
    'wrongRun',
    'prematureCompletion',
    'replacedTimer',
    'repeatedCapture',
    'unchangedBoot',
    'wrongOutput',
  ])('rejects false positive: %s', async (fault) => {
    const setup = fixture({ [fault]: true });
    await expect(setup.run()).rejects.toThrow();
    expect(setup.receipts['workflow-completed.json']).toBeUndefined();
    if (['wrongRun', 'prematureCompletion'].includes(fault))
      expect(setup.events).not.toContain('kill');
  });

  test('cancellation prevents later fault effects', async () => {
    const controller = new AbortController();
    controller.abort();
    const setup = fixture({ signal: controller.signal });
    await expect(setup.run()).rejects.toThrow();
    expect(setup.events).not.toContain('kill');
    expect(setup.events).not.toContain('reboot');
  });

  test('ordinary and durable output checks require exact input content and path', () => {
    const setup = fixture();
    expect(() =>
      assertLiveDeploymentFileOutput(setup.output, setup.inputPath),
    ).not.toThrow();
    expect(() =>
      assertLiveDeploymentFileOutput(setup.output, '/different-input'),
    ).toThrow();
    expect(() =>
      assertLiveDeploymentFileOutput(
        { ...setup.output, stable: false },
        setup.inputPath,
      ),
    ).toThrow();
  });
});
