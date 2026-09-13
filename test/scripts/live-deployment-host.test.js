import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createLiveDeploymentHost } from '../../scripts/live-deployment-host.js';
import {
  rebootLiveDeploymentInChild,
  rebootLiveDeploymentProvider,
} from '../../scripts/live-deployment-reboot-child.js';
import { SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH } from '../../src/core/runtime/single-node-cloud-init.js';
import { prepareSingleNodeDeploymentReleaseUpdate } from '../../src/core/runtime/single-node-deployment-journal.js';
import { getSingleNodeRemoteArtifactPaths } from '../../src/core/runtime/single-node-remote-activation.js';
import {
  createHealthySingleNodeServiceStatus,
  createProcessOutcome,
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from '../runtime/fixtures/single-node-status-fixture.js';

const ACCEPTANCE_ID = 'a8234df0-0cc3-455f-8d75-afd7b7482903';
const BOOT_ID = 'a8234df0-0cc3-455f-8d75-afd7b7482904';
const DATA_ROOT = '/private/live-acceptance/controller';
const INPUT_PATH = `/home/wharfie/live-acceptance-${ACCEPTANCE_ID}.txt`;
/** @type {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} */
let fixture;
/** @type {ReturnType<typeof createSingleNodeStatusActiveJournal>} */
let journal;
/** @type {Record<string, any>} */
let state;

beforeAll(async () => {
  fixture = await createSingleNodeStatusAuthorityFixture({
    deploymentId: `acceptance-${ACCEPTANCE_ID}`,
  });
  journal = createSingleNodeStatusActiveJournal(fixture);
  state = {
    runId: ACCEPTANCE_ID,
    appId: fixture.desired.intent.appId,
    provider: 'hetzner',
    deploymentId: fixture.desired.intent.deployment.id,
    deploymentInstanceId: journal.deploymentInstanceId,
    desiredRevisionId: fixture.desired.desiredRevisionId,
    guestArtifactId: fixture.artifactRecord.artifactId,
    guestRevisionId: fixture.artifactRecord.revisionId,
  };
});

/** Fixed transport fixture exercising the real host identity validation. */
async function hostFixture() {
  const observed = {
    bootstrap: fixture.bootstrapIdentity,
    bootId: BOOT_ID,
    uid: 60706,
    pid: 1257,
    startTicks: '32931',
    input: '',
    markers: '',
    disappeared: false,
    artifactDigest: fixture.artifactRecord.byteDigest.value,
    service: createHealthySingleNodeServiceStatus(fixture),
  };
  const remote = jest.fn(async (/** @type {Record<string, any>} */ request) => {
    const argv = request.argv;
    let output = '';
    if (argv[0] === '/usr/bin/cat') {
      const selected = argv.at(-1);
      if (selected === SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH)
        output = JSON.stringify(observed.bootstrap);
      else if (selected === '/proc/sys/kernel/random/boot_id')
        output = observed.bootId;
      else if (selected === `/proc/${observed.pid}/stat`) {
        const fields = Array(49).fill('0');
        fields[0] = 'S';
        fields[19] = observed.startTicks;
        output = `${observed.pid} (fixture name) ${fields.join(' ')}\n`;
      } else if (selected === INPUT_PATH) output = observed.input;
      else throw new Error('Unexpected fixture read.');
    } else if (argv[0] === '/usr/bin/id' || argv[0] === '/usr/bin/stat') {
      output = String(observed.uid);
    } else if (argv[0] === '/usr/bin/sha256sum') {
      output = `${Buffer.from(observed.artifactDigest, 'base64url').toString('hex')}  ${argv.at(-1)}\n`;
    } else if (argv[0] === '/bin/sh') {
      if (argv[2].includes('set -C'))
        observed.input = request.stdin.toString('utf8');
      else if (argv[2].includes('test ! -L')) output = observed.markers;
      else if (argv[2].includes('--signal=KILL')) observed.disappeared = true;
      else if (argv[2].includes("printf 'absent")) {
        const fields = Array(49).fill('0');
        fields[0] = 'S';
        fields[19] = observed.startTicks;
        output = observed.disappeared
          ? 'absent\n'
          : `${observed.uid}\n${observed.pid} (fixture name) ${fields.join(' ')}\n`;
      }
    } else if (argv.includes('service')) {
      output = JSON.stringify({
        ...observed.service,
        systemd: { ...observed.service.systemd, mainPid: observed.pid },
      });
    } else if (argv.includes('inspect')) {
      output = JSON.stringify({ runId: argv[argv.indexOf('--run-id') + 1] });
    } else throw new Error('Unexpected fixture command.');
    return createProcessOutcome({ stdout: output });
  });
  const reboot = jest.fn(async (/** @type {unknown} */ _input) => ({
    action: 'reboot-requested',
  }));
  const createTransport = jest.fn((/** @type {unknown} */ _input) => ({
    runRemoteArgv: remote,
  }));
  const dependencies = {
    readIdentity: async () => fixture.sshIdentity,
    readHostKey: async () => journal.sshHost,
    createTransport,
    reboot,
  };
  const input = {
    state,
    journal,
    dataRoot: DATA_ROOT,
    env: { HCLOUD_TOKEN: 'private-token' },
  };
  const host = await createLiveDeploymentHost(input, dependencies);
  return {
    host,
    observed,
    remote,
    reboot,
    createTransport,
    dependencies,
    input,
  };
}

describe('live acceptance pinned host operations', () => {
  it('observes exact uploaded target bytes before the local journal settles them', async () => {
    const { input, dependencies, observed, remote } = await hostFixture();
    const target = createSingleNodeStatusUpdateTarget(
      fixture,
      'target-observation',
    );
    const pending = prepareSingleNodeDeploymentReleaseUpdate(
      journal,
      target.desired,
    );
    observed.service = createHealthySingleNodeServiceStatus({
      ...fixture,
      desired: target.desired,
    });
    observed.artifactDigest = target.artifactRecord.byteDigest.value;
    const host = await createLiveDeploymentHost(
      {
        ...input,
        journal: pending,
        release: 'target',
        state: {
          ...state,
          desiredRevisionId: target.desired.desiredRevisionId,
          guestArtifactId: target.artifactRecord.artifactId,
          guestRevisionId: target.artifactRecord.revisionId,
        },
      },
      dependencies,
    );
    const observation = await host.observe();
    expect(observation.artifactId).toBe(target.artifactRecord.artifactId);
    expect(observation.service.health).toBe('healthy');
    expect(pending.release.current.desired.artifact.artifactId).toBe(
      fixture.artifactRecord.artifactId,
    );
    expect(pending.release.transition.target.activation).toBeNull();
    const expectedPath = getSingleNodeRemoteArtifactPaths(
      target.desired,
      journal.incarnationId,
    ).remoteArtifactPath;
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ['/usr/bin/sha256sum', '--', expectedPath],
      }),
    );
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: [expectedPath, 'wharfie', 'service', 'status', '--json'],
      }),
    );
    remote.mockClear();
    await expect(host.killResident(observation)).rejects.toThrow(
      'host-kill-resident',
    );
    await expect(host.reboot(observation)).rejects.toThrow('host-reboot');
    await expect(host.stageInput(INPUT_PATH, 'bytes')).rejects.toThrow(
      'host-stage-input',
    );
    expect(remote).not.toHaveBeenCalled();
    observed.artifactDigest = fixture.artifactRecord.byteDigest.value;
    await expect(host.observe()).rejects.toThrow('host-observe');
    expect(
      remote.mock.calls.some(([request]) => request.argv[0] === expectedPath),
    ).toBe(false);
  });

  it('requires a prepared matching target and keeps current-only behavior unchanged', async () => {
    const { input, dependencies, createTransport } = await hostFixture();
    createTransport.mockClear();
    await expect(
      createLiveDeploymentHost({ ...input, release: 'target' }, dependencies),
    ).rejects.toThrow('host-initialize');
    const target = createSingleNodeStatusUpdateTarget(
      fixture,
      'target-selection',
    );
    const pending = prepareSingleNodeDeploymentReleaseUpdate(
      journal,
      target.desired,
    );
    await expect(
      createLiveDeploymentHost({ ...input, journal: pending }, dependencies),
    ).rejects.toThrow('host-initialize');
    await expect(
      createLiveDeploymentHost(
        { ...input, journal: pending, release: 'target' },
        dependencies,
      ),
    ).rejects.toThrow('host-initialize');
    await expect(
      createLiveDeploymentHost({ ...input, release: 'rollback' }, dependencies),
    ).rejects.toThrow('host-initialize');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('observes installed release and exact boot/process identity through pinned SSH', async () => {
    const { host, remote, createTransport } = await hostFixture();
    const observed = await host.observe();
    expect(observed).toMatchObject({
      deploymentInstanceId: journal.deploymentInstanceId,
      incarnationId: journal.incarnationId,
      bootId: BOOT_ID,
      uid: 60706,
      artifactId: fixture.artifactRecord.artifactId,
      process: { pid: 1257, startTicks: '32931' },
      service: { health: 'healthy', systemd: { mainPid: 1257 } },
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        address: fixture.publicIpv4,
        privateKeyPath: fixture.sshIdentity.privateKeyPath,
        knownHostsPath: fixture.sshIdentity.knownHostsPath,
      }),
    );
    for (const [request] of remote.mock.calls) {
      expect(request.timeoutMilliseconds).toBe(30_000);
      expect(request.maximumStdoutBytes).toBe(256 * 1024);
    }
    expect(JSON.stringify(observed)).not.toContain('private-token');
    expect(JSON.stringify(observed)).not.toContain('known_hosts');
  });

  it('permits read-only inspection while the resident is failed', async () => {
    const { host, observed } = await hostFixture();
    observed.pid = 0;
    observed.service.health = 'failed';
    expect((await host.observe()).process).toBeNull();
    const runId = `wfr_${Buffer.alloc(32, 17).toString('base64url')}`;
    expect(await host.inspectRun(runId)).toEqual({ runId });
  });

  it('marks independently disappeared processes retryable and identity failures terminal', async () => {
    const { host, observed } = await hostFixture();
    observed.disappeared = true;
    await expect(host.observe()).rejects.toMatchObject({
      diagnostic: { retryable: true },
    });
    observed.disappeared = false;
    observed.uid = 0;
    await expect(host.observe()).rejects.toMatchObject({
      diagnostic: { retryable: false },
    });
  });

  it('refuses changed bootstrap or installed artifact before any fault', async () => {
    const { host, observed, remote, reboot } = await hostFixture();
    const before = await host.observe();
    observed.bootstrap = {
      ...observed.bootstrap,
      incarnationId: 'secret-value',
    };
    await expect(host.killResident(before)).rejects.toThrow(
      'host-kill-resident',
    );
    await expect(host.reboot(before)).rejects.toThrow('host-reboot');
    expect(reboot).not.toHaveBeenCalled();
    expect(
      remote.mock.calls.some(([request]) =>
        request.argv[2]?.includes('--signal=KILL'),
      ),
    ).toBe(false);
    observed.bootstrap = fixture.bootstrapIdentity;
    observed.service.installation.activeArtifactId = 'secret-value';
    await expect(host.observe()).rejects.toThrow('host-observe');
  });

  it.each(['bootId', 'pid', 'startTicks', 'uid'])(
    'refuses a changed %s before SIGKILL',
    async (field) => {
      const { host, observed, remote } = await hostFixture();
      const before = await host.observe();
      if (field === 'bootId')
        observed.bootId = 'a8234df0-0cc3-455f-8d75-afd7b7482910';
      if (field === 'pid') observed.pid += 1;
      if (field === 'uid') observed.uid += 1;
      if (field === 'startTicks') observed.startTicks = '32932';
      await expect(host.killResident(before)).rejects.toThrow(
        'host-kill-resident',
      );
      expect(
        remote.mock.calls.some(([request]) =>
          request.argv[2]?.includes('--signal=KILL'),
        ),
      ).toBe(false);
    },
  );

  it('kills only the verified unit and requests reboot only after a fresh matching observation', async () => {
    const { host, remote, reboot, input, observed } = await hostFixture();
    const before = await host.observe();
    await expect(host.killResident(before)).resolves.toMatchObject({
      action: 'resident-killed',
      bootId: BOOT_ID,
      predecessorExited: true,
    });
    const faultIndex = remote.mock.calls.findIndex(([request]) =>
      request.argv[2]?.includes('--signal=KILL'),
    );
    const fault = remote.mock.calls[faultIndex]?.[0];
    expect(fault?.argv.slice(4)).toEqual([
      BOOT_ID,
      '1257',
      '32931',
      'wharfie-status-app.service',
      '60706',
    ]);
    expect(fault?.argv[2]).toContain(
      '/usr/bin/systemctl --user kill --kill-whom=main --signal=KILL "$4"',
    );
    expect(fault?.argv[2]).toContain('test "${25}" = "$3"');
    expect(
      remote.mock.calls
        .slice(faultIndex + 1)
        .map(([request]) => request.argv.at(-1)),
    ).toEqual(['/proc/sys/kernel/random/boot_id', '1257']);
    observed.disappeared = false;
    await host.reboot(before);
    expect(reboot).toHaveBeenCalledTimes(1);
    expect(reboot).toHaveBeenCalledWith(
      expect.objectContaining({ journal, dataRoot: DATA_ROOT, env: input.env }),
    );
  });

  it('stages only the unique exclusive path and preserves literal input bytes', async () => {
    const { host, observed, remote } = await hostFixture();
    const bytes = '`touch should-not-run` $(printf no)\n';
    await expect(host.stageInput(INPUT_PATH, bytes)).resolves.toEqual({
      staged: true,
      bytes: Buffer.byteLength(bytes),
    });
    expect(observed.input).toBe(bytes);
    const stage = remote.mock.calls.find(
      ([request]) => request.argv[0] === '/bin/sh',
    )?.[0];
    expect(stage?.argv).not.toContain(bytes);
    expect(stage?.stdin.toString('utf8')).toBe(bytes);
    expect(stage?.argv[2]).toContain('set -C');
    await expect(
      host.stageInput('/home/wharfie/another.txt', bytes),
    ).rejects.toThrow('host-stage-input');
    await expect(host.stageInput(INPUT_PATH, 'x'.repeat(4097))).rejects.toThrow(
      'host-stage-input',
    );
  });

  it('reads no markers before execution and bounded entries afterward', async () => {
    const { host, observed } = await hostFixture();
    await expect(host.readMarkers(INPUT_PATH)).resolves.toEqual([]);
    observed.markers = '{"activity":"capture"}\n{"activity":"verify"}\n';
    await expect(host.readMarkers(INPUT_PATH)).resolves.toEqual([
      { activity: 'capture' },
      { activity: 'verify' },
    ]);
    observed.markers = '{}\n'.repeat(17);
    await expect(host.readMarkers(INPUT_PATH)).rejects.toThrow(
      'host-read-markers',
    );
  });

  it('rejects foreign state and host pins before connecting, with bounded secret-free failure', async () => {
    const { input, dependencies, createTransport } = await hostFixture();
    createTransport.mockClear();
    await expect(
      createLiveDeploymentHost(
        { ...input, state: { ...state, deploymentId: 'production' } },
        dependencies,
      ),
    ).rejects.toThrow('host-initialize');
    const error = await createLiveDeploymentHost(input, {
      ...dependencies,
      readHostKey: async () => ({
        ...journal.sshHost,
        fingerprint: 'private-secret',
      }),
    }).catch((failure) => failure);
    expect(error.message).toBe(
      'Live deployment failed during host-initialize.',
    );
    expect(JSON.stringify(error)).not.toContain('private-secret');
    expect(createTransport).not.toHaveBeenCalled();
  });
});

