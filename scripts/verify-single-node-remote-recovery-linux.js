/* eslint-disable jsdoc/require-param, jsdoc/require-returns, jsdoc/require-param-description -- Disposable integration proof uses bounded procedural helpers. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBoundedProcessRunner } from '../src/core/runtime/bounded-process.js';
import { sha256Base64Url } from '../src/core/runtime/content-id.js';
import { createDeploymentOpenSshTransport } from '../src/core/runtime/deployment-openssh-transport.js';
import { createDeploymentSshIdentityStore } from '../src/core/runtime/deployment-ssh-identity.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
} from '../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import { resolveHetznerSingleNodePlan } from '../src/core/runtime/providers/hetzner/single-node-plan.js';
import { createSingleNodeCloudInit } from '../src/core/runtime/single-node-cloud-init.js';
import { createSingleNodeDeploymentDesired } from '../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../src/core/runtime/single-node-deployment-intent.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournalStore,
  prepareSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  settleSingleNodeDeploymentReleaseTransition,
} from '../src/core/runtime/single-node-deployment-journal.js';
import {
  createSingleNodeRemoteActivator,
  getSingleNodeRemoteArtifactPaths,
} from '../src/core/runtime/single-node-remote-activation.js';
import { createPackageTarball } from './package-verification.js';
// Keep the independent builder in the proof's checked import graph. Importing
// it performs no work; only the separate process invokes its entrypoint.
import { assertMatchingRemoteRecoveryPayloadRecords } from './remote-recovery-package-child.js';

const ROOT = '/var/tmp/wharfie-systemd-proof';
const APP_ID = 'remote-recovery-proof';
const UNIT = `wharfie-${APP_ID}.service`;
const MARKERS = '/home/wharfie/remote-recovery-markers.jsonl';
const BOOTSTRAP = '/etc/wharfie/bootstrap-v1.json';
const DATA_ROOT = `${ROOT}/controller`;
const ADDRESS = '127.0.0.1';
const TIMER_DELAY_MS = 60_000;
let currentPhase = 'preflight';
let lastProcess = null;
let failedProcess = null;
let failedRemoteService = null;
let ownsProofRoot = false;
const LOCATION = Object.freeze({
  id: 1,
  name: 'fsn1',
  city: 'Falkenstein',
  country: 'DE',
  networkZone: 'eu-central',
});

/** Execute one bounded process without a shell. */
function run(file, args, options = /** @type {Record<string, any>} */ ({})) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout || 60_000,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
  });
  lastProcess = {
    executable: path.basename(file),
    status: result.status,
    signal: result.signal,
  };
  if (result.error || (!options.allowFailure && result.status !== 0)) {
    failedProcess = lastProcess;
  }
  if (result.error) throw result.error;
  if (!options.allowFailure) {
    assert.equal(
      result.status,
      0,
      `${path.basename(file)} failed (exit ${result.status}, signal ${result.signal}): ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

/** Parse the complete single-document public command output. */
function json(result) {
  return JSON.parse(result.stdout.trim());
}

/** Write one private proof receipt without overwriting previous evidence. */
function receipt(name, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(bytes) <= 256 * 1024,
    'proof receipt exceeds 256 KiB',
  );
  writeFileSync(path.join(ROOT, name), bytes, {
    mode: 0o600,
    flag: 'wx',
  });
}

/** Expose phases without retaining child logs or sensitive key material. */
function announce(phase) {
  currentPhase = phase;
  process.stdout.write(
    `${JSON.stringify({ phase, at: new Date().toISOString() })}\n`,
  );
}

/** Read only the finite package phase protocol after a builder process fails. */
function readPackageProgress() {
  try {
    const selected = path.join(ROOT, 'package-progress.json');
    assert.ok(statSync(selected).size <= 4096);
    const progress = JSON.parse(readFileSync(selected, 'utf8'));
    assert.ok(['guest', 'controller'].includes(progress.pass));
    assert.ok(
      ['resolve', 'prepare', 'build', 'download', 'publish'].includes(
        progress.phase,
      ),
    );
    assert.ok(Number.isSafeInteger(progress.rssBytes) && progress.rssBytes > 0);
    return {
      pass: progress.pass,
      phase: progress.phase,
      rssBytes: progress.rssBytes,
    };
  } catch {
    return null;
  }
}

/** Keep only bounded diagnostics for the proof's two public service commands. */
export function remoteRecoveryServiceFailureContext(
  remotePath,
  request,
  outcome,
) {
  const argv = /** @type {{argv: string[]}} */ (request).argv;
  if (
    argv.length !== 5 ||
    argv[0] !== remotePath ||
    argv[1] !== 'wharfie' ||
    argv[2] !== 'service' ||
    !['converge', 'status'].includes(argv[3]) ||
    argv[4] !== '--json' ||
    (outcome.status === 'exited' && outcome.exitCode === 0)
  ) {
    return null;
  }
  return {
    operation: argv[3],
    status: outcome.status,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    stdout: outcome.stdout.subarray(0, 8192).toString('utf8'),
    stderr: outcome.stderr.subarray(0, 8192).toString('utf8'),
  };
}

/** Poll one finite observation under an overall monotonic deadline. */
async function waitFor(observe, predicate, label, timeout = 120_000) {
  const end = performance.now() + timeout;
  let observed;
  while (performance.now() < end) {
    observed = observe();
    if (predicate(observed)) return observed;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(observed)}`);
}

