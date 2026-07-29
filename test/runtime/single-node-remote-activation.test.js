import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import {
  createSingleNodeCloudInit,
  SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  SINGLE_NODE_DEPLOYMENT_ROOT,
} from '../../src/core/runtime/single-node-cloud-init.js';
import {
  createSingleNodeDeploymentIncarnationId,
  getSingleNodeDeploymentInstanceId,
} from '../../src/core/runtime/single-node-deployment-identity.js';
import { createSingleNodeDeploymentDesired } from '../../src/core/runtime/single-node-deployment-desired.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS,
  SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS,
  createSingleNodeRemoteActivator,
  validateSingleNodeRemoteActivationEvidence,
} from '../../src/core/runtime/single-node-remote-activation.js';

/** @type {string[]} */
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string|Buffer} value */
function wireString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function publicKey() {
  const blob = Buffer.concat([
    wireString('ssh-ed25519'),
    wireString(Buffer.alloc(32, 7)),
  ]);
  return `ssh-ed25519 ${blob.toString('base64')}`;
}

function makeRevision() {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'hello-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'src/greet.js',
            export: 'greet',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest('source'),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
    },
  });
}

/** @param {ReturnType<typeof makeRevision>} revision */
function makeProvenance(revision) {
  return {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: revision.inputs.runtime.digest,
      toolchainDigest: digest('toolchain'),
    },
    node: {
      version: TARGET.nodeVersion,
      archive: {
        fileName: 'node-v24.13.1-linux-x64.tar.gz',
        digest: digest('node-archive'),
      },
      binary: { digest: digest('node-binary') },
    },
    dependencies: {
      lock: revision.inputs.dependencies,
      digest: digest('target-dependencies'),
    },
    signing: { mode: 'unsigned' },
  };
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'wharfie-remote-activation-test-'));
  roots.push(root);
  const artifactPath = join(root, 'hello-linux-sea');
  const artifactBytes = Buffer.from('exact portable Linux SEA bytes');
  await writeFile(artifactPath, artifactBytes, { mode: 0o700 });
  const revision = makeRevision();
  const artifactRecord = createArtifactRecord({
    bytes: artifactBytes,
    revision,
    target: TARGET,
    provenance: makeProvenance(revision),
  });
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: TARGET,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: 'fsn1' },
  });
  const desired = createSingleNodeDeploymentDesired({
    intent,
    revision,
    artifactRecord,
    observation: {
      artifactId: artifactRecord.artifactId,
      byteDigest: artifactRecord.byteDigest,
      size: artifactRecord.size,
    },
  });
  const incarnationId = createSingleNodeDeploymentIncarnationId(
    Buffer.alloc(32, 8),
  );
  expect(desired.deploymentInstanceId).toBe(
    getSingleNodeDeploymentInstanceId(intent),
  );
  const key = publicKey();
  const bootstrap = createSingleNodeCloudInit({
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId,
    publicKey: key,
    publicKeyFingerprint: `SHA256:${createHash('sha256')
      .update(Buffer.from(key.split(' ')[1], 'base64'))
      .digest('base64')
      .replace(/=+$/u, '')}`,
  });
  return {
    root,
    artifactPath,
    artifactBytes,
    desired,
    incarnationId,
    sshIdentity: {
      privateKeyPath: join(root, 'id_ed25519'),
      publicKey: key,
      publicKeyFingerprint: bootstrap.bootstrapIdentity.sshPublicKeyFingerprint,
      knownHostsPath: join(root, 'known_hosts'),
    },
    bootstrapIdentity: bootstrap.bootstrapIdentity,
  };
}

/**
 * @param {{exitCode?: number, stdout?: string|Buffer, stderr?: string|Buffer}} [value]
 */
function outcome({
  exitCode = 0,
  stdout = Buffer.alloc(0),
  stderr = Buffer.alloc(0),
} = {}) {
  return {
    status: /** @type {const} */ ('exited'),
    exitCode,
    signal: null,
    timedOut: false,
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
  };
}

/**
 * @param {Awaited<ReturnType<typeof makeFixture>>} fixture
 * @param {{readinessFailures?: number, bootstrapIdentity?: unknown, corruptDigest?: boolean, convergeArtifactId?: string, linkAmbiguousExact?: boolean, staleUploadBytes?: Buffer}} [options]
 */
