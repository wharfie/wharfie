/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Bounded acceptance orchestration with injected clocks and host ports. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { assertDomainSeparatedSha256Id } from '../src/core/runtime/content-id.js';
import { createLiveDeploymentHost } from './live-deployment-host.js';
import {
  assertActivities,
  assertLiveDeploymentFileOutput,
  assertRun,
  runReceipt,
} from './live-deployment-durability.js';
import { LIVE_DEPLOYMENT_INPUT_BYTES } from './live-deployment-package.js';

export const LIVE_DEPLOYMENT_SOAK_MAX_CHECKPOINT_BYTES = 256 * 1024;
export const LIVE_DEPLOYMENT_SOAK_MAX_RUNS = 299;
export const LIVE_DEPLOYMENT_SOAK_TICK_BUDGET_MS = 120_000;
export const LIVE_DEPLOYMENT_SOAK_FAULT_STAGES = Object.freeze([
  'scope',
  'coverage',
  'host',
  'history',
  'workflow',
  'resources',
  'final-markers',
  'checkpoint',
]);
export const LIVE_DEPLOYMENT_SOAK_FAULT_CODES = Object.freeze([
  'assertion',
  'invalid-json',
  'aborted',
  'operation-failed',
]);
const MAX_DURATION_MS = 72 * 60 * 60 * 1000;
const HASH = /^[0-9a-f]{64}$/;
const BOOT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESOURCE_KEYS = [
  'schemaVersion',
  'kind',
  'bootId',
  'pid',
  'startTicks',
  'residentRssBytes',
  'residentCpuTicks',
  'clockTicksPerSecond',
  'homeBytes',
  'appBytes',
  'stateBytes',
  'payloadBytes',
  'diskTotalBytes',
  'diskAvailableBytes',
  'userJournalBytesApprox',
];