/** Synthetic provider inventory only; this helper never calls a provider. */
function syntheticProviderApi() {
  return {
    listLocations: async () => [LOCATION],
    listServerTypes: async () =>
      ['cx23', 'cpx12', 'cpx22'].map((name, index) => ({
        id: 100 + index,
        name,
        architecture: 'x86',
        cores: 2,
        memory: 4,
        disk: 40,
        locations: [
          {
            id: LOCATION.id,
            name: LOCATION.name,
            available: true,
            recommended: index === 0,
            deprecation: null,
          },
        ],
      })),
    listImages: async () => [
      {
        id: 300001,
        name: 'ubuntu-24.04',
        description: 'Synthetic Ubuntu selection for disposable SSH proof',
        type: 'system',
        status: 'available',
        architecture: 'x86',
        osFlavor: 'ubuntu',
        osVersion: '24.04',
        rapidDeploy: true,
        deprecatedAt: null,
      },
    ],
    listFirewalls: async () => [],
    listPrimaryIps: async () => [],
    listServers: async () => [],
  };
}

/** Build through the installed candidate, retaining a real x64 guest artifact. */
async function buildArtifacts(repoRoot) {
  const consumer = path.join(ROOT, 'consumer');
  mkdirSync(consumer, { mode: 0o700 });
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: 'wharfie-remote-recovery-consumer',
      version: '0.0.0',
      private: true,
      type: 'module',
    }),
  );
  const packed = createPackageTarball();
  try {
    run(
      path.join(path.dirname(process.execPath), 'npm'),
      ['install', '--no-audit', '--no-fund', packed.tarballPath],
      {
        cwd: consumer,
        timeout: 600_000,
        env: { ...process.env, npm_config_cache: path.join(ROOT, 'npm-cache') },
      },
    );
  } finally {
    packed.cleanup();
  }
  const installed = path.join(consumer, 'node_modules/@wharfie/wharfie');
  const fixture = path.join(consumer, 'app');
  cpSync(path.join(repoRoot, 'test/fixtures/apps/systemd-service'), fixture, {
    recursive: true,
  });
  const manifestPath = path.join(fixture, 'wharfie.app.js');
  let manifest = readFileSync(manifestPath, 'utf8')
    .replace('../../../../src/app.js', '@wharfie/wharfie/app')
    .replace('systemd-service-proof', APP_ID)
    .replace('delayMs: 180_000', `delayMs: ${TIMER_DELAY_MS}`);
  manifest = manifest
    .replace(
      "        {\n          id: 'resume-after-reboot',\n          kind: 'signal',\n        },\n",
      '',
    )
    .replace("step: 'resume-after-reboot'", "step: 'before-reboot'");
  assert.ok(!manifest.includes("kind: 'signal'"));
  writeFileSync(manifestPath, manifest);
  const activityPath = path.join(fixture, 'activity.js');
  writeFileSync(
    activityPath,
    readFileSync(activityPath, 'utf8').replace(
      '__WHARFIE_SYSTEMD_PROOF_RELEASE__',
      'remote-recovery',
    ),
  );
  const packagePass = (pass) => {
    const resultPath = path.join(ROOT, `${pass}-package-result.json`);
    announce(`${pass}-package-started`);
    const child = run(
      process.execPath,
      [
        fileURLToPath(
          new URL('./remote-recovery-package-child.js', import.meta.url),
        ),
        pass,
        installed,
        fixture,
        path.join(ROOT, `${pass}-build`),
        resultPath,
      ],
      { timeout: 600_000 },
    );
    // Child output is limited to progress emitted by the bounded package port;
    // do not forward arbitrary builder stdout into retained proof receipts.
    for (const line of child.stdout.split('\n')) {
      try {
        const progress = JSON.parse(line);
        if (
          progress.pass === pass &&
          ['resolve', 'prepare', 'build', 'download', 'publish'].includes(
            progress.phase,
          )
        ) {
          process.stdout.write(
            `${JSON.stringify({ pass, phase: progress.phase, rssBytes: progress.rssBytes })}\n`,
          );
        }
      } catch {
        // Only our finite progress protocol is relayed.
      }
    }
    assert.ok(statSync(resultPath).size <= 1024 * 1024);
    return JSON.parse(readFileSync(resultPath, 'utf8'));
  };
  const guest = packagePass('guest');
  announce('guest-x64-sea-packaged');
  const outer = packagePass('controller');
  assert.equal(guest.artifacts.length, 1);
  assert.equal(outer.artifacts.length, 1);
  assertMatchingRemoteRecoveryPayloadRecords(
    outer.deploymentPayload.artifactRecord,
    guest.artifacts[0].record,
  );
  assert.equal(guest.revision.revisionId, outer.revision.revisionId);
  assert.equal(guest.artifacts[0].record.target.architecture, 'x64');
  announce('self-deployable-controller-sea-packaged');
  return { guest, outer };
}