function makeRemote(fixture, options = {}) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  /** @type {Set<string>} */
  const executable = new Set();
  /** @type {Record<string, any>[]} */
  const calls = [];
  let readinessFailures = options.readinessFailures || 0;
  let installedPath = '';
  const deterministicTemporaryPath = join(
    SINGLE_NODE_DEPLOYMENT_ROOT,
    fixture.desired.deploymentInstanceId,
    'artifacts',
    fixture.desired.artifact.artifactId,
    `.app-sea.upload-${fixture.incarnationId}`,
  );
  if (options.staleUploadBytes) {
    files.set(deterministicTemporaryPath, options.staleUploadBytes);
  }

  /** @param {string} path */
  function shaOutput(path) {
    const bytes = files.get(path);
    if (!bytes) return outcome({ exitCode: 1 });
    const value = options.corruptDigest
      ? '0'.repeat(64)
      : createHash('sha256').update(bytes).digest('hex');
    return outcome({ stdout: `${value}  ${path}\n` });
  }

  const runRemoteArgv = jest.fn(
    async (/** @type {Record<string, any>} */ request) => {
      calls.push(request);
      const { argv } = request;
      if (
        argv[0] === '/usr/bin/test' &&
        argv[1] === '-f' &&
        argv[2] === SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH
      ) {
        if (readinessFailures > 0) {
          readinessFailures -= 1;
          return outcome({ exitCode: 1 });
        }
        return outcome();
      }
      if (
        argv[0] === '/usr/bin/cat' &&
        argv[2] === SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH
      ) {
        return outcome({
          stdout: JSON.stringify(
            options.bootstrapIdentity || fixture.bootstrapIdentity,
          ),
        });
      }
      if (argv[0] === '/usr/bin/install') return outcome();
      if (argv[0] === '/usr/bin/dd') {
        const path = argv[1].slice('of='.length);
        /** @type {Buffer[]} */
        const chunks = [];
        for await (const chunk of request.stdin) {
          chunks.push(Buffer.from(chunk));
        }
        files.set(path, Buffer.concat(chunks));
        return outcome();
      }
      if (argv[0] === '/usr/bin/sha256sum') {
        return shaOutput(argv[2]);
      }
      if (argv[0] === '/usr/bin/chmod') {
        executable.add(argv[2]);
        return outcome();
      }
      if (argv[0] === '/usr/bin/ln') {
        const source = argv[2];
        const destination = argv[3];
        installedPath = destination;
        const sourceBytes = files.get(source);
        if (!sourceBytes) return outcome({ exitCode: 1 });
        if (options.linkAmbiguousExact) {
          files.set(destination, Buffer.from(sourceBytes));
          executable.add(destination);
          return outcome({ exitCode: 1 });
        }
        if (files.has(destination)) return outcome({ exitCode: 1 });
        files.set(destination, Buffer.from(sourceBytes));
        if (executable.has(source)) executable.add(destination);
        return outcome();
      }
      if (argv[0] === '/usr/bin/rm') {
        const path = argv[3];
        files.delete(path);
        executable.delete(path);
        return outcome();
      }
      if (argv[0] === '/usr/bin/test' && argv[1] === '-x') {
        return outcome({ exitCode: executable.has(argv[2]) ? 0 : 1 });
      }
      if (argv[0] === installedPath && argv[3] === 'converge') {
        return outcome({
          stdout: JSON.stringify({
            schemaVersion: 1,
            kind: 'wharfie.service.result',
            action: 'converge',
            appId: fixture.desired.intent.appId,
            requestStatus: 'fulfilled',
            outcome: 'target-active',
            health: 'healthy',
            activeArtifactId:
              options.convergeArtifactId || fixture.desired.artifact.artifactId,
            activeRevisionId: fixture.desired.artifact.revisionId,
          }),
        });
      }
      if (argv[0] === installedPath && argv[3] === 'status') {
        const release = {
          artifactId: fixture.desired.artifact.artifactId,
          revisionId: fixture.desired.artifact.revisionId,
        };
        const unit = `wharfie-${fixture.desired.intent.appId}.service`;
        return outcome({
          stdout: JSON.stringify({
            schemaVersion: 3,
            kind: 'wharfie.service.status',
            appId: fixture.desired.intent.appId,
            unit,
            health: 'healthy',
            wiring: {
              state: 'managed',
              unitFile: 'managed',
              selection: 'managed',
              effectiveUnit: 'managed',
              cleanupPending: false,
            },
            installation: {
              state: 'installed',
              activeArtifactId: release.artifactId,
              activeRevisionId: release.revisionId,
            },
            systemd: {
              loadState: 'loaded',
              unitFileState: 'enabled',
              activeState: 'active',
              subState: 'running',
              result: 'success',
            },
            runtime: {
              status: 'READY',
              session: 'active',
              currentOwner: true,
              ...release,
            },
            activation: {
              phase: 'ACTIVE',
              desired: release,
              selected: release,
            },
            integrity: { status: 'verified', ...release },
            persistence: {
              linger: true,
              unitEnabled: true,
              bootEnabled: true,
            },
            desiredConvergence: {
              schemaVersion: 1,
              kind: 'wharfie.service.desired-convergence',
              appId: fixture.desired.intent.appId,
              unit,
              desired: release,
              disposition: 'authorized',
              basis: 'durable-active',
            },
          }),
        });
      }
      throw new Error(`unexpected test command: ${argv[0]}`);
    },
  );
  return {
    calls,
    files,
    executable,
    runRemoteArgv,
    createTransport: jest.fn(() => ({ runRemoteArgv })),
  };
}