/** Canonical exact Hetzner provider observation and injectable mutation ports. */
function rebootFixture() {
  const ownership = journal.providerIntent.intent.resources.server.ownership;
  const server = /** @type {Record<string, any>} */ ({
    id: 103,
    status: 'running',
    name: ownership.name,
    labels: ownership.labels,
    publicIpv4: { ip: fixture.publicIpv4 },
  });
  const reboot = jest.fn(
    async (
      /** @type {string} */ _token,
      /** @type {number} */ _id,
      /** @type {AbortSignal} */ _signal,
    ) => {},
  );
  const binding = jest.fn(
    async (/** @type {Record<string, any>} */ _input) => ({
      deploymentInstanceId: journal.deploymentInstanceId,
    }),
  );
  const read = jest.fn(async (/** @type {number} */ _id) => server);
  const dependencies = {
    readHetznerToken: () => 'private-token',
    requireHetznerBinding: binding,
    hetznerReadClient: () => ({ getServer: read }),
    hetznerReboot: reboot,
  };
  return { server, reboot, binding, read, dependencies };
}

describe('live provider reboot authority', () => {
  it('rechecks credential binding and exact complete ownership before one reboot', async () => {
    const { dependencies, reboot, binding, read } = rebootFixture();
    const report = await rebootLiveDeploymentProvider(
      { journal, dataRoot: DATA_ROOT },
      dependencies,
    );
    expect(binding).toHaveBeenCalledWith({
      dataRoot: DATA_ROOT,
      deploymentInstanceId: journal.deploymentInstanceId,
      token: 'private-token',
    });
    expect(read).toHaveBeenCalledWith(103);
    expect(reboot).toHaveBeenCalledTimes(1);
    expect(reboot).toHaveBeenCalledWith(
      'private-token',
      103,
      expect.any(AbortSignal),
    );
    expect(report).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.live-deployment.reboot',
      provider: 'hetzner',
      deploymentInstanceId: journal.deploymentInstanceId,
      resourceId: 103,
      action: 'reboot-requested',
    });
    expect(JSON.stringify(report)).not.toContain('private-token');
  });

  it.each(['id', 'name', 'labels', 'address', 'status'])(
    'refuses changed provider %s with no reboot',
    async (field) => {
      const { server, dependencies, reboot } = rebootFixture();
      if (field === 'id') server.id = 104;
      if (field === 'name') server.name = 'other-host';
      if (field === 'labels') server.labels = {};
      if (field === 'address') server.publicIpv4.ip = '192.0.2.55';
      if (field === 'status') server.status = 'off';
      await expect(
        rebootLiveDeploymentProvider(
          { journal, dataRoot: DATA_ROOT },
          dependencies,
        ),
      ).rejects.toThrow();
      expect(reboot).not.toHaveBeenCalled();
    },
  );

  it('refuses unbound credentials before provider reads', async () => {
    const { dependencies, read, reboot } = rebootFixture();
    dependencies.requireHetznerBinding = jest.fn(async () => {
      throw new Error('private-token');
    });
    await expect(
      rebootLiveDeploymentProvider(
        { journal, dataRoot: DATA_ROOT },
        dependencies,
      ),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(reboot).not.toHaveBeenCalled();
  });

  it('isolates credentials behind bounded stdin and validates child receipt identity', async () => {
    const report = {
      schemaVersion: 1,
      kind: 'wharfie.live-deployment.reboot',
      provider: 'hetzner',
      deploymentInstanceId: journal.deploymentInstanceId,
      resourceId: 103,
      action: 'reboot-requested',
    };
    const run = jest.fn(async (/** @type {Record<string, any>} */ _input) => ({
      stdout: JSON.stringify(report),
    }));
    const input = {
      journal,
      dataRoot: DATA_ROOT,
      env: { HCLOUD_TOKEN: 'private-token' },
    };
    await expect(rebootLiveDeploymentInChild(input, { run })).resolves.toEqual(
      report,
    );
    const call = /** @type {Record<string, any>} */ (run.mock.calls[0]?.[0]);
    expect(call.timeoutMs).toBe(120_000);
    expect(call.args.at(-1)).toBe('--internal-provider-reboot');
    expect(call.stdin).not.toContain('private-token');
    expect(JSON.parse(call.stdin)).toEqual({ journal, dataRoot: DATA_ROOT });
    report.resourceId = 104;
    await expect(rebootLiveDeploymentInChild(input, { run })).rejects.toThrow();
  });
});