/** Run the real packaged remote crash/recovery journey in an owned Linux VM. */
export async function verifySingleNodeRemoteRecovery(repoRoot) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.versions.node, '24.13.1');
  assert.ok((process.getuid?.() || 0) > 0);
  const disposableMode = process.env.WHARFIE_SYSTEMD_PROOF_DISPOSABLE;
  assert.ok(['lima', 'owned-linux', 'github-actions'].includes(disposableMode));
  if (disposableMode === 'github-actions') {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
    assert.equal(process.arch, 'x64');
  }
  assert.match(
    process.env.WHARFIE_SYSTEMD_PROOF_COMMIT || '',
    /^[0-9a-f]{40}$/,
  );
  assert.equal(
    existsSync(ROOT),
    false,
    'remote proof requires its exact fresh owned root',
  );
  mkdirSync(ROOT, { mode: 0o700 });
  ownsProofRoot = true;
  receipt('.remote-recovery-owned.json', { uid: process.getuid(), root: ROOT });
  assert.equal(existsSync(BOOTSTRAP), false);
  assert.equal(existsSync(MARKERS), false);
  const uid = Number(run('/usr/bin/id', ['-u', 'wharfie']).stdout.trim());
  assert.equal(uid, 60706, 'the proof requires the production runtime account');
  const guestEnvironment = [
    'HOME=/home/wharfie',
    'USER=wharfie',
    'LOGNAME=wharfie',
    'PATH=/usr/bin:/bin',
    `XDG_RUNTIME_DIR=/run/user/${uid}`,
    `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,
  ];
  const asGuest = (
    file,
    args,
    options = /** @type {Record<string, any>} */ ({}),
  ) =>
    run(
      '/usr/bin/sudo',
      [
        '-n',
        '-u',
        'wharfie',
        '/usr/bin/env',
        '-i',
        ...guestEnvironment,
        file,
        ...args,
      ],
      options,
    );
  let remotePath;
  try {
    const { guest, outer } = await buildArtifacts(repoRoot);
    const artifact = guest.artifacts[0];
    const outerPath = outer.artifacts[0].path;
    const environment = {
      PATH: '/usr/bin:/bin',
      HOME: process.env.HOME,
      LANG: 'C',
      WHARFIE_DATA_ROOT: path.join(ROOT, 'outer-runtime'),
    };
    const app = (args, options = /** @type {Record<string, any>} */ ({})) =>
      run(outerPath, ['wharfie', ...args], {
        ...options,
        env: environment,
      });
    const intent = createSingleNodeDeploymentIntent({
      deployment: { id: 'disposable-ssh' },
      appId: APP_ID,
      target: artifact.record.target,
      mode: SINGLE_NODE_DEPLOYMENT_MODE,
      machine: SINGLE_NODE_MACHINE,
      access: { kind: 'public-ssh', allowedIpv4: ['127.0.0.1/32'] },
      provider: { kind: 'hetzner', location: LOCATION.name },
    });
    const desired = createSingleNodeDeploymentDesired({
      intent,
      revision: guest.revision,
      artifactRecord: artifact.record,
      observation: {
        artifactId: artifact.record.artifactId,
        byteDigest: artifact.record.byteDigest,
        size: artifact.record.size,
      },
    });
    const instance = desired.deploymentInstanceId;
    const incarnationId = createSingleNodeDeploymentIncarnationId(
      randomBytes(32),
    );
    const store = createSingleNodeDeploymentJournalStore({
      appId: APP_ID,
      deploymentInstanceId: instance,
      dataRoot: DATA_ROOT,
    });
    await store.prepareStorage();
    const identityStore = createDeploymentSshIdentityStore({
      root: path.join(DATA_ROOT, 'single-node-deployment-ssh/v1'),
      runProcess: createBoundedProcessRunner(),
    });
    const identity = await identityStore.ensureIdentity({
      deploymentInstanceId: instance,
      incarnationId,
    });
    const bootstrap = createSingleNodeCloudInit({
      deploymentInstanceId: instance,
      incarnationId,
      publicKey: identity.publicKey,
      publicKeyFingerprint: identity.publicKeyFingerprint,
    });
    const bootstrapSource = path.join(ROOT, 'bootstrap.json');
    receipt('bootstrap.json', bootstrap.bootstrapIdentity);
    run('/usr/bin/sudo', [
      '-n',
      '/usr/bin/install',
      '-m',
      '0644',
      bootstrapSource,
      BOOTSTRAP,
    ]);
    run('/usr/bin/sudo', [
      '-n',
      '/usr/bin/touch',
      '/var/lib/wharfie-bootstrap-v1.complete',
    ]);
    const publicKeyPath = path.join(ROOT, 'authorized_keys');
    writeFileSync(publicKeyPath, `${identity.publicKey}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    run('/usr/bin/sudo', [
      '-n',
      '/usr/bin/install',
      '-m',
      '0600',
      '-o',
      'wharfie',
      '-g',
      'wharfie',
      publicKeyPath,
      '/home/wharfie/.ssh/authorized_keys',
    ]);

    const plan = await resolveHetznerSingleNodePlan({
      desired,
      api: syntheticProviderApi(),
    });
    const providerIntent = {
      provider: 'hetzner',
      intent: createHetznerSingleNodeProvisioningIntent({
        plan,
        incarnationId,
        ownershipNonces: {
          firewall: sha256Base64Url(randomBytes(32)),
          primaryIp: sha256Base64Url(randomBytes(32)),
          server: sha256Base64Url(randomBytes(32)),
        },
        cloudInitDigest: bootstrap.digest,
      }),
    };
    let journal = await store.initialize({ desired, providerIntent });
    const commit = async (next) => {
      journal = await store.commit({
        expectedGeneration: journal.generation,
        expectedJournalId: journal.journalId,
        next,
      });
    };
    await commit(advanceSingleNodeDeploymentJournal(journal, 'provisioning'));
    for (const [index, role] of ['firewall', 'primaryIp', 'server'].entries()) {
      await commit(
        prepareSingleNodeDeploymentMutation(
          journal,
          createHetznerProvisioningMutationAttempt(providerIntent.intent, role),
        ),
      );
      await commit(
        completeSingleNodeDeploymentMutation(
          journal,
          createHetznerProvisionedResourceRecord(
            providerIntent.intent,
            role,
            101 + index,
          ),
        ),
      );
      if (role !== 'firewall') {
        await commit(
          recordSingleNodeDeploymentResource(journal, {
            ...journal.resources.find((entry) => entry.role === role),
            publicIpv4: ADDRESS,
          }),
        );
      }
    }
    await commit(advanceSingleNodeDeploymentJournal(journal, 'provisioned'));
    remotePath = getSingleNodeRemoteArtifactPaths(
      desired,
      incarnationId,
    ).remoteArtifactPath;
    announce('initial-real-ssh-service-activation');
    const activation = await createSingleNodeRemoteActivator({
      runProcess: createBoundedProcessRunner(),
      createTransport(options) {
        const transport = createDeploymentOpenSshTransport(options);
        return {
          async runRemoteArgv(request) {
            const outcome = await transport.runRemoteArgv(request);
            const context = remoteRecoveryServiceFailureContext(
              remotePath,
              request,
              outcome,
            );
            if (context) {
              // These two proof-owned public commands receive no secrets. Keep
              // only their bounded result, never SSH argv, input or environment.
              failedRemoteService = context;
              process.stderr.write(`${JSON.stringify(failedRemoteService)}\n`);
            }
            return outcome;
          },
        };
      },
    }).activate({
      desired,
      incarnationId,
      providerAddress: ADDRESS,
      retainedArtifactIds: [artifact.record.artifactId],
      sshIdentity: identity,
      artifactPath: artifact.path,
    });
    remotePath = activation.artifact.remotePath;
    await commit(
      recordSingleNodeDeploymentSshHost(journal, {
        address: ADDRESS,
        ...activation.sshHostKey,
      }),
    );
    await commit(advanceSingleNodeDeploymentJournal(journal, 'activating'));
    await commit(recordSingleNodeDeploymentActivation(journal, activation));
    await commit(settleSingleNodeDeploymentReleaseTransition(journal));
    await commit(advanceSingleNodeDeploymentJournal(journal, 'active'));
    announce('synthetic-journal-real-ssh-activation');

    const selectors = [
      '--deployment-instance',
      instance,
      '--data-root',
      DATA_ROOT,
    ];
    const exec = (argv, options = /** @type {Record<string, any>} */ ({})) =>
      app(['deployment', 'exec', ...selectors, '--', ...argv], options);
    const inspectCoordinator = () =>
      json(
        app(['deployment', 'coordinator', 'inspect', ...selectors, '--json']),
      );
    const service = () =>
      json(asGuest(remotePath, ['wharfie', 'service', 'status', '--json']));
    const inspectRun = (runId) =>
      json(
        asGuest(remotePath, [
          'wharfie',
          'inspect',
          '--run-id',
          runId,
          '--json',
        ]),
      );
    const markers = () => {
      const bytes = run('/usr/bin/sudo', [
        '-n',
        '/usr/bin/cat',
        '--',
        MARKERS,
      ]).stdout.trim();
      return bytes ? bytes.split('\n').map((line) => JSON.parse(line)) : [];
    };
    const before = service();
    assert.equal(before.health, 'healthy');
    const started = json(exec(['wharfie', 'start', '--json', '--', MARKERS]));
    const waiting = await waitFor(
      () => inspectRun(started.runId),
      (view) => view.workflowCursor?.disposition === 'TIMER_WAITING',
      'durable timer admission',
    );
    const beforeMarkers = markers();
    assert.deepEqual(
      beforeMarkers.map((entry) => entry.stepIndex),
      [0],
    );
    const predecessor = inspectCoordinator();
    assert.equal(predecessor.observedAuthority.status, 'ACTIVE');
    const pid = service().systemd.mainPid;
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    asGuest('/usr/bin/test', ['-d', `/proc/${pid}`]);
    receipt('remote-recovery-prepare.json', {
      schemaVersion: 1,
      kind: 'wharfie.remote-recovery.prepare',
      sourceCommit: process.env.WHARFIE_SYSTEMD_PROOF_COMMIT,
      providerAuthority: 'synthetic-hetzner-journal-no-provider-calls',
      transport: 'real-loopback-openssh',
      kernelArchitecture: run('/usr/bin/uname', ['-m']).stdout.trim(),
      controllerArchitecture: process.arch,
      disposableMode,
      guestTarget: artifact.record.target,
      deploymentInstanceId: instance,
      artifactId: artifact.record.artifactId,
      runId: started.runId,
      timer: waiting.timers[0],
      predecessor,
      processId: pid,
      initialActivation: activation,
    });
    asGuest('/usr/bin/kill', ['-KILL', String(pid)]);
    await waitFor(
      () =>
        asGuest('/usr/bin/test', ['-d', `/proc/${pid}`], {
          allowFailure: true,
        }),
      (result) => result.status === 1,
      'independent killed process disappearance',
    );
    const failed = await waitFor(
      service,
      (status) => status.health !== 'healthy' && status.systemd.mainPid !== pid,
      'killed resident failure',
    );
    const failedExec = exec(['wharfie', 'service', 'status', '--json'], {
      allowFailure: true,
    });
    assert.notEqual(
      failedExec.status,
      0,
      'ordinary remote exec must refuse unhealthy service',
    );
    // Prove unfinished work actually crossed the crash. If the timer finished
    // during earlier SSH observations, a final completed run alone would be a
    // false positive for recovery. No takeover has happened at this boundary.
    const interrupted = inspectRun(started.runId);
    assert.equal(interrupted.workflowCursor?.disposition, 'TIMER_WAITING');
    assert.equal(interrupted.timers.length, 1);
    assert.equal(interrupted.timers[0].timerId, waiting.timers[0].timerId);
    assert.equal(interrupted.timers[0].dueAt, waiting.timers[0].dueAt);
    assert.equal(interrupted.timers[0].status, waiting.timers[0].status);
    assert.deepEqual(markers(), beforeMarkers);
    const inspection = inspectCoordinator();
    assert.deepEqual(
      inspection.observedAuthority,
      predecessor.observedAuthority,
    );
    const inspectionFile = path.join(ROOT, 'controller-inspection.json');
    receipt('controller-inspection.json', inspection);
    assert.equal(
      asGuest('/usr/bin/test', ['-r', inspectionFile], { allowFailure: true })
        .status,
      1,
      'guest must not be able to read controller-local inspection file',
    );
    const takeoverArgs = [
      'deployment',
      'coordinator',
      'takeover',
      ...selectors,
      '--inspection-file',
      inspectionFile,
      '--coordinator-id',
      `remote-proof-${randomUUID()}`,
      '--request-id',
      `remote-proof-${randomUUID()}`,
      '--confirm-authority-replacement',
      '--json',
    ];
    const takeover = json(app(takeoverArgs));
    assert.equal(takeover.resultAuthority.status, 'RELEASED');
    assert.equal(
      takeover.takeoverAuthority.epoch,
      predecessor.observedAuthority.epoch + 1,
    );
    const recovered = json(
      app(['deployment', 'recover', ...selectors, '--json'], {
        timeout: 180_000,
      }),
    );
    assert.equal(recovered.action, 'repair');
    const healthy = await waitFor(
      service,
      (status) => status.health === 'healthy',
      'recovered resident',
    );
    assert.notEqual(healthy.systemd.mainPid, pid);
    const successor = inspectCoordinator();
    assert.ok(
      successor.observedAuthority.epoch > takeover.resultAuthority.epoch,
    );
    const replay = json(app(takeoverArgs));
    assert.equal(replay.applied, false);
    assert.deepEqual(inspectCoordinator(), successor);
    assert.equal(
      service().systemd.mainPid,
      healthy.systemd.mainPid,
      'exact replay must not stop the recovered healthy resident',
    );
    announce('remote-inspect-takeover-recover-and-live-replay');
    const completed = await waitFor(
      () => inspectRun(started.runId),
      (view) => view.workflowCursor?.disposition === 'COMPLETED',
      'workflow completion',
    );
    assert.equal(completed.run.status, 'COMPLETED');
    assert.equal(completed.timers.length, 1);
    assert.equal(completed.timers[0].timerId, waiting.timers[0].timerId);
    assert.equal(completed.timers[0].dueAt, waiting.timers[0].dueAt);
    assert.equal(completed.timers[0].status, 'FIRED');
    const afterMarkers = markers();
    assert.deepEqual(
      afterMarkers.map((entry) => entry.stepIndex),
      [0, 1],
    );
    assert.deepEqual(afterMarkers[0], beforeMarkers[0]);
    const output = json(
      exec([
        'wharfie',
        'output',
        '--run-id',
        started.runId,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );
    const uninstall = json(
      asGuest(remotePath, ['wharfie', 'service', 'uninstall', '--json']),
    );
    const stopped = service();
    assert.equal(stopped.systemd.mainPid, 0);
    assert.equal(stopped.installation.state, 'uninstalled');
    receipt('remote-recovery-final.json', {
      schemaVersion: 1,
      kind: 'wharfie.remote-recovery.final',
      sourceCommit: process.env.WHARFIE_SYSTEMD_PROOF_COMMIT,
      providerAuthority: 'synthetic-hetzner-journal-no-provider-calls',
      transport: 'real-loopback-openssh',
      deploymentInstanceId: instance,
      artifactId: artifact.record.artifactId,
      runId: started.runId,
      failedService: failed,
      interrupted,
      inspection,
      takeover,
      recovered,
      successor,
      replay,
      healthyService: healthy,
      completed,
      output,
      physicalActivityEntries: afterMarkers,
      processLoss: {
        signal: 'SIGKILL',
        processId: pid,
        predecessorExited: true,
      },
      uninstall,
      cleanup: {
        serviceUninstalled: true,
        machineDeletion:
          disposableMode === 'github-actions'
            ? 'github-hosted-runner-disposal'
            : 'host-driver-required',
      },
    });
    announce('workflow-continued-once-service-uninstalled');
  } finally {
    // Every artifact, account, bootstrap file and identity belongs to the
    // disposable machine. The host driver independently deletes that machine.
    if (remotePath) {
      asGuest('/usr/bin/systemctl', ['--user', 'stop', UNIT], {
        allowFailure: true,
      });
    }
    assert.equal(statSync(ROOT).uid, process.getuid());
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await verifySingleNodeRemoteRecovery(path.resolve(process.argv[2] || '.'));
  } catch (error) {
    // Upload bounded context and only failed public service-command output.
    // SSH argv/input, journal state, environment and keys remain excluded.
    if (ownsProofRoot) {
      receipt('remote-recovery-failure.json', {
        schemaVersion: 1,
        kind: 'wharfie.remote-recovery.failure',
        sourceCommit: process.env.WHARFIE_SYSTEMD_PROOF_COMMIT,
        phase: currentPhase,
        packageProgress: readPackageProgress(),
        process: failedProcess || lastProcess,
        remoteService: failedRemoteService,
        errorName: error instanceof Error ? error.name : 'UnknownFailure',
      });
    }
    throw error;
  }
}
