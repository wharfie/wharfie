/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Offline acceptance fixtures. */
import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';

import {
  advanceLiveDeploymentSoak,
  createLiveDeploymentSoakCheckpoint,
  validateLiveDeploymentSoakCheckpoint,
  LIVE_DEPLOYMENT_SOAK_MAX_CHECKPOINT_BYTES,
  LIVE_DEPLOYMENT_SOAK_TICK_BUDGET_MS,
} from '../../scripts/live-deployment-soak.js';
import { LIVE_DEPLOYMENT_INPUT_BYTES } from '../../scripts/live-deployment-package.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';

/** Assemble one persistent fake host behind independently invoked controllers. */
function fixture(settings = /** @type {Record<string, any>} */ ({})) {
  const state = {
    appId: 'steady-file-demo',
    runId: '00000000-0000-4000-8000-000000000001',
    deploymentInstanceId: 'deployment-instance',
    guestRevisionId: 'guest-revision',
  };
  const bootId = '00000000-0000-4000-8000-000000000002';
  let wall = 1_000_000;
  let mono = 0;
  let starts = 0;
  let hostCreations = 0;
  let checkpoint = createLiveDeploymentSoakCheckpoint({
    state,
    startedAt: wall,
    durationMs: settings.durationMs ?? 900_000,
    intervalMs: settings.intervalMs ?? 240_000,
  });
  const runs = new Map();
  const commands = /** @type {Array<{name: string, args: string[]}>} */ ([]);
  const phases = /** @type {string[]} */ ([]);
  const receipts = /** @type {Record<string, any>} */ ({});
  const saves = /** @type {Record<string, any>[]} */ ([]);
  const resource = /** @type {Record<string, any>} */ ({
    schemaVersion: 1,
    kind: 'wharfie.live-deployment.resources',
    bootId,
    pid: 100,
    startTicks: '1000',
    residentRssBytes: 100 * 1024 * 1024,
    residentCpuTicks: 200,
    clockTicksPerSecond: 100,
    homeBytes: 100_000_000,
    appBytes: 90_000_000,
    stateBytes: 8_000_000,
    payloadBytes: 200_000,
    diskTotalBytes: 20_000_000_000,
    diskAvailableBytes: 10_000_000_000,
    userJournalBytesApprox: 8 * 1024 * 1024,
  });
  const fingerprint = {
    bytes: Buffer.byteLength(LIVE_DEPLOYMENT_INPUT_BYTES),
    sha256: createHash('sha256')
      .update(LIVE_DEPLOYMENT_INPUT_BYTES)
      .digest('hex'),
    readStable: true,
  };
  /** @param {string} inputPath */
  const output = (inputPath) => ({
    path: inputPath,
    stable: true,
    baseline: fingerprint,
    current: fingerprint,
  });
  /** @param {Record<string, any>} run */
  const view = (run) => {
    const activities = settings.waitForever
      ? ['capture']
      : ['capture', 'verify'];
    const terminal = !settings.waitForever;
    return {
      kind: 'wharfie.execution-ledger.run',
      integrity: { verified: true },
      run: {
        runId: settings.wrongRun ? 'other' : run.runId,
        appId: state.appId,
        revisionId: state.guestRevisionId,
        status: terminal ? 'COMPLETED' : 'RUNNING',
        trigger: { kind: 'workflow', workflowId: 'verify-stable' },
      },
      workflowCursor: {
        runId: run.runId,
        appId: state.appId,
        revisionId: state.guestRevisionId,
        disposition: terminal ? 'COMPLETED' : 'TIMER_WAITING',
      },
      timers: [
        {
          timerId: `${run.runId}-timer`,
          stepId: 'stability-window',
          status: terminal ? 'FIRED' : 'WAITING',
          scheduledAt: run.startedAt,
          dueAt: run.startedAt + (settings.wrongTimer ? 2000 : 1000),
        },
      ],
      invocations: activities.map((activityId) => ({
        activityId,
        invocationId: `${run.runId}-${activityId}`,
        status: 'COMPLETED',
        generation: 0,
      })),
      attempts: activities.flatMap((activityId) => [
        {
          invocationId: `${run.runId}-${activityId}`,
          attemptId: `${run.runId}-${activityId}-${settings.changedHistory ? 'changed' : 'attempt'}`,
          status: 'COMPLETED',
          generation: 0,
        },
        ...(settings.repeatedAttempt
          ? [
              {
                invocationId: `${run.runId}-${activityId}`,
                attemptId: 'duplicate',
                status: 'COMPLETED',
                generation: 0,
              },
            ]
          : []),
      ]),
    };
  };
  const host = {
    observe: async () => ({
      bootId,
      service: { health: settings.unhealthy ? 'failed' : 'healthy' },
      process: { pid: settings.restarted ? 101 : 100, startTicks: '1000' },
    }),
    /** @param {string} inputPath @param {string} bytes */
    stageSoakInput: async (inputPath, bytes) => {
      expect(inputPath).toMatch(/-soak-[0-9]{4}\.txt$/);
      expect(bytes).toBe(LIVE_DEPLOYMENT_INPUT_BYTES);
      if (settings.stageFailure) throw new Error('stage failed');
    },
    readSoakMarkers: async () =>
      (settings.repeatedMarker
        ? ['capture', 'capture', 'verify']
        : ['capture', 'verify']
      ).map((activity) => ({
        schemaVersion: 1,
        kind: 'wharfie.live-deployment.activity-entry',
        activity,
        bootId,
        processId: 101,
      })),
    /** @param {number} count */
    readSoakMarkerAudit: async (count) => {
      const bytes = (await host.readSoakMarkers())
        .map((marker) => `${JSON.stringify(marker)}\n`)
        .join('');
      return Array.from({ length: count }, (_, index) => ({
        sequence: index + 1,
        digest:
          settings.changedMiddleMarker && index === 1
            ? '0'.repeat(64)
            : createHash('sha256').update(bytes).digest('hex'),
      }));
    },
    observeResources: async () => {
      if (settings.sampleFailure) throw new Error('sample failed');
      mono += settings.resourceDurationMs ?? 0;
      wall += settings.resourceDurationMs ?? 0;
      return { ...resource };
    },
  };
  const options = () => ({
    state,
    checkpoint,
    dataRoot: '/controller',
    /** @param {string} name @param {string[]} args @param {number} timeoutMs */
    command: async (name, args, timeoutMs) => {
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThanOrEqual(60_000);
      commands.push({ name, args });
      mono += settings.commandDurationMs ?? 0;
      wall += settings.commandDurationMs ?? 0;
      let value;
      if (name === 'soak-start') {
        const key = args[args.indexOf('--idempotency-key') + 1];
        const runId = createWorkflowRunId({
          appId: state.appId,
          idempotencyKey: key,
        });
        if (checkpoint.pending.runId !== null)
          expect(checkpoint.pending.runId).toBe(runId);
        const reused = runs.has(runId);
        if (!reused) {
          runs.set(runId, { runId, inputPath: args.at(-1), startedAt: wall });
          starts++;
        }
        if (settings.lostStart) {
          settings.lostStart = false;
          throw new Error('lost response after admission');
        }
        value = {
          schemaVersion: 1,
          kind: 'wharfie.execution-ledger.workflow-start',
          appId: state.appId,
          revisionId: state.guestRevisionId,
          workflowId: 'verify-stable',
          runId,
          reused,
        };
      } else {
        const runId = args[args.indexOf('--run-id') + 1];
        const run = runs.get(runId);
        expect(run).toBeDefined();
        if (name === 'soak-inspect') value = view(run);
        else {
          expect(name).toBe('soak-output');
          value = {
            kind: 'wharfie.execution-ledger.run-output',
            integrity: { verified: true },
            scope: {
              appId: state.appId,
              revisionId: state.guestRevisionId,
              runId,
            },
            snapshot: { status: 'COMPLETED' },
            terminal: { type: 'completed', result: output(run.inputPath) },
            outputs: ['baseline', 'stability-window', 'comparison'].map(
              (stepId) => ({ stepId, value: output(run.inputPath) }),
            ),
          };
          if (settings.wrongOutput) value.terminal.result.stable = false;
        }
      }
      return { stdout: JSON.stringify(value) };
    },
    /** @param {string} name @param {() => Promise<any>} operation */
    phase: async (name, operation) => {
      phases.push(name);
      return await operation();
    },
    /** @param {string} name @param {Record<string, any>} value */
    receipt: (name, value) => {
      receipts[name] = value;
    },
    /** @param {Record<string, any>} value */
    saveCheckpoint: async (value) => {
      checkpoint = structuredClone(value);
      saves.push(checkpoint);
    },
  });
  const dependencies = {
    createHost: async () => {
      hostCreations++;
      return host;
    },
    wallNow: () => wall,
    now: () => mono,
    /** @param {number} milliseconds */
    wait: async (milliseconds) => {
      mono += milliseconds;
      wall += milliseconds;
    },
  };
  return {
    state,
    commands,
    phases,
    receipts,
    saves,
    resource,
    settings,
    get checkpoint() {
      return checkpoint;
    },
    get starts() {
      return starts;
    },
    get hostCreations() {
      return hostCreations;
    },
    options,
    dependencies,
    /** @param {number} value */
    setWall: (value) => {
      wall = value;
    },
    tick: async () => await advanceLiveDeploymentSoak(options(), dependencies),
  };
}

