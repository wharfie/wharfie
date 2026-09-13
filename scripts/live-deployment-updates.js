/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Bounded opt-in live release acceptance. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  assertActivities,
  assertLiveDeploymentFileOutput,
  assertRun,
  assertWaiting,
  runReceipt,
} from './live-deployment-durability.js';
import {
  createLiveDeploymentHost,
  LIVE_DEPLOYMENT_HOST_FAULT_CODES,
  LIVE_DEPLOYMENT_HOST_FAULT_STAGES,
} from './live-deployment-host.js';
import { LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS } from './live-deployment-package.js';
import { interruptLiveDeploymentUpdate } from './live-deployment-update-interruption.js';

/** @typedef {'A'|'B'} ReleaseName */
/** @typedef {Record<string, any>} Document */

/** @param {unknown} actual @param {unknown} expected */
function same(actual, expected) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual)),
    JSON.parse(JSON.stringify(expected)),
  );
}

/** B must visibly execute its own CLI while retaining the useful file result. @param {Document} value @param {string} inputPath */
export function assertLiveDeploymentNextOutput(value, inputPath) {
  assert.equal(value.acceptanceRevision, 'B');
  const { acceptanceRevision, ...result } = value;
  assertLiveDeploymentFileOutput(result, inputPath);
}

/** Fixed projection of release selection and its local commit frontier. @param {Document} journal */
export function liveDeploymentReleaseReceipt(journal) {
  /** @param {Document|null|undefined} value */
  const release = (value) =>
    value
      ? {
          desiredRevisionId: value.desired.desiredRevisionId,
          artifactId: value.desired.artifact.artifactId,
          revisionId: value.desired.artifact.revisionId,
        }
      : null;
  return {
    deploymentInstanceId: journal.deploymentInstanceId,
    incarnationId: journal.incarnationId,
    journalId: journal.journalId,
    generation: journal.generation,
    phase: journal.phase,
    current: release(journal.release.current),
    rollback: release(journal.release.rollback),
    target: release(journal.release.transition?.target),
  };
}

/**
 * Compose a quiescence check into A's waiting run, then upgrade and restore
 * through fresh packaged controllers after the original durable proof finishes.
 * The caller owns the run lock, retained artifacts, and unconditional cleanup.
 * @param {Record<string, any>} options
 * @param {Record<string, any>} [dependencies]
 */
