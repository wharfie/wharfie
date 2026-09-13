/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns -- Offline public-document acceptance fixtures. */
import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';

import { runReceipt } from '../../scripts/live-deployment-durability.js';
import {
  LIVE_DEPLOYMENT_INPUT_BYTES,
  LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS,
  LIVE_DEPLOYMENT_TIMER_DELAY_MS,
} from '../../scripts/live-deployment-package.js';
import {
  createLiveDeploymentUpdateAcceptance,
  liveDeploymentReleaseReceipt,
} from '../../scripts/live-deployment-updates.js';

/** @param {Record<string, any>} [settings] */
function fixture(settings = {}) {
  const state = {
    appId: 'steady-file-demo',
    provider: 'hetzner',
    deploymentId: 'acceptance-fixture',
    deploymentInstanceId: 'deployment-instance',
    desiredRevisionId: 'desired-a',
    guestArtifactId: 'artifact-a',
    guestRevisionId: 'revision-a',
    artifactRecord: { artifactId: 'controller-a' },
    nextRelease: {
      desiredRevisionId: 'desired-b',
      guestArtifactId: 'artifact-b',
      guestRevisionId: 'revision-b',
    },
  };
  const inputPath = '/home/wharfie/acceptance-input.txt';
  const records = /** @type {Record<string, any>} */ ({});
  const commands =
    /** @type {Array<{release: string, name: string, args: string[]}>} */ ([]);
  const phases = /** @type {string[]} */ ([]);
  const hosts = /** @type {Record<string, any>[]} */ ([]);
  let bootId = 'before-reboot';
  let refused = false;
  let bFinished = false;
  let replayed = false;
  let targetObservations = 0;
  let clock = 0;
  let currentPhase = '';
  const firstMarkers = [{ activity: 'capture', bootId, processId: 101 }];
  const markersA = [
    ...firstMarkers,
    { activity: 'verify', bootId: 'after-reboot', processId: 202 },
  ];
  const markersB = [
    ...markersA,
    { activity: 'capture', bootId: 'after-reboot', processId: 303 },
    { activity: 'verify', bootId: 'after-reboot', processId: 304 },
  ];
  const fingerprint = {
    bytes: Buffer.byteLength(LIVE_DEPLOYMENT_INPUT_BYTES),
    sha256: createHash('sha256')
      .update(LIVE_DEPLOYMENT_INPUT_BYTES)
      .digest('hex'),
    readStable: true,
  };
  const fileOutput = {
    path: inputPath,
    stable: true,
    baseline: fingerprint,
    current: fingerprint,
  };
  /** @param {'A'|'B'} release */
  const releaseState = (release) =>
    release === 'A' ? state : state.nextRelease;
  /** @param {'A'|'B'} release */
  const desired = (release) => ({
    desiredRevisionId: releaseState(release).desiredRevisionId,
    artifact: {
      artifactId: releaseState(release).guestArtifactId,
      revisionId: releaseState(release).guestRevisionId,
    },
    intent: { provider: state.provider, deploymentId: state.deploymentId },
  });
  const original = {
    deploymentInstanceId: state.deploymentInstanceId,
    incarnationId: 'incarnation',
    journalId: 'journal-1',
    generation: 1,
    phase: 'active',
    providerIntent: { provider: state.provider },
    resources: [{ role: 'server', id: '123' }],
    sshHost: { address: '203.0.113.81', hostKey: 'pinned-host' },
    release: {
      current: { desired: desired('A') },
      rollback: null,
      transition: null,
    },
  };
  let journal = /** @type {Record<string, any>} */ (structuredClone(original));
  /** @param {'A'|'B'} current @param {'A'|'B'|null} target @param {'A'|'B'|null} rollback */
  function advance(current, target, rollback) {
    journal = {
      ...journal,
      generation: journal.generation + 1,
      journalId: `journal-${journal.generation + 1}`,
      release: {
        current: { desired: desired(current) },
        transition: target ? { target: { desired: desired(target) } } : null,
        rollback: rollback ? { desired: desired(rollback) } : null,
      },
    };
  }
  /** @param {'A'|'B'} release @param {boolean} completed */
  function view(release, completed) {
    const runId = `run-${release.toLowerCase()}`;
    const revisionId = releaseState(release).guestRevisionId;
    const activities = completed ? ['capture', 'verify'] : ['capture'];
    const timerId = `${runId}-timer`;
    return {
      kind: 'wharfie.execution-ledger.run',
      integrity: { verified: true },
      run: {
        runId,
        appId: state.appId,
        revisionId,
        status: completed ? 'COMPLETED' : 'RUNNING',
        trigger: { kind: 'workflow', workflowId: 'verify-stable' },
      },
      workflowCursor: {
        runId,
        appId: state.appId,
        revisionId,
        disposition: completed ? 'COMPLETED' : 'TIMER_WAITING',
        stepId: 'stability-window',
        timerId,
      },
      timers: [
        {
          timerId,
          status: completed ? 'FIRED' : 'WAITING',
          stepId: 'stability-window',
          scheduledAt: 1000,
          dueAt:
            1000 +
            (release === 'A'
              ? LIVE_DEPLOYMENT_TIMER_DELAY_MS
              : LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS),
        },
      ],
      invocations: activities.map((activityId) => ({
        invocationId: `${runId}-${activityId}`,
        activityId,
        generation: 0,
        status: 'COMPLETED',
      })),
      attempts: activities.map((activityId) => ({
        invocationId: `${runId}-${activityId}`,
        attemptId: `${runId}-${activityId}-attempt`,
        generation: 0,
        status: 'COMPLETED',
      })),
    };
  }
  /** @param {'A'|'B'} release */
  const runOutput = (release) => ({
    kind: 'wharfie.execution-ledger.run-output',
    integrity: { verified: true },
    scope: {
      appId: state.appId,
      revisionId: releaseState(release).guestRevisionId,
      runId: `run-${release.toLowerCase()}`,
    },
    snapshot: { status: 'COMPLETED' },
    outputs: [
      { stepId: 'baseline', value: { path: inputPath, ...fingerprint } },
      { stepId: 'stability-window', value: null },
      { stepId: 'comparison', value: fileOutput },
    ],
    terminal: { type: 'completed', result: fileOutput },
  });
  const proof = {
    runId: 'run-a',
    inputPath,
    completed: runReceipt(view('A', true)),
    output: runOutput('A'),
    markers: structuredClone(markersA),
    bootId: 'after-reboot',
  };
  const host = {
    observe: async () => ({
      bootId,
      service: {
        health: 'healthy',
        activation: {
          phase: 'ACTIVE',
          lastOutcome:
            refused && !settings.genericFailure
              ? 'source-retained'
              : 'target-active',
        },
        installation: {
          activeArtifactId: journal.release.current.desired.artifact.artifactId,
        },
      },
      process: { pid: 202, startTicks: '222' },
    }),
    /** @param {string} runId */
    inspectRun: async (runId) => {
      expect(runId).toBe('run-a');
      const result = view('A', false);
      if (refused && settings.changedWaitingTimer) result.timers[0].dueAt++;
      if (refused && settings.repeatedWaitingActivity)
        result.attempts[0].generation++;
      return result;
    },
    /** @param {string} selected */
    readMarkers: async (selected) => {
      expect(selected).toBe(inputPath);
      if (currentPhase === 'update-unfinished-work') {
        return structuredClone(
          refused && settings.repeatedWaitingMarker
            ? [...firstMarkers, ...firstMarkers]
            : firstMarkers,
        );
      }
      const markers = structuredClone(bFinished ? markersB : markersA);
      if (bFinished && settings.changedMarkerHistory) markers[0].processId++;
      if (replayed && settings.replayedMarker) markers.push(markers[0]);
      return markers;
    },
  };
  /** @param {'A'|'B'} release @param {string} kind @param {string|undefined} [action] */
  const activeReceipt = (release, kind, action) => ({
    schemaVersion: 1,
    kind,
    status: 'active',
    appId: state.appId,
    provider: state.provider,
    deploymentInstanceId: state.deploymentInstanceId,
    artifactId: releaseState(release).guestArtifactId,
    revisionId: releaseState(release).guestRevisionId,
    desiredRevisionId: releaseState(release).desiredRevisionId,
    deploymentId: state.deploymentId,
    publicIpv4: original.sshHost.address,
    ...(action ? { action } : {}),
  });
  const options = {
    state,
    journal: original,
    dataRoot: '/private/acceptance/controller',
    workspace: '/private/acceptance',
    env: {},
    /** @param {string} name @param {() => Promise<any>} action */
    phase: async (name, action) => {
      currentPhase = name;
      phases.push(name);
      return await action();
    },
    /** @param {string} name @param {unknown} value */
    receipt: (name, value) => {
      records[name] = structuredClone(value);
    },
    readJournal: async () => structuredClone(journal),
    /** @param {Record<string, any>} value @param {Record<string, any>} selected */
    validateStatus: (value, selected) => {
      expect(value).toEqual({
        status: 'healthy',
        artifactId: selected.guestArtifactId,
      });
      return value;
    },
    /** @param {string} executable @param {Record<string, any>} record */
    verifyExecutable: async (executable, record) => {
      expect(executable).toBe('/private/acceptance/app');
      expect(record).toEqual(state.artifactRecord);
    },
    /** @param {'A'|'B'} release @param {string} name @param {string[]} args */
    command: async (release, name, args) => {
      commands.push({ release, name, args });
      /** @type {Record<string, any>} */
      let result;
      if (name === 'update-unfinished-work') {
        if (settings.refusalSucceeded)
          return {
            stdout: JSON.stringify(
              activeReceipt('B', 'wharfie.deployment.update'),
            ),
          };
        advance('A', 'B', null);
        refused = true;
        throw Object.assign(new Error('update refused'), {
          diagnostic: {
            status: 1,
            signal: null,
            ...(settings.failedCommand ?? {}),
          },
        });
      }
      if (name === 'update-refusal-recover') {
        advance('A', null, null);
        refused = false;
        result = activeReceipt('A', 'wharfie.deployment.recover', 'restore');
      } else if (name === 'upgrade-a-to-b') {
        advance('B', null, 'A');
        if (settings.changedSubstrate)
          journal.resources[0].id = 'unrelated-server';
        result = activeReceipt('B', 'wharfie.deployment.update');
      } else if (name.endsWith('-status')) {
        result = {
          status: 'healthy',
          artifactId: releaseState(release).guestArtifactId,
        };
      } else if (name.endsWith('-cli')) {
        result = {
          ...fileOutput,
          ...(release === 'B' && !settings.wrongBBehavior
            ? { acceptanceRevision: 'B' }
            : {}),
        };
      } else if (name === 'release-b-start') {
        result = {
          kind: 'wharfie.execution-ledger.workflow-start',
          appId: state.appId,
          revisionId: state.nextRelease.guestRevisionId,
          workflowId: 'verify-stable',
          reused: false,
          runId: 'run-b',
        };
      } else if (name === 'release-b-inspect') {
        bFinished = !settings.bNeverCompletes;
        result = view('B', bFinished);
        if (settings.wrongBTimer) result.timers[0].dueAt++;
        if (settings.contradictoryBCursor)
          result.workflowCursor.disposition = 'TIMER_WAITING';
      } else if (name.endsWith('-inspect')) {
        const selected = name === 'release-a-retained-b-inspect' ? 'B' : 'A';
        result = view(selected, true);
        if (
          (settings.changedAHistory && selected === 'A') ||
          (settings.changedBHistory && selected === 'B')
        )
          result.attempts[0].generation++;
      } else if (name.endsWith('-output')) {
        result = structuredClone(
          runOutput(
            name === 'release-b-output' ||
              name === 'release-a-retained-b-output'
              ? 'B'
              : 'A',
          ),
        );
        if (settings.changedAOutput && name === 'release-b-retained-a-output')
          result.terminal.result.stable = false;
        if (name === 'release-b-output') {
          if (settings.missingBStepOutput) result.outputs.splice(1, 1);
          if (settings.contradictoryBStepOutput)
            result.outputs.at(-1).value = { ...fileOutput, stable: false };
        }
      } else if (name === 'restore-a-recovery') {
        advance('A', null, 'B');
        result = activeReceipt('A', 'wharfie.deployment.recover', 'update');
      } else if (name === 'restore-a-replay') {
        replayed = true;
        if (settings.toggleReplay) advance('B', null, 'A');
        result = activeReceipt('A', 'wharfie.deployment.recover', 'repair');
      } else throw new Error(`Unexpected command ${name}`);
      return { stdout: JSON.stringify(result) };
    },
  };
  const dependencies = {
    now: () => clock,
    wait: async () => {
      clock += 2000;
    },
    /** @param {Record<string, any>} request */
    createHost: async (request) => {
      hosts.push(request);
      if (request.release === 'target') {
        expect(request.state.guestArtifactId).toBe(state.guestArtifactId);
        expect(request.journal.release.current.desired).toEqual(desired('B'));
        expect(request.journal.release.transition.target.desired).toEqual(
          desired('A'),
        );
        return {
          ...host,
          observe: async () => {
            targetObservations++;
            if (settings.targetProbeFailure)
              throw Object.assign(
                new Error('private target observation details'),
                {
                  diagnostic: settings.targetProbeFailure,
                },
              );
            if (settings.targetProbeTransient && targetObservations === 1) {
              throw new Error(
                'Target activation has not published status yet.',
              );
            }
            const value = await host.observe();
            value.service.installation.activeArtifactId = state.guestArtifactId;
            if (settings.targetNeverHealthy) value.service.health = 'unhealthy';
            return value;
          },
        };
      }
      return host;
    },
    /** @param {Record<string, any>} request */
    interrupt: async (request) => {
      expect(request.journal.release.current.desired).toEqual(desired('B'));
      expect(request.targetDesired).toEqual(desired('A'));
      advance('B', 'A', 'A');
      if (settings.wrongTarget)
        journal.release.transition.target.desired = desired('B');
      const observationSignal = new AbortController().signal;
      await request.observeTarget({ signal: observationSignal });
      expect(hosts.at(-1)?.signal).toBe(observationSignal);
      const interrupted = {
        schemaVersion: 1,
        kind: 'wharfie.live-deployment.update-interruption',
        deploymentInstanceId: state.deploymentInstanceId,
        incarnationId: original.incarnationId,
        priorDesiredRevisionId: state.nextRelease.desiredRevisionId,
        targetDesiredRevisionId: state.desiredRevisionId,
        targetArtifactId: state.guestArtifactId,
        targetRevisionId: state.guestRevisionId,
        pendingJournalId: journal.journalId,
        pendingJournalGeneration: journal.generation,
        boundary: 'guest-active-controller-unsettled',
        controllerPid: 400,
        statusChildPid: 401,
        controllerPaused: true,
        guestHealthy: true,
        guestPid: 402,
        controllerExitConfirmed: true,
        processGroupExitConfirmed: true,
        status: null,
        signal: 'SIGKILL',
        durationMs: 5,
        ...(settings.fakeInterruption
          ? { status: 0, signal: null, controllerExitConfirmed: false }
          : {}),
        ...(settings.interruptionChanges ?? {}),
      };
      await request.publish(interrupted);
      return interrupted;
    },
  };
  const acceptance = createLiveDeploymentUpdateAcceptance(
    options,
    dependencies,
  );
  const waiting = {
    host,
    inputPath,
    runId: 'run-a',
    waiting: view('A', false),
    firstMarkers: structuredClone(firstMarkers),
  };
  return {
    options,
    dependencies,
    acceptance,
    waiting,
    proof,
    records,
    commands,
    phases,
    hosts,
    journal: () => structuredClone(journal),
    targetObservations: () => targetObservations,
    run: async () => {
      await acceptance.whileWaiting(waiting);
      bootId = 'after-reboot';
      await acceptance.afterDurability(proof);
    },
  };
}