/**
 * @param {Awaited<ReturnType<typeof makeFixture>>} fixture
 * @param {ReturnType<typeof makeRemote>} remote
 * @param {{ensureHostKey?: (value: unknown) => Promise<Readonly<{address: string, algorithm: 'ssh-ed25519', fingerprint: string}>>, sleep?: (milliseconds: number) => Promise<unknown>, openArtifactSource?: (path: string) => Promise<any>}} [options]
 */
function makeActivator(fixture, remote, options = {}) {
  const ensureHostKey =
    options.ensureHostKey ||
    jest.fn(async () => ({
      address: '203.0.113.10',
      algorithm: /** @type {const} */ ('ssh-ed25519'),
      fingerprint: `SHA256:${'A'.repeat(43)}`,
    }));
  const sleep = options.sleep || jest.fn(async () => {});
  return {
    ensureHostKey,
    sleep,
    activator: createSingleNodeRemoteActivator({
      runProcess: { run: jest.fn(async () => outcome()) },
      ensureHostKey,
      createTransport: remote.createTransport,
      ...(options.openArtifactSource
        ? { openArtifactSource: options.openArtifactSource }
        : {}),
      sleep,
    }),
    input: {
      desired: fixture.desired,
      incarnationId: fixture.incarnationId,
      providerAddress: '203.0.113.10',
      sshIdentity: fixture.sshIdentity,
      artifactPath: fixture.artifactPath,
    },
  };
}

/**
 * @param {Awaited<ReturnType<typeof makeFixture>>} fixture
 * @param {Readonly<Record<string, any>>} evidence
 * @param {Record<string, any>} [overrides]
 */
function evidenceContext(fixture, evidence, overrides = {}) {
  return {
    desired: fixture.desired,
    incarnationId: fixture.incarnationId,
    providerAddress: '203.0.113.10',
    sshHostKeyFingerprint: evidence.sshHostKey.fingerprint,
    sshPublicKeyFingerprint: fixture.sshIdentity.publicKeyFingerprint,
    ...overrides,
  };
}