export function createLiveDeploymentUpdateAcceptance(
  options,
  dependencies = {},
) {
  const {
    state,
    journal: original,
    command,
    phase,
    receipt,
    readJournal,
  } = options;
  const ports = {
    createHost: createLiveDeploymentHost,
    interrupt: interruptLiveDeploymentUpdate,
    wait: delay,
    now: () => performance.now(),
    ...dependencies,
  };
  const releases = { A: state, B: { ...state, ...state.nextRelease } };
  const selectors = [
    '--deployment-instance',
    state.deploymentInstanceId,
    '--data-root',
    options.dataRoot,
  ];
  /** @param {ReleaseName} release */
  const selected = (release) => releases[release];
  /** @param {ReleaseName} release @param {string} name @param {string[]} args @param {number} [timeoutMs] */
  const call = async (release, name, args, timeoutMs = 180_000) =>
    JSON.parse(
      (
        await command(
          release,
          name,
          ['wharfie', 'deployment', ...args],
          timeoutMs,
        )
      ).stdout,
    );
  /** @param {ReleaseName} release @param {string} name @param {string} action @param {number} [timeoutMs] */
  const operator = (release, name, action, timeoutMs = 180_000) =>
    call(release, name, [action, ...selectors, '--json'], timeoutMs);
  /** @param {ReleaseName} release @param {string} name @param {string[]} args */
  const exec = (release, name, args) =>
    call(release, name, ['exec', ...selectors, '--', ...args]);

  /** @param {Document} desired @param {ReleaseName} release */
  const assertIdentity = (desired, release) => {
    const expected = selected(release);
    assert.equal(desired.desiredRevisionId, expected.desiredRevisionId);
    assert.equal(desired.artifact.artifactId, expected.guestArtifactId);
    assert.equal(desired.artifact.revisionId, expected.guestRevisionId);
    same(desired.intent, original.release.current.desired.intent);
  };
  /** @param {Document} value @param {ReleaseName} current @param {ReleaseName|null} [target] @param {ReleaseName|null} [rollback] */
  const assertJournal = (
    value,
    current,
    target = null,
    rollback = undefined,
  ) => {
    assert.ok(value);
    assert.equal(value.phase, 'active');
    for (const key of ['deploymentInstanceId', 'incarnationId'])
      assert.equal(value[key], original[key]);
    for (const key of ['providerIntent', 'resources', 'sshHost'])
      same(value[key], original[key]);
    assertIdentity(value.release.current.desired, current);
    if (target === null) assert.equal(value.release.transition, null);
    else {
      assert.ok(value.release.transition);
      assertIdentity(value.release.transition.target.desired, target);
    }
    if (rollback === null) assert.equal(value.release.rollback, null);
    else if (rollback !== undefined)
      assertIdentity(value.release.rollback.desired, rollback);
    return value;
  };
  /** @param {Document} journal @param {ReleaseName} release @param {boolean} [target] @param {AbortSignal} [signal] */
  const hostFor = async (
    journal,
    release,
    target = false,
    signal = options.signal,
  ) =>
    await ports.createHost({
      state: selected(release),
      journal,
      dataRoot: options.dataRoot,
      env: options.env,
      signal,
      ...(target ? { release: 'target' } : {}),
    });
  /** @param {Document} value @param {ReleaseName} release @param {string} kind @param {string} [action] */
  const assertActiveReceipt = (value, release, kind, action = undefined) => {
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.kind, kind);
    assert.equal(value.status, 'active');
    assert.equal(value.appId, state.appId);
    assert.equal(value.provider, state.provider);
    assert.equal(value.deploymentInstanceId, state.deploymentInstanceId);
    assert.equal(value.artifactId, selected(release).guestArtifactId);
    assert.equal(value.publicIpv4, original.sshHost.address);
    if (action !== undefined) assert.equal(value.action, action);
    else {
      assert.equal(value.revisionId, selected(release).guestRevisionId);
      assert.equal(
        value.desiredRevisionId,
        selected(release).desiredRevisionId,
      );
      assert.equal(value.deploymentId, state.deploymentId);
    }
  };
  /** @param {ReleaseName} release @param {string} name */
  const healthy = async (release, name) => {
    const value = options.validateStatus(
      await operator(release, name, 'status'),
      selected(release),
    );
    receipt(`${name}.json`, value);
    return value;
  };
  /** @param {ReleaseName} release @param {string} name @param {Document} proof @param {Document} host @param {Document[]} expectedMarkers */
  const retained = async (release, name, proof, host, expectedMarkers) => {
    const view = await exec(release, `${name}-inspect`, [
      'wharfie',
      'inspect',
      '--run-id',
      proof.runId,
      '--json',
    ]);
    assertRun(view, state, proof.runId);
    same(runReceipt(view), proof.completed);
    const output = await exec(release, `${name}-output`, [
      'wharfie',
      'output',
      '--run-id',
      proof.runId,
      '--confirm-sensitive-output',
      '--json',
    ]);
    same(output, proof.output);
    const markers = await host.readMarkers(proof.inputPath);
    same(markers, expectedMarkers);
    receipt(`${name}.json`, {
      ...runReceipt(view),
      outputVerified: true,
      markers,
    });
  };
  /** @param {ReleaseName} release @param {string} name @param {string} inputPath */
  const ordinary = async (release, name, inputPath) => {
    const value = await exec(release, name, [inputPath]);
    if (release === 'A') assertLiveDeploymentFileOutput(value, inputPath);
    else assertLiveDeploymentNextOutput(value, inputPath);
    receipt(`${name}.json`, {
      release,
      artifactId: selected(release).guestArtifactId,
      behaviorVerified: true,
    });
  };

  return Object.freeze({
    /** @param {Document} context */
    async whileWaiting({ host, inputPath, runId, waiting, firstMarkers }) {
      await phase('update-unfinished-work', async () => {
        const before = await host.observe();
        assert.equal(before.service.health, 'healthy');
        assert.equal(before.service.activation.phase, 'ACTIVE');
        assert.equal(before.service.activation.lastOutcome, 'target-active');
        assertWaiting(await host.inspectRun(runId), waiting);
        receipt('update-unfinished-intent.json', {
          runId,
          sourceArtifactId: state.guestArtifactId,
          targetArtifactId: state.nextRelease.guestArtifactId,
        });
        let failure;
        try {
          await operator('B', 'update-unfinished-work', 'update', 600_000);
        } catch (error) {
          failure = /** @type {any} */ (error)?.diagnostic;
        }
        assert.ok(
          failure,
          'Update unexpectedly succeeded while A had unfinished work.',
        );
        assert.equal(failure.status, 1);
        assert.ok(
          !failure.signal &&
            !failure.timedOut &&
            !failure.aborted &&
            !failure.outputLimitExceeded,
        );
        const pending = assertJournal(await readJournal(), 'A', 'B');
        const refused = await host.observe();
        assert.equal(refused.bootId, before.bootId);
        assert.equal(refused.service.health, 'healthy');
        assert.equal(refused.service.activation.phase, 'ACTIVE');
        assert.equal(
          refused.service.installation.activeArtifactId,
          state.guestArtifactId,
        );
        assert.equal(refused.service.activation.lastOutcome, 'source-retained');
        const retainedRun = await host.inspectRun(runId);
        assertRun(retainedRun, state, runId);
        assertWaiting(retainedRun, waiting);
        same(await host.readMarkers(inputPath), firstMarkers);
        receipt('update-unfinished-refused.json', {
          commandExitStatus: failure.status,
          sourceRetained: true,
          journal: liveDeploymentReleaseReceipt(pending),
          run: runReceipt(retainedRun),
        });
        const restored = await operator(
          'A',
          'update-refusal-recover',
          'recover',
          600_000,
        );
        assertActiveReceipt(
          restored,
          'A',
          'wharfie.deployment.recover',
          'restore',
        );
        receipt('update-refusal-recover.json', restored);
        const settled = assertJournal(await readJournal(), 'A', null);
        const current = await host.observe();
        assert.equal(current.bootId, before.bootId);
        assert.equal(current.service.health, 'healthy');
        const stillWaiting = await host.inspectRun(runId);
        assertRun(stillWaiting, state, runId);
        assertWaiting(stillWaiting, waiting);
        same(await host.readMarkers(inputPath), firstMarkers);
        receipt('update-unfinished-preserved.json', {
          journal: liveDeploymentReleaseReceipt(settled),
          run: runReceipt(stillWaiting),
        });
      });
    },
    /** @param {Document} proof */
    async afterDurability(proof) {
      assert.ok(proof && proof.completed.status === 'COMPLETED');
      assertJournal(await readJournal(), 'A');
      let hostB = /** @type {Document} */ ({});
      let settledB = /** @type {Document} */ ({});
      await phase('upgrade-a-to-b', async () => {
        const updated = await operator(
          'B',
          'upgrade-a-to-b',
          'update',
          600_000,
        );
        assertActiveReceipt(updated, 'B', 'wharfie.deployment.update');
        receipt('upgrade-a-to-b.json', updated);
        settledB = assertJournal(await readJournal(), 'B', null, 'A');
        receipt(
          'release-b-journal.json',
          liveDeploymentReleaseReceipt(settledB),
        );
        await healthy('B', 'release-b-status');
        hostB = await hostFor(settledB, 'B');
        const observed = await hostB.observe();
        assert.equal(observed.bootId, proof.bootId);
        assert.equal(observed.service.health, 'healthy');
        await ordinary('B', 'release-b-cli', proof.inputPath);
        await retained(
          'B',
          'release-b-retained-a',
          proof,
          hostB,
          proof.markers,
        );
      });

      let expectedMarkers = /** @type {Document[]} */ ([]);
      let bProof = /** @type {Document} */ ({});
      await phase('release-b-workflow', async () => {
        const started = await exec('B', 'release-b-start', [
          'wharfie',
          'start',
          '--json',
          '--',
          proof.inputPath,
        ]);
        assert.equal(started.kind, 'wharfie.execution-ledger.workflow-start');
        assert.equal(started.appId, state.appId);
        assert.equal(started.revisionId, state.nextRelease.guestRevisionId);
        assert.equal(started.workflowId, 'verify-stable');
        assert.equal(started.reused, false);
        assert.notEqual(started.runId, proof.runId);
        const deadline = ports.now() + 120_000;
        let completed;
        do {
          options.signal?.throwIfAborted();
          const view = await exec('B', 'release-b-inspect', [
            'wharfie',
            'inspect',
            '--run-id',
            started.runId,
            '--json',
          ]);
          assertRun(view, selected('B'), started.runId);
          if (view.run.status === 'COMPLETED') {
            completed = view;
            break;
          }
          assert.equal(view.run.status, 'RUNNING');
          await ports.wait(2_000, undefined, { signal: options.signal });
        } while (ports.now() < deadline);
        assert.ok(
          completed,
          'B workflow did not complete before its deadline.',
        );
        assert.equal(completed.workflowCursor.disposition, 'COMPLETED');
        assertActivities(completed, ['capture', 'verify']);
        assert.equal(completed.timers.length, 1);
        assert.equal(completed.timers[0].status, 'FIRED');
        assert.equal(
          completed.timers[0].dueAt - completed.timers[0].scheduledAt,
          LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS,
        );
        const output = await exec('B', 'release-b-output', [
          'wharfie',
          'output',
          '--run-id',
          started.runId,
          '--confirm-sensitive-output',
          '--json',
        ]);
        assert.equal(output.kind, 'wharfie.execution-ledger.run-output');
        same(output.integrity, { verified: true });
        same(output.scope, {
          appId: state.appId,
          revisionId: state.nextRelease.guestRevisionId,
          runId: started.runId,
        });
        assert.equal(output.snapshot.status, 'COMPLETED');
        assert.equal(output.terminal.type, 'completed');
        assertLiveDeploymentFileOutput(output.terminal.result, proof.inputPath);
        same(
          output.outputs.map((/** @type {Document} */ entry) => entry.stepId),
          ['baseline', 'stability-window', 'comparison'],
        );
        assertLiveDeploymentFileOutput(
          output.outputs.at(-1).value,
          proof.inputPath,
        );
        expectedMarkers = await hostB.readMarkers(proof.inputPath);
        same(expectedMarkers.slice(0, 2), proof.markers);
        same(
          expectedMarkers.map((entry) => entry.activity),
          ['capture', 'verify', 'capture', 'verify'],
        );
        for (const marker of expectedMarkers.slice(2))
          assert.equal(marker.bootId, proof.bootId);
        bProof = {
          runId: started.runId,
          completed: runReceipt(completed),
          output,
        };
        receipt('release-b-workflow.json', {
          ...runReceipt(completed),
          outputVerified: true,
          markers: expectedMarkers,
        });
      });

      await phase('restore-update-interrupted', async () => {
        const prior = assertJournal(await readJournal(), 'B', null, 'A');
        same(prior, settledB);
        const executable = path.join(options.workspace, 'app');
        await options.verifyExecutable(executable, state.artifactRecord);
        receipt('restore-update-intent.json', {
          current: liveDeploymentReleaseReceipt(prior),
          targetArtifactId: state.guestArtifactId,
        });
        const interrupted = await ports.interrupt({
          executable,
          cwd: options.workspace,
          env: options.env,
          dataRoot: options.dataRoot,
          journal: prior,
          targetDesired: original.release.current.desired,
          readJournal,
          signal: options.signal,
          observeTarget: async (
            /** @type {{signal: AbortSignal}} */ { signal },
          ) => {
            const deadline = ports.now() + 180_000;
            const observationReceipt = {
              schemaVersion: 1,
              kind: 'wharfie.live-deployment.target-observation',
              deploymentInstanceId: state.deploymentInstanceId,
              targetArtifactId: state.guestArtifactId,
              attempts: 0,
              outcome: 'retrying',
              serviceObserved: false,
              activeArtifactMatchesTarget: /** @type {boolean|null} */ (null),
              hostFaultStage: /** @type {string|null} */ (null),
              hostFaultCode: /** @type {string|null} */ (null),
            };
            const saveObservation = () =>
              receipt('restore-target-observation.json', {
                ...observationReceipt,
              });
            do {
              signal.throwIfAborted();
              const journal = assertJournal(await readJournal(), 'B', 'A', 'A');
              observationReceipt.attempts++;
              observationReceipt.serviceObserved = false;
              observationReceipt.activeArtifactMatchesTarget = null;
              observationReceipt.hostFaultStage = null;
              observationReceipt.hostFaultCode = null;
              try {
                const host = await hostFor(journal, 'A', true, signal);
                const observation = await host.observe();
                observationReceipt.serviceObserved = true;
                observationReceipt.activeArtifactMatchesTarget =
                  observation.service.installation.activeArtifactId ===
                  state.guestArtifactId;
                if (observation.service.health === 'healthy') {
                  assert.equal(observation.bootId, proof.bootId);
                  observationReceipt.outcome = 'healthy';
                  return observation;
                }
              } catch (error) {
                const diagnostic = /** @type {any} */ (error)?.diagnostic;
                if (
                  LIVE_DEPLOYMENT_HOST_FAULT_STAGES.includes(
                    diagnostic?.hostFaultStage,
                  )
                )
                  observationReceipt.hostFaultStage = diagnostic.hostFaultStage;
                if (
                  LIVE_DEPLOYMENT_HOST_FAULT_CODES.includes(
                    diagnostic?.hostFaultCode,
                  )
                )
                  observationReceipt.hostFaultCode = diagnostic.hostFaultCode;
                signal.throwIfAborted();
              } finally {
                saveObservation();
              }
              await ports.wait(1_000, undefined, { signal });
            } while (ports.now() < deadline);
            observationReceipt.outcome = 'deadline';
            saveObservation();
            throw new Error(
              'Interrupted update target did not become healthy.',
            );
          },
          publish: (/** @type {Document} */ value) =>
            receipt('restore-update-interruption.json', value),
        });
        assert.equal(interrupted.boundary, 'guest-active-controller-unsettled');
        for (const key of /** @type {const} */ ([
          'controllerPaused',
          'controllerExitConfirmed',
          'processGroupExitConfirmed',
          'guestHealthy',
        ]))
          assert.equal(interrupted[key], true);
        assert.equal(interrupted.signal, 'SIGKILL');
        assert.equal(
          interrupted.priorDesiredRevisionId,
          state.nextRelease.desiredRevisionId,
        );
        assert.equal(
          interrupted.targetDesiredRevisionId,
          state.desiredRevisionId,
        );
        assert.equal(interrupted.targetArtifactId, state.guestArtifactId);
        assert.equal(interrupted.targetRevisionId, state.guestRevisionId);
        receipt('restore-update-interrupted.json', interrupted);
        const unsettled = assertJournal(await readJournal(), 'B', 'A', 'A');
        assert.equal(interrupted.schemaVersion, 1);
        assert.equal(
          interrupted.kind,
          'wharfie.live-deployment.update-interruption',
        );
        assert.equal(
          interrupted.deploymentInstanceId,
          state.deploymentInstanceId,
        );
        assert.equal(interrupted.incarnationId, unsettled.incarnationId);
        assert.equal(interrupted.pendingJournalId, unsettled.journalId);
        assert.equal(
          interrupted.pendingJournalGeneration,
          unsettled.generation,
        );
        receipt(
          'restore-update-unsettled.json',
          liveDeploymentReleaseReceipt(unsettled),
        );
      });

      await phase('restore-a-recovery', async () => {
        const restored = await operator(
          'A',
          'restore-a-recovery',
          'recover',
          600_000,
        );
        assertActiveReceipt(
          restored,
          'A',
          'wharfie.deployment.recover',
          'update',
        );
        receipt('restore-a-recovery.json', restored);
        const journal = assertJournal(await readJournal(), 'A', null, 'B');
        receipt(
          'release-a-restored-journal.json',
          liveDeploymentReleaseReceipt(journal),
        );
        await healthy('A', 'release-a-restored-status');
        const host = await hostFor(journal, 'A');
        const observed = await host.observe();
        assert.equal(observed.bootId, proof.bootId);
        assert.equal(observed.service.health, 'healthy');
        await ordinary('A', 'release-a-restored-cli', proof.inputPath);
        await retained(
          'A',
          'release-a-retained-original',
          proof,
          host,
          expectedMarkers,
        );
        const bView = await exec('A', 'release-a-retained-b-inspect', [
          'wharfie',
          'inspect',
          '--run-id',
          bProof.runId,
          '--json',
        ]);
        assertRun(bView, selected('B'), bProof.runId);
        same(runReceipt(bView), bProof.completed);
        const bOutput = await exec('A', 'release-a-retained-b-output', [
          'wharfie',
          'output',
          '--run-id',
          bProof.runId,
          '--confirm-sensitive-output',
          '--json',
        ]);
        same(bOutput, bProof.output);
        receipt('release-a-retained-b.json', {
          ...runReceipt(bView),
          outputVerified: true,
        });
        // A fresh controller replay must repair the settled A, not toggle back to B.
        const replay = await operator(
          'A',
          'restore-a-replay',
          'recover',
          600_000,
        );
        assertActiveReceipt(
          replay,
          'A',
          'wharfie.deployment.recover',
          'repair',
        );
        same(assertJournal(await readJournal(), 'A', null, 'B'), journal);
        same(await host.readMarkers(proof.inputPath), expectedMarkers);
        receipt('restore-a-replay.json', replay);
      });
    },
  });
}
