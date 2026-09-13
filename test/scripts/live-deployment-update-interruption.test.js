import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { interruptLiveDeploymentUpdate } from '../../scripts/live-deployment-update-interruption.js';
import { runLiveDeploymentProcess } from '../../scripts/live-deployment-package.js';
import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import { createDeploymentOpenSshTransport } from '../../src/core/runtime/deployment-openssh-transport.js';
import { createSingleNodeDeploymentDesired } from '../../src/core/runtime/single-node-deployment-desired.js';
import { prepareSingleNodeDeploymentReleaseUpdate } from '../../src/core/runtime/single-node-deployment-journal.js';
import { getSingleNodeRemoteArtifactPaths } from '../../src/core/runtime/single-node-remote-activation.js';
import {
  createHealthySingleNodeServiceStatus,
  createProcessOutcome,
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
} from '../runtime/fixtures/single-node-status-fixture.js';

/** @type {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} */
let fixture;
/** @type {Record<string, any>} */
let prior;
/** @type {Record<string, any>} */
let pending;
/** @type {ReturnType<typeof createSingleNodeDeploymentDesired>} */
let desired;
let expectedCommand = '';
/** @type {string[]} */
let expectedSshArgs = [];

beforeAll(async () => {
  fixture = await createSingleNodeStatusAuthorityFixture();
  prior = createSingleNodeStatusActiveJournal(fixture);
  const revision = createApplicationRevision({
    contract: fixture.revision.contract,
    inputs: {
      ...fixture.revision.inputs,
      source: {
        format: 'wharfie-source-tree-v1',
        digest: { algorithm: 'sha256', value: sha256Base64Url('revision B') },
      },
    },
  });
  const artifactRecord = createArtifactRecord({
    bytes: Buffer.from('revision B Linux SEA'),
    revision,
    target: fixture.artifactRecord.target,
    provenance: fixture.artifactRecord.provenance,
  });
  desired = createSingleNodeDeploymentDesired({
    intent: fixture.desired.intent,
    revision,
    artifactRecord,
    observation: {
      artifactId: artifactRecord.artifactId,
      byteDigest: artifactRecord.byteDigest,
      size: artifactRecord.size,
    },
  });
  pending = prepareSingleNodeDeploymentReleaseUpdate(prior, desired);
  await createDeploymentOpenSshTransport({
    address: prior.sshHost.address,
    privateKeyPath: fixture.sshIdentity.privateKeyPath,
    knownHostsPath: fixture.sshIdentity.knownHostsPath,
    runProcess: {
      async run(request) {
        const input = /** @type {Record<string, any>} */ (request);
        expectedCommand = [input.file, ...input.args].join(' ');
        expectedSshArgs = input.args;
        return createProcessOutcome();
      },
    },
  }).runRemoteArgv({
    argv: [
      getSingleNodeRemoteArtifactPaths(desired, prior.incarnationId)
        .remoteArtifactPath,
      'wharfie',
      'service',
      'converge',
      '--json',
    ],
    stdin: null,
    timeoutMilliseconds: 600_000,
    maximumStdoutBytes: 256 * 1024,
    maximumStderrBytes: 16 * 1024,
  });
});