describe('single-node remote activation', () => {
  it('proves bootstrap identity, atomically installs exact bytes, and returns public evidence', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture, {
      readinessFailures: 1,
      linkAmbiguousExact: true,
    });
    let hostAttempts = 0;
    const ensureHostKey = jest.fn(async () => {
      hostAttempts += 1;
      if (hostAttempts === 1) throw new Error('sshd not listening yet');
      return {
        address: '203.0.113.10',
        algorithm: /** @type {const} */ ('ssh-ed25519'),
        fingerprint: `SHA256:${'E'.repeat(43)}`,
      };
    });
    const harness = makeActivator(fixture, remote, { ensureHostKey });

    const evidence = await harness.activator.activate(harness.input);

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      kind: 'singleNodeRemoteActivationEvidence',
      activationEvidenceId: expect.stringMatching(/^wsne1_[A-Za-z0-9_-]{43}$/u),
      deploymentInstanceId: fixture.desired.deploymentInstanceId,
      incarnationId: fixture.incarnationId,
      desiredRevisionId: fixture.desired.desiredRevisionId,
      address: '203.0.113.10',
      sshHostKey: {
        algorithm: 'ssh-ed25519',
        fingerprint: `SHA256:${'E'.repeat(43)}`,
      },
      artifact: {
        artifactId: fixture.desired.artifact.artifactId,
        revisionId: fixture.desired.artifact.revisionId,
        byteDigest: fixture.desired.artifact.byteDigest,
        size: fixture.desired.artifact.size,
        remotePath: expect.stringContaining(
          `/${fixture.desired.artifact.artifactId}/app-sea`,
        ),
      },
      service: {
        appId: 'hello-app',
        unit: 'wharfie-hello-app.service',
        health: 'healthy',
        activeArtifactId: fixture.desired.artifact.artifactId,
        activeRevisionId: fixture.desired.artifact.revisionId,
      },
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(ensureHostKey).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(
      SINGLE_NODE_REMOTE_ACTIVATION_RETRY_DELAY_MILLISECONDS,
    );
    expect(
      remote.calls.some(
        (call) =>
          call.argv[0] === '/usr/bin/ln' &&
          call.argv[3] === evidence.artifact.remotePath,
      ),
    ).toBe(true);
    expect(remote.files.get(evidence.artifact.remotePath)).toEqual(
      fixture.artifactBytes,
    );
    expect(remote.executable.has(evidence.artifact.remotePath)).toBe(true);
    expect(
      remote.calls
        .filter((call) => call.argv[0] === evidence.artifact.remotePath)
        .map((call) => call.argv.slice(1)),
    ).toEqual([
      ['wharfie', 'service', 'converge', '--json'],
      ['wharfie', 'service', 'status', '--json'],
    ]);
    expect(JSON.stringify(evidence)).not.toContain(fixture.root);
  });

  it('refuses a bootstrap marker from another incarnation before upload', async () => {
    const fixture = await makeFixture();
    const bootstrapIdentity = JSON.parse(
      JSON.stringify(fixture.bootstrapIdentity),
    );
    bootstrapIdentity.incarnationId = createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 9),
    );
    const remote = makeRemote(fixture, { bootstrapIdentity });
    const harness = makeActivator(fixture, remote);

    await expect(harness.activator.activate(harness.input)).rejects.toThrow(
      /bootstrap identity does not match/iu,
    );
    expect(remote.calls.some((call) => call.argv[0] === '/usr/bin/dd')).toBe(
      false,
    );
  });

  it('refuses a remote SHA-256 mismatch before publishing or executing bytes', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture, { corruptDigest: true });
    const harness = makeActivator(fixture, remote);

    await expect(harness.activator.activate(harness.input)).rejects.toThrow(
      /SHA-256 does not match/iu,
    );
    expect(remote.calls.some((call) => call.argv[0] === '/usr/bin/ln')).toBe(
      false,
    );
    expect(remote.calls.some((call) => call.argv[1] === 'wharfie')).toBe(false);
  });

  it('refuses a convergence receipt for another artifact without trusting stderr', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture, {
      convergeArtifactId: `waf1_${'A'.repeat(43)}`,
    });
    const harness = makeActivator(fixture, remote);

    await expect(harness.activator.activate(harness.input)).rejects.toThrow(
      /exact desired artifact active/iu,
    );
    expect(
      remote.calls.filter((call) => call.argv[3] === 'status'),
    ).toHaveLength(0);
  });

  it('bounds readiness polling and never uploads to an unready host', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture, {
      readinessFailures:
        SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS + 1,
    });
    const harness = makeActivator(fixture, remote);

    await expect(harness.activator.activate(harness.input)).rejects.toThrow(
      /bounded deadline/iu,
    );
    expect(
      remote.calls.filter(
        (call) =>
          call.argv[0] === '/usr/bin/test' &&
          call.argv[2] === SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
      ),
    ).toHaveLength(SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS);
    expect(harness.sleep).toHaveBeenCalledTimes(
      SINGLE_NODE_REMOTE_ACTIVATION_MAX_READINESS_ATTEMPTS - 1,
    );
    expect(remote.calls.some((call) => call.argv[0] === '/usr/bin/dd')).toBe(
      false,
    );
  });

  it('cross-checks held local bytes against desired state before upload', async () => {
    const fixture = await makeFixture();
    await writeFile(fixture.artifactPath, 'different artifact bytes');
    const remote = makeRemote(fixture);
    const harness = makeActivator(fixture, remote);

    await expect(harness.activator.activate(harness.input)).rejects.toThrow(
      /local artifact source does not match/iu,
    );
    expect(remote.calls.some((call) => call.argv[0] === '/usr/bin/dd')).toBe(
      false,
    );
  });

  it('validates an independent frozen evidence document and refuses tampering or authority drift', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture);
    const harness = makeActivator(fixture, remote);
    const evidence = await harness.activator.activate(harness.input);
    const serialized = JSON.parse(JSON.stringify(evidence));

    const validated = validateSingleNodeRemoteActivationEvidence(
      serialized,
      evidenceContext(fixture, evidence),
    );

    expect(validated).toEqual(evidence);
    expect(validated).not.toBe(serialized);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.artifact)).toBe(true);
    serialized.artifact.remotePath = `${serialized.artifact.remotePath}-other`;
    expect(validated.artifact.remotePath).toBe(evidence.artifact.remotePath);
    expect(() =>
      validateSingleNodeRemoteActivationEvidence(
        serialized,
        evidenceContext(fixture, evidence),
      ),
    ).toThrow(/artifact does not match/iu);

    const wrongId = JSON.parse(JSON.stringify(evidence));
    wrongId.activationEvidenceId = `wsne1_${'A'.repeat(43)}`;
    expect(() =>
      validateSingleNodeRemoteActivationEvidence(
        wrongId,
        evidenceContext(fixture, evidence),
      ),
    ).toThrow(/activationEvidenceId does not match/iu);
    expect(() =>
      validateSingleNodeRemoteActivationEvidence(evidence, {
        ...evidenceContext(fixture, evidence),
        incarnationId: createSingleNodeDeploymentIncarnationId(
          Buffer.alloc(32, 10),
        ),
      }),
    ).toThrow(/exact deployment authority/iu);
    expect(() =>
      validateSingleNodeRemoteActivationEvidence(evidence, {
        ...evidenceContext(fixture, evidence),
        sshHostKeyFingerprint: `SHA256:${'I'.repeat(43)}`,
      }),
    ).toThrow(/host key does not match/iu);
    expect(() =>
      validateSingleNodeRemoteActivationEvidence(evidence, {
        ...evidenceContext(fixture, evidence),
        sshPublicKeyFingerprint: `SHA256:${'M'.repeat(43)}`,
      }),
    ).toThrow(/bootstrap key does not match/iu);
  });

  it('pre-cleans and reuses one deterministic incarnation-owned upload path', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture, {
      staleUploadBytes: Buffer.from('stale interrupted upload'),
    });
    const harness = makeActivator(fixture, remote);

    const evidence = await harness.activator.activate(harness.input);
    const expectedTemporaryPath = join(
      SINGLE_NODE_DEPLOYMENT_ROOT,
      fixture.desired.deploymentInstanceId,
      'artifacts',
      fixture.desired.artifact.artifactId,
      `.app-sea.upload-${fixture.incarnationId}`,
    );
    const staleRemovalIndex = remote.calls.findIndex(
      (call) =>
        call.argv[0] === '/usr/bin/rm' &&
        call.argv[3] === expectedTemporaryPath,
    );
    const uploadIndex = remote.calls.findIndex(
      (call) =>
        call.argv[0] === '/usr/bin/dd' &&
        call.argv[1] === `of=${expectedTemporaryPath}`,
    );

    expect(staleRemovalIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(staleRemovalIndex);
    expect(
      new Set(
        remote.calls
          .filter((call) => call.argv[0] === '/usr/bin/dd')
          .map((call) => call.argv[1]),
      ),
    ).toEqual(new Set([`of=${expectedTemporaryPath}`]));
    expect(remote.files.has(expectedTemporaryPath)).toBe(false);
    expect(remote.files.get(evidence.artifact.remotePath)).toEqual(
      fixture.artifactBytes,
    );
  });

  it('closes the held source when post-open source setup fails', async () => {
    const fixture = await makeFixture();
    const remote = makeRemote(fixture);
    const close = jest.fn(async () => {});
    const openArtifactSource = jest.fn(
      async (/** @type {string} */ _artifactPath) => ({
        observation: {
          artifactId: fixture.desired.artifact.artifactId,
          byteDigest: fixture.desired.artifact.byteDigest,
          size: fixture.desired.artifact.size + 1,
        },
        createReadStream: jest.fn(),
        verifyUnchanged: jest.fn(),
        close,
      }),
    );
    const harness = makeActivator(fixture, remote, {
      openArtifactSource,
    });

    await expect(harness.activator.activate(harness.input)).rejects.toThrow(
      /local artifact source does not match/iu,
    );
    expect(openArtifactSource).toHaveBeenCalledWith(fixture.artifactPath);
    expect(close).toHaveBeenCalledTimes(1);
    expect(
      remote.calls.some((call) => call.argv[0] === '/usr/bin/install'),
    ).toBe(false);
  });
});