describe('bounded periodic live soak', () => {
  test('completes anchored periodic runs, records resources, and rechecks original history', async () => {
    const f = fixture();
    let result = await f.tick();
    expect(result.complete).toBe(false);
    expect(f.starts).toBe(1);
    expect(f.checkpoint.pending).toBeNull();
    expect(f.checkpoint.completed[0].ledgerDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(f.commands[0].args).toContain('--idempotency-key');
    expect(f.saves[0].pending.runId).toBeNull();
    expect(f.saves[1].pending.runId).toBe(f.checkpoint.completed[0].runId);
    while (!result.complete) {
      f.setWall(result.nextAt);
      result = await f.tick();
    }
    expect(f.starts).toBe(3);
    expect(f.checkpoint.samples).toHaveLength(4);
    expect(f.checkpoint.completed).toHaveLength(3);
    expect(f.receipts['soak-progress.json']).toMatchObject({
      complete: true,
      physicalExecutionVerified: true,
      committedHistoryVerified: true,
    });
    expect(Object.keys(f.receipts)).toEqual(['soak-progress.json']);
    const count = f.commands.length;
    await f.tick();
    expect(f.commands).toHaveLength(count);
  });

  test('holds the original deadline and does no guest work between scheduled ticks', async () => {
    const f = fixture();
    const result = await f.tick();
    const count = f.commands.length;
    f.setWall(result.nextAt - 1);
    expect((await f.tick()).nextAt).toBe(result.nextAt);
    expect(f.commands).toHaveLength(count);
    expect(f.checkpoint.endAt).toBe(1_900_000);
  });

  test('accepts 132-second observations with delayed wakeups while preserving three rehearsal runs and the fixed end', async () => {
    const f = fixture({
      commandDurationMs: 20_000,
      resourceDurationMs: 32_000,
    });
    let result;
    do {
      result = await f.tick();
      if (!result.complete) f.setWall(result.nextAt + 1000);
    } while (!result.complete);
    expect(f.starts).toBe(3);
    const thirdTickStart = f.checkpoint.startedAt + 2 * 240_000 + 1000;
    expect(f.checkpoint.samples[2].observedAt - thirdTickStart).toBe(132_000);
    expect(
      f.commands.filter((command) => command.name === 'soak-start'),
    ).toHaveLength(3);
    expect(f.checkpoint.completed.at(-1).completedAt).toBeLessThan(
      f.checkpoint.endAt,
    );
    expect(f.checkpoint.samples.at(-2).observedAt).toBeLessThan(
      f.checkpoint.endAt,
    );
    expect(f.checkpoint.samples.at(-1).observedAt).toBeGreaterThanOrEqual(
      f.checkpoint.endAt,
    );
    expect(f.checkpoint.samples).toHaveLength(4);
    expect(f.checkpoint.endAt).toBe(1_900_000);
  });

  test('refuses a late final run before guest commands when its full observation window is unavailable', async () => {
    const f = fixture();
    for (let index = 0; index < 2; index++) {
      const result = await f.tick();
      f.setWall(result.nextAt);
    }
    const count = f.commands.length;
    const hostCreations = f.hostCreations;
    f.setWall(f.checkpoint.endAt - LIVE_DEPLOYMENT_SOAK_TICK_BUDGET_MS + 1);
    await expect(f.tick()).rejects.toMatchObject({
      diagnostic: {
        soakFaultStage: 'coverage',
        soakFaultCode: 'admission-deadline',
        soakObservedMs: 299_999,
        soakLimitMs: 300_000,
      },
    });
    expect(f.commands).toHaveLength(count);
    expect(f.hostCreations).toBe(hostCreations);
    expect(f.starts).toBe(2);
    expect(f.checkpoint.endAt).toBe(1_900_000);
  });

  test.each(['lostStart', 'sampleFailure'])(
    'resumes an interrupted %s with the same physical run',
    async (fault) => {
      const f = fixture({ [fault]: true });
      await expect(f.tick()).rejects.toThrow();
      expect(f.starts).toBe(1);
      const pending = structuredClone(f.checkpoint.pending);
      f.settings[fault] = false;
      await f.tick();
      expect(f.starts).toBe(1);
      expect(f.checkpoint.completed[0].runId).toBe(
        createWorkflowRunId({
          appId: f.state.appId,
          idempotencyKey: pending.idempotencyKey,
        }),
      );
      const keys = f.commands
        .filter((command) => command.name === 'soak-start')
        .map(
          (command) =>
            command.args[command.args.indexOf('--idempotency-key') + 1],
        );
      expect(new Set(keys).size).toBe(1);
    },
  );

  test.each([
    'wrongRun',
    'wrongTimer',
    'repeatedAttempt',
    'repeatedMarker',
    'wrongOutput',
  ])('refuses %s proof without marking work complete', async (fault) => {
    const f = fixture({ [fault]: true });
    await expect(f.tick()).rejects.toThrow();
    expect(f.checkpoint.completed).toHaveLength(0);
    expect(f.checkpoint.pending).not.toBeNull();
  });

  test.each(['changedHistory', 'repeatedMarker', 'restarted'])(
    'detects later %s before submitting more work',
    async (fault) => {
      const f = fixture();
      const result = await f.tick();
      f.settings[fault] = true;
      f.setWall(result.nextAt);
      await expect(f.tick()).rejects.toThrow();
      expect(f.starts).toBe(1);
    },
  );

  test('bounds a hung workflow with the monotonic deadline', async () => {
    const f = fixture({ waitForever: true });
    await expect(f.tick()).rejects.toMatchObject({
      diagnostic: {
        soakFaultStage: 'workflow',
        soakFaultCode: 'tick-deadline',
        soakObservedMs: 300_000,
        soakLimitMs: 300_000,
        timedOut: true,
      },
    });
    expect(f.commands.length).toBeLessThan(305);
    expect(f.checkpoint.completed).toHaveLength(0);
    expect(f.starts).toBe(1);
  });

  test('classifies a resource observation over five minutes without committing or retrying its work', async () => {
    const f = fixture({ resourceDurationMs: 300_001 });
    const error = await f.tick().catch((failure) => failure);
    expect(error.message).toBe('Live soak observation failed.');
    expect(error.diagnostic).toEqual({
      soakFaultStage: 'resources',
      soakFaultCode: 'tick-deadline',
      soakObservedMs: 300_001,
      soakLimitMs: 300_000,
      timedOut: true,
    });
    expect(f.starts).toBe(1);
    expect(
      f.commands.filter((command) => command.name === 'soak-start'),
    ).toHaveLength(1);
    expect(f.checkpoint.completed).toHaveLength(0);
    expect(f.checkpoint.samples).toHaveLength(0);
    expect(f.checkpoint.pending.runId).not.toBeNull();
    expect(f.receipts).toEqual({});
    expect(f.checkpoint.endAt).toBe(1_900_000);
  });

  test('keeps an actual resource-limit fault distinct when the same sample also overruns', async () => {
    const f = fixture({ resourceDurationMs: 300_001 });
    f.resource.residentRssBytes = 513 * 1024 * 1024;
    const error = await f.tick().catch((failure) => failure);
    expect(error.diagnostic).toEqual({
      soakFaultStage: 'resources',
      soakFaultCode: 'resident-rss-limit',
      soakObservedBytes: 513 * 1024 * 1024,
      soakLimitBytes: 512 * 1024 * 1024,
    });
    expect(f.starts).toBe(1);
    expect(f.checkpoint.completed).toHaveLength(0);
    expect(f.checkpoint.pending).not.toBeNull();
  });

  test('rejects an observer coverage gap instead of treating elapsed idle time as a passing soak', async () => {
    const f = fixture();
    await f.tick();
    f.setWall(f.checkpoint.startedAt + 480_001);
    await expect(f.tick()).rejects.toMatchObject({
      diagnostic: {
        soakFaultStage: 'coverage',
        soakFaultCode: 'assertion',
      },
    });
    expect(f.starts).toBe(1);
  });

  test('audits every physical marker at completion, including a changed middle run', async () => {
    const f = fixture();
    let result;
    for (let index = 0; index < 3; index++) {
      result = await f.tick();
      f.setWall(result.nextAt);
    }
    expect(f.starts).toBe(3);
    f.settings.changedMiddleMarker = true;
    await expect(f.tick()).rejects.toMatchObject({
      diagnostic: {
        soakFaultStage: 'final-markers',
        soakFaultCode: 'assertion',
      },
    });
    expect(f.checkpoint.complete).toBe(false);
    expect(f.checkpoint.samples).toHaveLength(3);
  });

  test('rejects a clock rollback before the next scheduled tick', async () => {
    const f = fixture();
    await f.tick();
    f.setWall(f.checkpoint.startedAt - 1);
    await expect(f.tick()).rejects.toMatchObject({
      diagnostic: {
        soakFaultStage: 'coverage',
        soakFaultCode: 'assertion',
      },
    });
  });

  test.each([
    [
      'residentRssBytes',
      513 * 1024 * 1024,
      512 * 1024 * 1024,
      'resident-rss-limit',
    ],
    [
      'diskAvailableBytes',
      128 * 1024 * 1024,
      256 * 1024 * 1024,
      'disk-headroom-limit',
    ],
    ['stateBytes', 513 * 1024 * 1024, 512 * 1024 * 1024, 'state-size-limit'],
    [
      'userJournalBytesApprox',
      257 * 1024 * 1024,
      256 * 1024 * 1024,
      'user-journal-size-limit',
    ],
  ])(
    'fails finite resource guard %s while retaining the original submission',
    async (field, value, limit, code) => {
      const f = fixture();
      f.resource[field] = value;
      f.resource.appBytes = Math.max(
        f.resource.appBytes,
        f.resource.stateBytes,
      );
      f.resource.homeBytes = Math.max(
        f.resource.homeBytes,
        f.resource.appBytes,
      );
      await expect(f.tick()).rejects.toMatchObject({
        diagnostic: {
          soakFaultStage: 'resources',
          soakFaultCode: code,
          soakObservedBytes: value,
          soakLimitBytes: limit,
        },
      });
      expect(f.checkpoint.pending).not.toBeNull();
      expect(f.checkpoint.completed).toHaveLength(0);
      expect(f.starts).toBe(1);
      expect(
        f.commands.filter((command) => command.name === 'soak-start'),
      ).toHaveLength(1);
    },
  );

  test('accepts the unchanged exact RSS, state, disk-headroom, and journal limits', async () => {
    const f = fixture();
    Object.assign(f.resource, {
      residentRssBytes: 512 * 1024 * 1024,
      stateBytes: 512 * 1024 * 1024,
      appBytes: 512 * 1024 * 1024,
      homeBytes: 512 * 1024 * 1024,
      diskAvailableBytes: 256 * 1024 * 1024,
      userJournalBytesApprox: 256 * 1024 * 1024,
    });
    expect((await f.tick()).complete).toBe(false);
    expect(f.checkpoint.completed).toHaveLength(1);
    expect(f.checkpoint.samples[0].resource).toEqual(f.resource);
  });

  test('rejects tampered scope, run identity, pending path and unknown metadata before host access', async () => {
    const f = fixture({ stageFailure: true });
    await expect(f.tick()).rejects.toMatchObject({
      diagnostic: {
        soakFaultStage: 'workflow',
        soakFaultCode: 'operation-failed',
      },
    });
    const mutations =
      /** @type {Array<(value: Record<string, any>) => void>} */ ([
        (value) => {
          value.binding.guestRevisionId = 'another';
        },
        (value) => {
          value.pending.runId = 'another';
        },
        (value) => {
          value.pending.inputPath = '/etc/passwd';
        },
        (value) => {
          value.secret = 'credential';
        },
        (value) => {
          value.endAt += 73 * 60 * 60 * 1000;
        },
      ]);
    for (const mutate of mutations) {
      const checkpoint = structuredClone(f.checkpoint);
      mutate(checkpoint);
      expect(() =>
        validateLiveDeploymentSoakCheckpoint(checkpoint, f.state),
      ).toThrow();
    }
  });

  test('retains all 72-hour evidence within its report byte and sample budgets', async () => {
    const f = fixture({
      durationMs: 72 * 60 * 60 * 1000,
      intervalMs: 900_000,
      commandDurationMs: 20_000,
      resourceDurationMs: 32_000,
    });
    let result;
    do {
      result = await f.tick();
      if (!result.complete) f.setWall(result.nextAt + 1000);
    } while (!result.complete);
    expect(f.checkpoint.completed).toHaveLength(288);
    expect(f.checkpoint.samples).toHaveLength(289);
    expect(f.checkpoint.endAt).toBe(
      f.checkpoint.startedAt + 72 * 60 * 60 * 1000,
    );
    expect(f.checkpoint.completed.at(-1).completedAt).toBeLessThan(
      f.checkpoint.endAt,
    );
    expect(Buffer.byteLength(JSON.stringify(f.checkpoint))).toBeLessThan(
      LIVE_DEPLOYMENT_SOAK_MAX_CHECKPOINT_BYTES,
    );
  });
});