function setup() {
  const controllerPid = 7301;
  const sshPid = 7302;
  const child = Object.assign(new EventEmitter(), {
    pid: controllerPid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const state = {
    paused: false,
    closed: false,
    journal: prior,
    candidateGroup: controllerPid,
    candidateParent: controllerPid,
    command: expectedCommand,
  };
  const signalProcess = jest.fn((pid, signal) => {
    if (pid === controllerPid && signal === 'SIGSTOP') state.paused = true;
    else if (pid === -controllerPid && signal === 'SIGKILL' && !state.closed) {
      state.closed = true;
      child.emit('exit', null, 'SIGKILL');
      child.emit('close', null, 'SIGKILL');
    } else throw new Error('Signal outside the owned fixture process group.');
  });
  const observation = {
    deploymentInstanceId: prior.deploymentInstanceId,
    incarnationId: prior.incarnationId,
    artifactId: desired.artifact.artifactId,
    revisionId: desired.artifact.revisionId,
    service: createHealthySingleNodeServiceStatus({ ...fixture, desired }),
    process: { pid: 2202, startTicks: '312' },
  };
  const options = {
    executable: '/private/acceptance/revision-b',
    cwd: '/private/acceptance',
    dataRoot: '/private/acceptance/data',
    env: { PATH: '/usr/bin:/bin', HCLOUD_TOKEN: 'do-not-retain-token' },
    journal: prior,
    targetDesired: desired,
    readJournal: jest.fn(async () => state.journal),
    observeTarget: jest.fn(async () => observation),
    publish: jest.fn(async (/** @type {unknown} */ _receipt) => undefined),
    timeoutMs: 3000,
  };
  const dependencies = {
    readIdentity: async () => fixture.sshIdentity,
    readHostKey: async () => prior.sshHost,
    signalProcess,
    spawn: jest.fn((/** @type {unknown[]} */ ..._args) => {
      state.journal = pending;
      return child;
    }),
    listProcesses: jest.fn(async () =>
      state.closed
        ? []
        : [
            {
              pid: controllerPid,
              parentPid: 900,
              groupId: controllerPid,
              state: state.paused ? 'T' : 'S',
            },
            {
              pid: sshPid,
              parentPid: state.candidateParent,
              groupId: state.candidateGroup,
              state: 'S',
            },
          ],
    ),
    readProcessCommand: jest.fn(
      async (/** @type {number} */ _pid) => state.command,
    ),
  };
  return {
    options,
    dependencies,
    child,
    state,
    observation,
    controllerPid,
    sshPid,
  };
}

describe('live packaged update controller interruption', () => {
  it('proves exact target active with prior authority unsettled, kills the owned group and confirms exit', async () => {
    const { options, dependencies, state, controllerPid, sshPid } = setup();
    const result = await interruptLiveDeploymentUpdate(options, dependencies);
    expect(result).toMatchObject({
      kind: 'wharfie.live-deployment.update-interruption',
      boundary: 'guest-active-controller-unsettled',
      pendingJournalId: pending.journalId,
      pendingJournalGeneration: pending.generation,
      targetArtifactId: desired.artifact.artifactId,
      controllerPaused: true,
      guestHealthy: true,
      controllerExitConfirmed: true,
      processGroupExitConfirmed: true,
      signal: 'SIGKILL',
    });
    expect(dependencies.signalProcess.mock.calls).toEqual([
      [controllerPid, 'SIGSTOP'],
      [-controllerPid, 'SIGKILL'],
    ]);
    expect(dependencies.readProcessCommand).toHaveBeenCalledWith(sshPid);
    expect(state.journal).toEqual(pending);
    expect(options.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        controllerExitConfirmed: false,
        guestHealthy: true,
        pendingJournalId: pending.journalId,
      }),
    );
    expect(dependencies.spawn).toHaveBeenCalledWith(
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
      expect.objectContaining({ detached: true, shell: false }),
    );
    expect(JSON.stringify(result)).not.toContain('do-not-retain-token');
  });

  it.each(['group', 'parent', 'command'])(
    'does not pause an unproven %s boundary',
    async (field) => {
      const { options, dependencies, state, controllerPid } = setup();
      options.timeoutMs = 70;
      if (field === 'group') state.candidateGroup = 99;
      if (field === 'parent') state.candidateParent = 99;
      if (field === 'command')
        state.command = expectedCommand.replace("'converge'", "'status'");
      await expect(
        interruptLiveDeploymentUpdate(options, dependencies),
      ).rejects.toMatchObject({
        diagnostic: {
          timedOut: true,
          controllerPaused: false,
          controllerExitConfirmed: true,
        },
      });
      expect(dependencies.signalProcess.mock.calls).toEqual([
        [-controllerPid, 'SIGKILL'],
      ]);
      expect(options.observeTarget).not.toHaveBeenCalled();
    },
  );

  it('refuses a mismatched SSH pin before spawning', async () => {
    const { options, dependencies } = setup();
    dependencies.readHostKey = async () => ({
      ...prior.sshHost,
      address: '192.0.2.99',
    });
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toThrow('update-controller-interruption');
    expect(dependencies.spawn).not.toHaveBeenCalled();
    expect(dependencies.signalProcess).not.toHaveBeenCalled();
  });

  it('refuses an already current target before spawning', async () => {
    const { options, dependencies } = setup();
    options.targetDesired = fixture.desired;
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toThrow('update-controller-interruption');
    expect(dependencies.spawn).not.toHaveBeenCalled();
  });

  it('fails the proof and reaps a controller whose journal changed at the pause boundary', async () => {
    const { options, dependencies, state } = setup();
    options.readJournal.mockImplementation(async () =>
      state.paused ? prior : state.journal,
    );
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toMatchObject({
      diagnostic: {
        controllerPaused: true,
        controllerExitConfirmed: true,
        faultStage: 'verify-paused-journal',
        faultCode: 'assertion-failed',
      },
    });
    expect(options.observeTarget).not.toHaveBeenCalled();
    expect(options.publish).not.toHaveBeenCalled();
  });

  it('rechecks journal authority after independent target health', async () => {
    const { options, dependencies, state, observation } = setup();
    options.observeTarget.mockImplementation(async () => {
      state.journal = prior;
      return observation;
    });
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toMatchObject({
      diagnostic: {
        controllerExitConfirmed: true,
        faultStage: 'verify-observed-journal',
        faultCode: 'assertion-failed',
      },
    });
    expect(options.publish).not.toHaveBeenCalled();
  });

  it('refuses changed journal authority after the killed controller has closed', async () => {
    const { options, dependencies, state } = setup();
    options.readJournal.mockImplementation(async () =>
      state.closed ? prior : state.journal,
    );
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toMatchObject({
      diagnostic: { controllerExitConfirmed: true, signal: 'SIGKILL' },
    });
  });

  it('does not report success with a surviving member of its process group', async () => {
    const { options, dependencies, state, controllerPid, sshPid } = setup();
    const original =
      dependencies.listProcesses.getMockImplementation() ?? (async () => []);
    dependencies.listProcesses.mockImplementation(async () =>
      state.closed
        ? [{ pid: sshPid, parentPid: 1, groupId: controllerPid, state: 'S' }]
        : await original(),
    );
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toMatchObject({
      diagnostic: { controllerExitConfirmed: true, signal: 'SIGKILL' },
    });
  });

  it('handles an unsuccessful spawn without an unhandled error or signaling another process', async () => {
    const { options, dependencies, child } = setup();
    dependencies.spawn.mockImplementation(() => {
      delete (/** @type {Partial<typeof child>} */ (child).pid);
      setImmediate(() => {
        child.emit('error', new Error('private failed spawn details'));
        child.emit('close', -2, null);
      });
      return child;
    });
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toMatchObject({
      diagnostic: { spawnError: true },
    });
    expect(dependencies.signalProcess).not.toHaveBeenCalled();
  });

  it('requires healthy service identity for the exact target before interruption evidence is published', async () => {
    const { options, dependencies, observation } = setup();
    observation.service = createHealthySingleNodeServiceStatus(fixture);
    await expect(
      interruptLiveDeploymentUpdate(options, dependencies),
    ).rejects.toMatchObject({
      diagnostic: { controllerPaused: true, controllerExitConfirmed: true },
    });
    expect(options.publish).not.toHaveBeenCalled();
  });

  it('bounds discarded output and never exposes its contents in failures', async () => {
    const { options, dependencies, child } = setup();
    dependencies.listProcesses.mockImplementation(async () => {
      child.stderr.write(`private-diagnostic-token${'x'.repeat(256 * 1024)}`);
      return [];
    });
    const failure = await interruptLiveDeploymentUpdate(
      options,
      dependencies,
    ).catch((error) => error);
    expect(failure).toMatchObject({
      diagnostic: { outputLimitExceeded: true, controllerExitConfirmed: true },
    });
    expect(JSON.stringify(failure)).not.toContain('private-diagnostic-token');
  });

  it('reaps its paused controller when the target observer fails', async () => {
    const { options, dependencies } = setup();
    options.observeTarget.mockRejectedValue(
      new Error('private remote details'),
    );
    const failure = await interruptLiveDeploymentUpdate(
      options,
      dependencies,
    ).catch((error) => error);
    expect(failure).toMatchObject({
      diagnostic: {
        controllerPaused: true,
        controllerExitConfirmed: true,
        faultStage: 'observe-target',
        faultCode: 'unexpected-error',
      },
    });
    expect(JSON.stringify(failure)).not.toContain('private remote details');
  });

  it('aborts a waiting target observation at the hard deadline and still reaps the paused controller', async () => {
    const { options, dependencies } = setup();
    /** @type {AbortSignal|undefined} */
    let observedSignal;
    await expect(
      interruptLiveDeploymentUpdate(
        {
          ...options,
          timeoutMs: 50,
          observeTarget: (/** @type {{signal: AbortSignal}} */ { signal }) => {
            observedSignal = signal;
            return new Promise(() => undefined);
          },
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      diagnostic: {
        timedOut: true,
        controllerPaused: true,
        controllerExitConfirmed: true,
      },
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('honors cancellation before local or remote work', async () => {
    const { options, dependencies } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      interruptLiveDeploymentUpdate(
        { ...options, signal: controller.signal },
        dependencies,
      ),
    ).rejects.toMatchObject({
      diagnostic: { aborted: true, controllerPaused: false },
    });
    expect(dependencies.spawn).not.toHaveBeenCalled();
  });

  it('stops and reaps a real owned controller and its inherited child process group', async () => {
    const { options, dependencies, state, observation } = setup();
    /** @type {import('node:child_process').ChildProcess|undefined} */
    let actual;
    const result = await interruptLiveDeploymentUpdate(
      {
        ...options,
        cwd: process.cwd(),
        timeoutMs: 10_000,
        observeTarget: async () => {
          const status = await runLiveDeploymentProcess({
            file: '/bin/ps',
            args: ['-p', String(actual?.pid), '-o', 'stat='],
            cwd: '/',
            env: { PATH: '/usr/bin:/bin' },
            timeoutMs: 3000,
          });
          expect(status.stdout.trim()).toContain('T');
          return observation;
        },
      },
      {
        readIdentity: dependencies.readIdentity,
        readHostKey: dependencies.readHostKey,
        readProcessCommand: async () => expectedCommand,
        spawn: (
          /** @type {string} */ _file,
          /** @type {string[]} */ _args,
          /** @type {import('node:child_process').SpawnOptions} */ spawnOptions,
        ) => {
          state.journal = pending;
          actual = spawn(
            process.execPath,
            [
              '-e',
              `
          require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'});
          setInterval(() => {}, 1000);
        `,
            ],
            spawnOptions,
          );
          return actual;
        },
      },
    );
    expect(result).toMatchObject({
      controllerExitConfirmed: true,
      processGroupExitConfirmed: true,
      signal: 'SIGKILL',
    });
    expect(() => process.kill(result.controllerPid, 0)).toThrow();
  }, 15_000);

  it('matches a real long OpenSSH command through ps without making a network connection', async () => {
    const { options, dependencies, state, observation } = setup();
    const sshArgs = expectedSshArgs.map((arg) =>
      arg === 'ProxyCommand=none' ? 'ProxyCommand=/bin/sleep 30' : arg,
    );
    const result = await interruptLiveDeploymentUpdate(
      {
        ...options,
        cwd: process.cwd(),
        timeoutMs: 10_000,
        observeTarget: async () => observation,
      },
      {
        readIdentity: dependencies.readIdentity,
        readHostKey: dependencies.readHostKey,
        createTransport: (
          /** @type {Parameters<typeof createDeploymentOpenSshTransport>[0]} */ request,
        ) =>
          createDeploymentOpenSshTransport({
            ...request,
            runProcess: {
              run: async (/** @type {unknown} */ input) =>
                await request.runProcess.run({
                  .../** @type {Record<string, any>} */ (input),
                  args: sshArgs,
                }),
            },
          }),
        spawn: (
          /** @type {string} */ _file,
          /** @type {string[]} */ _args,
          /** @type {import('node:child_process').SpawnOptions} */ spawnOptions,
        ) => {
          state.journal = pending;
          return spawn(
            process.execPath,
            [
              '-e',
              `
          require('node:child_process').spawn('/usr/bin/ssh', JSON.parse(process.argv[1]), {stdio: 'inherit'});
          setInterval(() => {}, 1000);
        `,
              JSON.stringify(sshArgs),
            ],
            spawnOptions,
          );
        },
      },
    );
    expect(result).toMatchObject({
      controllerPaused: true,
      controllerExitConfirmed: true,
      processGroupExitConfirmed: true,
      signal: 'SIGKILL',
    });
  }, 15_000);

  it('retains only a fixed observation failure code and stage before cleanup sends SIGKILL', async () => {
    const { options, dependencies } = setup();
    dependencies.listProcesses.mockRejectedValue(
      Object.assign(new Error('private process details'), {
        diagnostic: {
          phase: 'update-process-observation',
          privateDetails: 'secret',
        },
      }),
    );
    const failure = await interruptLiveDeploymentUpdate(
      options,
      dependencies,
    ).catch((error) => error);
    expect(failure.diagnostic).toMatchObject({
      faultStage: 'find-converge-child',
      faultCode: 'process-observation-failed',
      signal: 'SIGKILL',
      controllerExitConfirmed: true,
    });
    expect(JSON.stringify(failure)).not.toMatch(
      /private process details|privateDetails|secret/,
    );
  });
});