/** @param {unknown} value @param {string[]} keys */
function exact(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

/** @param {number} value @param {number} [minimum] */
function integer(value, minimum = 0) {
  assert.ok(Number.isSafeInteger(value) && value >= minimum);
}

/** @param {unknown} value */
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Leave the final admitted run its full observation budget before the fixed end.
 * @param {Record<string, any>} checkpoint
 */
function expectedRunCount(checkpoint) {
  return (
    Math.floor(
      (checkpoint.endAt -
        checkpoint.startedAt -
        LIVE_DEPLOYMENT_SOAK_TICK_BUDGET_MS) /
        checkpoint.intervalMs,
    ) + 1
  );
}

/** @param {Record<string, any>} state */
function binding(state) {
  return Object.fromEntries(
    ['runId', 'appId', 'deploymentInstanceId', 'guestRevisionId'].map((key) => {
      assert.ok(typeof state[key] === 'string' && state[key].length <= 256);
      return [key, state[key]];
    }),
  );
}

/** @param {Record<string, any>} state @param {number} sequence */
function intent(state, sequence) {
  const idempotencyKey = `soak:${state.runId}:${sequence}`;
  return {
    sequence,
    idempotencyKey,
    inputPath: `/home/wharfie/live-acceptance-${state.runId}-soak-${String(sequence).padStart(4, '0')}.txt`,
  };
}

/** @param {Record<string, any>} resource */
function assertResources(resource) {
  exact(resource, RESOURCE_KEYS);
  assert.equal(resource.schemaVersion, 1);
  assert.equal(resource.kind, 'wharfie.live-deployment.resources');
  assert.match(resource.bootId, BOOT_ID);
  assert.match(resource.startTicks, /^[0-9]{1,20}$/);
  for (const key of RESOURCE_KEYS.filter(
    (name) => !['kind', 'bootId', 'startTicks'].includes(name),
  ))
    integer(resource[key]);
  assert.ok(resource.pid > 0 && resource.clockTicksPerSecond > 0);
  assert.ok(resource.diskAvailableBytes <= resource.diskTotalBytes);
  assert.ok(resource.payloadBytes <= resource.stateBytes);
  assert.ok(resource.stateBytes <= resource.appBytes);
  assert.ok(resource.appBytes <= resource.homeBytes);
}

/**
 * Create an immutable wall-clock budget after the host first becomes healthy.
 * The caller durably saves this document before invoking the first tick.
 * @param {Record<string, any>} options
 */
export function createLiveDeploymentSoakCheckpoint(options) {
  const checkpoint = {
    schemaVersion: 1,
    kind: 'wharfie.live-deployment.soak-checkpoint',
    binding: binding(options.state),
    startedAt: options.startedAt,
    endAt: options.startedAt + options.durationMs,
    intervalMs: options.intervalMs ?? 900_000,
    timerDelayMs: options.timerDelayMs ?? 1000,
    completed: [],
    samples: [],
    pending: null,
    complete: false,
  };
  return validateLiveDeploymentSoakCheckpoint(checkpoint, options.state);
}

/**
 * Validate retained authority before any command, fixture write, or host read.
 * @param {Record<string, any>} checkpoint
 * @param {Record<string, any>} state
 */
export function validateLiveDeploymentSoakCheckpoint(checkpoint, state) {
  assert.ok(
    Buffer.byteLength(JSON.stringify(checkpoint)) <=
      LIVE_DEPLOYMENT_SOAK_MAX_CHECKPOINT_BYTES,
  );
  exact(checkpoint, [
    'schemaVersion',
    'kind',
    'binding',
    'startedAt',
    'endAt',
    'intervalMs',
    'timerDelayMs',
    'completed',
    'samples',
    'pending',
    'complete',
  ]);
  assert.equal(checkpoint.schemaVersion, 1);
  assert.equal(checkpoint.kind, 'wharfie.live-deployment.soak-checkpoint');
  const expectedBinding = binding(state);
  exact(checkpoint.binding, Object.keys(expectedBinding));
  for (const [key, value] of Object.entries(expectedBinding))
    assert.equal(checkpoint.binding[key], value);
  integer(checkpoint.startedAt, 1);
  integer(checkpoint.endAt, checkpoint.startedAt + 900_000);
  assert.ok(checkpoint.endAt - checkpoint.startedAt <= MAX_DURATION_MS);
  integer(checkpoint.intervalMs, 60_000);
  assert.ok(checkpoint.intervalMs <= 900_000);
  integer(checkpoint.timerDelayMs, 1);
  assert.ok(checkpoint.timerDelayMs <= 30_000);
  const expectedRuns = expectedRunCount(checkpoint);
  assert.ok(expectedRuns <= LIVE_DEPLOYMENT_SOAK_MAX_RUNS);
  assert.ok(
    Array.isArray(checkpoint.completed) &&
      checkpoint.completed.length <= expectedRuns,
  );
  assert.ok(
    Array.isArray(checkpoint.samples) &&
      checkpoint.samples.length <= expectedRuns + 1,
  );
  assert.equal(typeof checkpoint.complete, 'boolean');
  let previousAt = checkpoint.startedAt;
  checkpoint.completed.forEach(
    (/** @type {Record<string, any>} */ entry, /** @type {number} */ index) => {
      exact(entry, [
        'sequence',
        'runId',
        'submittedAt',
        'completedAt',
        'ledgerDigest',
        'markerDigest',
      ]);
      const expected = intent(state, index + 1);
      assert.equal(entry.sequence, expected.sequence);
      assertDomainSeparatedSha256Id(entry.runId, 'wfr', 'Soak workflow run');
      integer(entry.submittedAt, previousAt);
      assert.ok(
        entry.submittedAt >=
          checkpoint.startedAt + index * checkpoint.intervalMs,
      );
      integer(entry.completedAt, entry.submittedAt);
      assert.ok(entry.submittedAt < checkpoint.endAt);
      assert.match(entry.ledgerDigest, HASH);
      assert.match(entry.markerDigest, HASH);
      previousAt = entry.completedAt;
    },
  );
  previousAt = checkpoint.startedAt;
  checkpoint.samples.forEach(
    (
      /** @type {Record<string, any>} */ sample,
      /** @type {number} */ index,
    ) => {
      exact(sample, ['sequence', 'observedAt', 'resource']);
      assert.equal(sample.sequence, Math.min(index + 1, expectedRuns));
      integer(sample.observedAt, previousAt);
      assert.ok(
        sample.observedAt - previousAt <= 2 * checkpoint.intervalMs,
        'Soak observation coverage has a gap exceeding two intervals.',
      );
      assertResources(sample.resource);
      if (index < checkpoint.completed.length)
        assert.ok(sample.observedAt >= checkpoint.completed[index].completedAt);
      if (index > 0) {
        const previous = checkpoint.samples[index - 1].resource;
        for (const key of [
          'bootId',
          'pid',
          'startTicks',
          'clockTicksPerSecond',
        ])
          assert.equal(sample.resource[key], previous[key]);
        assert.ok(
          sample.resource.residentCpuTicks >= previous.residentCpuTicks,
        );
      }
      previousAt = sample.observedAt;
    },
  );
  assert.equal(
    checkpoint.samples.length,
    checkpoint.completed.length + (checkpoint.complete ? 1 : 0),
  );
  if (checkpoint.pending !== null) {
    exact(checkpoint.pending, [
      'sequence',
      'runId',
      'idempotencyKey',
      'inputPath',
      'submittedAt',
    ]);
    const expected = intent(state, checkpoint.completed.length + 1);
    assert.ok(expected.sequence <= expectedRuns);
    for (const [key, value] of Object.entries(expected))
      assert.equal(checkpoint.pending[key], value);
    if (checkpoint.pending.runId !== null)
      assertDomainSeparatedSha256Id(
        checkpoint.pending.runId,
        'wfr',
        'Pending soak workflow run',
      );
    integer(checkpoint.pending.submittedAt, checkpoint.startedAt);
    assert.ok(checkpoint.pending.submittedAt < checkpoint.endAt);
  }
  if (checkpoint.complete) {
    assert.equal(checkpoint.pending, null);
    assert.equal(checkpoint.completed.length, expectedRuns);
    assert.equal(checkpoint.samples.length, expectedRuns + 1);
    assert.ok(checkpoint.samples.at(-1).observedAt >= checkpoint.endAt);
  }
  const runIds = checkpoint.completed.map(
    (/** @type {Record<string, any>} */ entry) => entry.runId,
  );
  assert.equal(new Set(runIds).size, runIds.length);
  if (checkpoint.pending?.runId)
    assert.ok(!runIds.includes(checkpoint.pending.runId));
  return JSON.parse(JSON.stringify(checkpoint));
}

/**
 * Compact human-facing growth and latency observations derived from retained samples.
 * @param {Record<string, any>} checkpoint
 */
export function summarizeLiveDeploymentSoak(checkpoint) {
  const samples = /** @type {Record<string, any>[]} */ (checkpoint.samples);
  const latency = /** @type {Record<string, any>[]} */ (
    checkpoint.completed
  ).map((entry) => entry.completedAt - entry.submittedAt);
  const first = samples[0];
  const last = samples.at(-1);
  const metrics = /** @type {Record<string, any>} */ ({});
  if (first && last) {
    for (const key of [
      'residentRssBytes',
      'homeBytes',
      'appBytes',
      'stateBytes',
      'payloadBytes',
      'diskAvailableBytes',
      'userJournalBytesApprox',
    ]) {
      metrics[key] = {
        first: first.resource[key],
        last: last.resource[key],
        peak: Math.max(...samples.map((sample) => sample.resource[key])),
        change: last.resource[key] - first.resource[key],
      };
    }
  }
  return {
    elapsedMs: last ? last.observedAt - checkpoint.startedAt : 0,
    completedRuns: checkpoint.completed.length,
    latencyMs: latency.length
      ? {
          minimum: Math.min(...latency),
          maximum: Math.max(...latency),
          mean: Math.round(
            latency.reduce((sum, value) => sum + value, 0) / latency.length,
          ),
        }
      : null,
    residentCpuSeconds:
      first && last
        ? (last.resource.residentCpuTicks - first.resource.residentCpuTicks) /
          last.resource.clockTicksPerSecond
        : 0,
    maximumSampleGapMs: samples.length
      ? Math.max(
          ...samples.map(
            (sample, index) =>
              sample.observedAt -
              (index ? samples[index - 1].observedAt : checkpoint.startedAt),
          ),
        )
      : 0,
    metrics,
  };
}

/** @param {Record<string, any>} view @param {Record<string, any>} checkpoint */
function completedRun(view, checkpoint) {
  assert.equal(view.run.status, 'COMPLETED');
  assert.equal(view.workflowCursor.disposition, 'COMPLETED');
  assert.equal(view.timers.length, 1);
  const timer = view.timers[0];
  assert.equal(timer.status, 'FIRED');
  assert.equal(timer.stepId, 'stability-window');
  assert.equal(timer.dueAt - timer.scheduledAt, checkpoint.timerDelayMs);
  assertActivities(view, ['capture', 'verify']);
  return digest(runReceipt(view));
}

/** @param {Record<string, any>[]} markers @param {string} bootId */
function physicalExecution(markers, bootId) {
  assert.deepEqual(
    markers.map((marker) => marker.activity),
    ['capture', 'verify'],
  );
  for (const marker of markers) {
    exact(marker, ['schemaVersion', 'kind', 'activity', 'bootId', 'processId']);
    assert.equal(marker.schemaVersion, 1);
    assert.equal(marker.kind, 'wharfie.live-deployment.activity-entry');
    assert.equal(marker.bootId, bootId);
    integer(marker.processId, 1);
  }
  // The acceptance wrapper writes exactly one JSON object and newline per
  // physical execution. This digest can be rechecked remotely over every file
  // at the final boundary without downloading raw activity evidence again.
  return createHash('sha256')
    .update(markers.map((marker) => `${JSON.stringify(marker)}\n`).join(''))
    .digest('hex');
}

/**
 * Advance at most one periodic run. Each public command launches a fresh
 * packaged controller, which has exited before the command port resolves.
 * A persisted idempotency key closes the lost-response window. Once the public
 * receipt arrives its run ID is retained before inspecting or recording work.
 * @param {Record<string, any>} options
 * @param {Record<string, any>} [dependencies]
 */
export async function advanceLiveDeploymentSoak(options, dependencies = {}) {
  let stage = 'scope';
  try {
    const ports = {
      createHost: createLiveDeploymentHost,
      wait: delay,
      now: () => performance.now(),
      wallNow: () => Date.now(),
      ...dependencies,
    };
    const { state } = options;
    const checkpoint = validateLiveDeploymentSoakCheckpoint(
      options.checkpoint,
      state,
    );
    assert.equal(typeof options.saveCheckpoint, 'function');
    const save = async () => {
      const previousStage = stage;
      stage = 'checkpoint';
      validateLiveDeploymentSoakCheckpoint(checkpoint, state);
      await options.saveCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
      stage = previousStage;
    };
    const expectedRuns = expectedRunCount(checkpoint);
    const nextAt = () =>
      checkpoint.completed.length === expectedRuns
        ? checkpoint.endAt
        : checkpoint.startedAt +
          checkpoint.completed.length * checkpoint.intervalMs;
    if (checkpoint.complete)
      return { checkpoint, complete: true, nextAt: checkpoint.endAt };
    stage = 'coverage';
    const lastAt =
      checkpoint.samples.at(-1)?.observedAt ?? checkpoint.startedAt;
    assert.ok(
      ports.wallNow() >= lastAt,
      'Soak observer clock moved backwards.',
    );
    if (!checkpoint.pending && ports.wallNow() < nextAt())
      return { checkpoint, complete: false, nextAt: nextAt() };
    assert.ok(
      ports.wallNow() - lastAt <= 2 * checkpoint.intervalMs,
      'Soak observation coverage has a gap exceeding two intervals.',
    );
    if (checkpoint.completed.length < expectedRuns)
      assert.ok(
        ports.wallNow() <=
          checkpoint.endAt - LIVE_DEPLOYMENT_SOAK_TICK_BUDGET_MS,
        'Soak deadline has insufficient time for the remaining observation.',
      );
    /** @type {(name: string, operation: () => Promise<any>) => Promise<any>} */
    const phase =
      options.phase ?? (async (_name, operation) => await operation());
    const receipt = options.receipt ?? (() => {});
    stage = 'host';
    const deadline = ports.now() + LIVE_DEPLOYMENT_SOAK_TICK_BUDGET_MS;
    const host = await ports.createHost(options);
    const selectors = [
      '--deployment-instance',
      state.deploymentInstanceId,
      '--data-root',
      options.dataRoot,
    ];
    const check = () => {
      options.signal?.throwIfAborted();
      assert.ok(
        ports.now() < deadline,
        'Soak tick exceeded its finite deadline.',
      );
    };
    /** @param {string} name @param {string[]} args */
    const exec = async (name, args) => {
      check();
      const result = await options.command(
        name,
        ['wharfie', 'deployment', 'exec', ...selectors, '--', ...args],
        Math.max(1, Math.min(60_000, Math.floor(deadline - ports.now()))),
      );
      assert.ok(Buffer.byteLength(result.stdout) <= 256 * 1024);
      return JSON.parse(result.stdout);
    };
    /** @param {string} runId */
    const inspect = async (runId) => {
      const view = await exec('soak-inspect', [
        'wharfie',
        'inspect',
        '--run-id',
        runId,
        '--json',
      ]);
      assertRun(view, state, runId);
      return view;
    };
    const before = await host.observe();
    assert.equal(before.service.health, 'healthy');
    assert.ok(before.process);
    const resident = before.process;
    const firstResource = checkpoint.samples[0]?.resource;
    if (firstResource) {
      assert.equal(before.bootId, firstResource.bootId);
      assert.equal(before.process.pid, firstResource.pid);
      assert.equal(String(before.process.startTicks), firstResource.startTicks);
    }
    await phase('soak-history', async () => {
      stage = 'history';
      const selections = [
        ...new Set(
          [checkpoint.completed[0], checkpoint.completed.at(-1)].filter(
            Boolean,
          ),
        ),
      ];
      for (const entry of selections) {
        check();
        assert.equal(
          completedRun(await inspect(entry.runId), checkpoint),
          entry.ledgerDigest,
          'Committed soak history changed.',
        );
        assert.equal(
          physicalExecution(
            await host.readSoakMarkers(intent(state, entry.sequence).inputPath),
            before.bootId,
          ),
          entry.markerDigest,
          'A committed physical activity repeated.',
        );
      }
    });
    if (checkpoint.completed.length < expectedRuns) {
      stage = 'coverage';
      assert.ok(
        ports.wallNow() < checkpoint.endAt,
        'Soak deadline elapsed before all scheduled runs were submitted.',
      );
      if (!checkpoint.pending) {
        checkpoint.pending = {
          ...intent(state, checkpoint.completed.length + 1),
          runId: null,
          submittedAt: ports.wallNow(),
        };
        await save();
      }
      const pending = checkpoint.pending;
      await phase('soak-workflow', async () => {
        stage = 'workflow';
        check();
        await host.stageSoakInput(
          pending.inputPath,
          LIVE_DEPLOYMENT_INPUT_BYTES,
        );
        const started = await exec('soak-start', [
          'wharfie',
          'start',
          '--idempotency-key',
          pending.idempotencyKey,
          '--json',
          '--',
          pending.inputPath,
        ]);
        assert.equal(started.schemaVersion, 1);
        assert.equal(started.kind, 'wharfie.execution-ledger.workflow-start');
        assert.equal(started.appId, state.appId);
        assert.equal(started.revisionId, state.guestRevisionId);
        assert.equal(started.workflowId, 'verify-stable');
        assertDomainSeparatedSha256Id(
          started.runId,
          'wfr',
          'Started soak workflow run',
        );
        if (pending.runId !== null) assert.equal(started.runId, pending.runId);
        assert.equal(typeof started.reused, 'boolean');
        pending.runId = started.runId;
        await save();
        let view;
        for (;;) {
          check();
          view = await inspect(pending.runId);
          if (view.workflowCursor.disposition === 'COMPLETED') break;
          assert.equal(view.run.status, 'RUNNING');
          await ports.wait(
            Math.min(1000, Math.max(1, deadline - ports.now())),
            undefined,
            { signal: options.signal },
          );
        }
        const ledgerDigest = completedRun(view, checkpoint);
        const markerDigest = physicalExecution(
          await host.readSoakMarkers(pending.inputPath),
          before.bootId,
        );
        const output = await exec('soak-output', [
          'wharfie',
          'output',
          '--run-id',
          pending.runId,
          '--confirm-sensitive-output',
          '--json',
        ]);
        assert.equal(output.kind, 'wharfie.execution-ledger.run-output');
        assert.deepEqual(output.integrity, { verified: true });
        assert.deepEqual(output.scope, {
          appId: state.appId,
          revisionId: state.guestRevisionId,
          runId: pending.runId,
        });
        assert.equal(output.snapshot.status, 'COMPLETED');
        assert.equal(output.terminal.type, 'completed');
        assert.deepEqual(
          output.outputs.map(
            (/** @type {Record<string, any>} */ entry) => entry.stepId,
          ),
          ['baseline', 'stability-window', 'comparison'],
        );
        assertLiveDeploymentFileOutput(
          output.terminal.result,
          pending.inputPath,
        );
        assertLiveDeploymentFileOutput(
          output.outputs.at(-1).value,
          pending.inputPath,
        );
        checkpoint.completed.push({
          sequence: pending.sequence,
          runId: pending.runId,
          submittedAt: pending.submittedAt,
          completedAt: ports.wallNow(),
          ledgerDigest,
          markerDigest,
        });
        checkpoint.pending = null;
        // Sample and completion commit together. A lost save reuses the same key
        // and verifies the same finished work before recording its observation.
      });
    }
    await phase('soak-resources', async () => {
      stage = 'resources';
      check();
      const resource = await host.observeResources();
      assertResources(resource);
      assert.equal(resource.bootId, before.bootId);
      assert.equal(resource.pid, resident.pid);
      assert.equal(resource.startTicks, String(resident.startTicks));
      const previous = checkpoint.samples.at(-1)?.resource;
      if (previous) {
        assert.ok(resource.residentCpuTicks >= previous.residentCpuTicks);
        assert.equal(
          resource.clockTicksPerSecond,
          previous.clockTicksPerSecond,
        );
      }
      assert.ok(
        resource.residentRssBytes <= 512 * 1024 * 1024,
        'Soak resident RSS exceeded the 512 MiB guard.',
      );
      assert.ok(
        resource.diskAvailableBytes >= 256 * 1024 * 1024,
        'Soak disk headroom fell below 256 MiB.',
      );
      assert.ok(
        resource.stateBytes <= 512 * 1024 * 1024,
        'Soak state exceeded the 512 MiB guard.',
      );
      assert.ok(
        resource.userJournalBytesApprox <= 256 * 1024 * 1024,
        'Soak user journal exceeded the 256 MiB guard.',
      );
      checkpoint.samples.push({
        sequence: checkpoint.completed.length,
        observedAt: ports.wallNow(),
        resource,
      });
      const terminal = ports.wallNow() >= checkpoint.endAt;
      if (terminal) {
        assert.equal(checkpoint.completed.length, expectedRuns);
        assert.equal(checkpoint.samples.length, expectedRuns + 1);
        stage = 'final-markers';
        check();
        const audit = await host.readSoakMarkerAudit(expectedRuns);
        assert.equal(audit.length, expectedRuns);
        audit.forEach((entry, index) => {
          assert.equal(entry.sequence, index + 1);
          assert.equal(
            entry.digest,
            checkpoint.completed[index].markerDigest,
            'Committed physical activity evidence changed before final cleanup.',
          );
        });
        checkpoint.complete = true;
      }
      check();
      await save();
    });
    const value = {
      schemaVersion: 1,
      kind: 'wharfie.live-deployment.soak-progress',
      startedAt: checkpoint.startedAt,
      endAt: checkpoint.endAt,
      completedRuns: checkpoint.completed.length,
      expectedRuns,
      observationCount: checkpoint.samples.length,
      firstRunId: checkpoint.completed[0].runId,
      lastRunId: checkpoint.completed.at(-1).runId,
      controllerExitedBetweenCommands: true,
      committedHistoryVerified: true,
      recheckedHistory: 'first-and-most-recent',
      physicalExecutionVerified: true,
      finalAllPhysicalMarkersVerified: checkpoint.complete,
      complete: checkpoint.complete,
      observations: summarizeLiveDeploymentSoak(checkpoint),
      resources: checkpoint.samples.at(-1).resource,
    };
    receipt('soak-progress.json', value);
    return { checkpoint, complete: checkpoint.complete, nextAt: nextAt() };
  } catch (error) {
    const source = /** @type {Record<string, any>} */ (error);
    throw Object.assign(new Error('Live soak observation failed.'), {
      diagnostic: {
        ...source?.diagnostic,
        soakFaultStage: stage,
        soakFaultCode:
          source?.code === 'ERR_ASSERTION'
            ? 'assertion'
            : source?.name === 'SyntaxError'
              ? 'invalid-json'
              : source?.name === 'AbortError' || options.signal?.aborted
                ? 'aborted'
                : 'operation-failed',
      },
    });
  }
}