describe('live release acceptance without provider calls', () => {
  test('refuses unfinished A safely, upgrades to B, interrupts restore, recovers A and preserves both histories', async () => {
    const setup = fixture();
    await setup.run();
    expect(setup.phases).toEqual([
      'update-unfinished-work',
      'upgrade-a-to-b',
      'release-b-workflow',
      'restore-update-interrupted',
      'restore-a-recovery',
    ]);
    expect(
      setup.commands
        .filter((command) =>
          [
            'update-unfinished-work',
            'update-refusal-recover',
            'upgrade-a-to-b',
            'restore-a-recovery',
            'restore-a-replay',
          ].includes(command.name),
        )
        .map(({ release, name }) => ({ release, name })),
    ).toEqual([
      { release: 'B', name: 'update-unfinished-work' },
      { release: 'A', name: 'update-refusal-recover' },
      { release: 'B', name: 'upgrade-a-to-b' },
      { release: 'A', name: 'restore-a-recovery' },
      { release: 'A', name: 'restore-a-replay' },
    ]);
    expect(setup.records['update-unfinished-refused.json'].sourceRetained).toBe(
      true,
    );
    expect(setup.records['release-b-retained-a.json'].runId).toBe('run-a');
    expect(
      setup.records['release-a-retained-original.json'].markers.map(
        (/** @type {Record<string, any>} */ entry) => entry.activity,
      ),
    ).toEqual(['capture', 'verify', 'capture', 'verify']);
    expect(setup.records['release-a-retained-b.json'].runId).toBe('run-b');
    expect(setup.journal().release.current.desired.artifact.revisionId).toBe(
      'revision-a',
    );
    expect(setup.journal().release.rollback.desired.artifact.revisionId).toBe(
      'revision-b',
    );
  });

  test.each([
    'genericFailure',
    'refusalSucceeded',
    'changedWaitingTimer',
    'repeatedWaitingActivity',
    'repeatedWaitingMarker',
  ])('does not count %s as a safe unfinished-work refusal', async (setting) => {
    const setup = fixture({ [setting]: true });
    await expect(setup.run()).rejects.toThrow();
    expect(setup.commands.some(({ name }) => name === 'upgrade-a-to-b')).toBe(
      false,
    );
  });

  test.each([
    { timedOut: true },
    { aborted: true },
    { signal: 'SIGKILL' },
    { outputLimitExceeded: true },
    { status: 2 },
  ])(
    'requires a normal exit-one refusal with diagnostic %j',
    async (failedCommand) => {
      await expect(fixture({ failedCommand }).run()).rejects.toThrow();
    },
  );

  test.each([
    'wrongBBehavior',
    'changedAHistory',
    'changedAOutput',
    'changedSubstrate',
    'wrongBTimer',
    'wrongTarget',
    'fakeInterruption',
    'changedBHistory',
    'toggleReplay',
    'changedMarkerHistory',
    'replayedMarker',
  ])('fails acceptance for %s', async (setting) => {
    await expect(fixture({ [setting]: true }).run()).rejects.toThrow();
  });

  test.each([
    'contradictoryBCursor',
    'missingBStepOutput',
    'contradictoryBStepOutput',
  ])(
    'requires internally consistent completed B history: %s',
    async (setting) => {
      const setup = fixture({ [setting]: true });
      await expect(setup.run()).rejects.toThrow();
      expect(setup.phases).not.toContain('restore-update-interrupted');
    },
  );

  test.each([
    { schemaVersion: 2 },
    { kind: 'another.interruption-kind' },
    { deploymentInstanceId: 'another-deployment' },
    { incarnationId: 'another-incarnation' },
    { pendingJournalId: 'another-journal' },
    { pendingJournalGeneration: 4 },
  ])(
    'binds interruption evidence to its exact scope and reread journal: %j',
    async (interruptionChanges) => {
      const setup = fixture({ interruptionChanges });
      await expect(setup.run()).rejects.toThrow();
      expect(setup.phases).not.toContain('restore-a-recovery');
    },
  );

  test('polls a transient target status with the interruption observer signal', async () => {
    const setup = fixture({ targetProbeTransient: true });
    await setup.run();
    expect(setup.targetObservations()).toBe(2);
    expect(
      setup.records['restore-update-interrupted.json'].controllerExitConfirmed,
    ).toBe(true);
    expect(setup.records['restore-target-observation.json']).toMatchObject({
      attempts: 2,
      outcome: 'healthy',
      serviceObserved: true,
      activeArtifactMatchesTarget: true,
      hostFaultStage: null,
      hostFaultCode: null,
    });
  });

  test('bounds B completion instead of beginning restore with unfinished B work', async () => {
    const setup = fixture({ bNeverCompletes: true });
    await expect(setup.run()).rejects.toThrow(
      'B workflow did not complete before its deadline',
    );
    expect(
      setup.commands.filter(({ name }) => name === 'release-b-inspect'),
    ).toHaveLength(60);
    expect(setup.phases).not.toContain('restore-update-interrupted');
  });

  test('bounds target health observation before counting the interrupted update as proven', async () => {
    const setup = fixture({ targetNeverHealthy: true });
    await expect(setup.run()).rejects.toThrow(
      'Interrupted update target did not become healthy',
    );
    expect(setup.targetObservations()).toBe(90);
    expect(setup.phases).not.toContain('restore-a-recovery');
    expect(setup.records['restore-target-observation.json']).toMatchObject({
      attempts: 90,
      outcome: 'deadline',
      serviceObserved: true,
      hostFaultStage: null,
    });
  });

  test.each([
    { hostFaultStage: 'observe-service-identity', hostFaultCode: 'assertion' },
    {
      hostFaultStage: 'private target observation details',
      hostFaultCode: 'secret',
    },
  ])(
    'retains only fixed target observation diagnostics on deadline: %j',
    async (targetProbeFailure) => {
      const setup = fixture({ targetProbeFailure });
      await expect(setup.run()).rejects.toThrow(
        'Interrupted update target did not become healthy',
      );
      const report = setup.records['restore-target-observation.json'];
      expect(report).toMatchObject({
        attempts: 90,
        outcome: 'deadline',
        serviceObserved: false,
        activeArtifactMatchesTarget: null,
        hostFaultStage:
          targetProbeFailure.hostFaultCode === 'assertion'
            ? 'observe-service-identity'
            : null,
        hostFaultCode:
          targetProbeFailure.hostFaultCode === 'assertion' ? 'assertion' : null,
      });
      expect(JSON.stringify(report)).not.toMatch(
        /private target observation details|secret/,
      );
    },
  );

  test('release receipts retain fixed release evidence without copying unrelated journal fields', () => {
    const setup = fixture();
    const journal = { ...setup.journal(), unrelatedSecret: 'must-not-appear' };
    const receipt = liveDeploymentReleaseReceipt(journal);
    expect(receipt).toEqual({
      deploymentInstanceId: 'deployment-instance',
      incarnationId: 'incarnation',
      journalId: 'journal-1',
      generation: 1,
      phase: 'active',
      current: {
        desiredRevisionId: 'desired-a',
        artifactId: 'artifact-a',
        revisionId: 'revision-a',
      },
      rollback: null,
      target: null,
    });
    expect(JSON.stringify(receipt)).not.toContain('must-not-appear');
  });
});
