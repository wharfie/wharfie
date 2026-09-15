/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-description, jsdoc/require-returns-description -- These offline fixtures describe injected acceptance boundaries. */

import { createHash } from 'node:crypto';
import { LIVE_DEPLOYMENT_INPUT_BYTES } from '../../scripts/live-deployment-package.js';

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  liveDeploymentControllerEnvironment,
  liveDeploymentFailureDiagnostic,
  parseLiveDeploymentArguments,
  runLiveDeploymentAcceptance,
  waitForLiveDeploymentSoakObservation,
} from '../../scripts/verify-live-deployment.js';

/** @type {string[]} */
const roots = [];
const INSTANCE_ID = `wsnd1:${'a'.repeat(43)}`;
const SECRET = 'acceptance-test-secret-must-not-be-retained';
const ARTIFACT_RECORD = {
  artifactId: `wsaa1:${'b'.repeat(43)}`,
  revisionId: `wsar1:${'c'.repeat(43)}`,
  byteDigest: { algorithm: 'sha256', value: 'test-executable-digest' },
  size: 4,
  target: { platform: 'linux', architecture: 'x64', libc: 'glibc' },
};
const NEXT_ARTIFACT_RECORD = {
  ...ARTIFACT_RECORD,
  artifactId: `wsaa1:${'n'.repeat(43)}`,
  revisionId: `wsar1:${'r'.repeat(43)}`,
  byteDigest: { algorithm: 'sha256', value: 'test-next-executable-digest' },
};

/** @param {Record<string, any>} [changes] */
function commandFailure(changes = {}) {
  return Object.assign(new Error(SECRET), {
    stdout: SECRET,
    stderr: SECRET,
    env: { HCLOUD_TOKEN: SECRET },
    diagnostic: {
      command: `/private/${SECRET}/app`,
      status: 1,
      signal: null,
      stdout: SECRET,
      environment: { TOKEN: SECRET },
      ...changes,
    },
  });
}

/** @param {Record<string, any>} [settings] */
function fixture(settings = {}) {
  const root = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), 'wharfie-live-driver-test-'),
  );
  roots.push(root);
  const runDir = path.join(root, 'run');
  /** @type {Array<Record<string, any>>} */
  const commands = [];
  /** @type {string[]} */
  const events = [];
  /** @type {Record<string, any>|null} */
  let journal = null;
  let auditIndex = 0;
  let buildCount = 0;
  const durabilityProof = {
    runId: 'original-durable-run',
    completed: { revisionId: ARTIFACT_RECORD.revisionId },
  };
  let lockHeld = false;
  /** @type {string[]} */
  const lockIds = [];
  /** @type {boolean[]} */
  const releasedWorkspaceExists = [];
  const options = {
    provider: 'hetzner',
    placement: 'fsn1',
    allowedIpv4: '203.0.113.42/32',
    outputDir: runDir,
    ...settings.options,
  };

  /** @param {Record<string, any>} request */
  function applyReceipt(request) {
    return {
      schemaVersion: 1,
      kind: 'wharfie.deployment.apply',
      provider: options.provider,
      status: 'active',
      deploymentId: request.args[request.args.indexOf('--deployment') + 1],
      appId: 'steady-file-demo',
      revisionId: ARTIFACT_RECORD.revisionId,
      artifactId: ARTIFACT_RECORD.artifactId,
      deploymentInstanceId: INSTANCE_ID,
      publicIpv4: '203.0.113.81',
    };
  }

  /** @param {unknown} value */
  function output(value) {
    return {
      stdout: typeof value === 'string' ? value : JSON.stringify(value),
      stderr: '',
      status: 0,
      signal: null,
      durationMs: 1,
    };
  }

  const ports = {
    /** @param {string} lockId */
    acquireRunLock: async (lockId) => {
      lockIds.push(lockId);
      events.push('acquire-lock');
      if (settings.lockBusy || lockHeld)
        throw new Error('Acceptance lock busy.');
      lockHeld = true;
      return async () => {
        expect(lockHeld).toBe(true);
        releasedWorkspaceExists.push(
          existsSync(path.join(runDir, 'workspace')),
        );
        events.push('release-lock');
        lockHeld = false;
      };
    },
    /** @param {Record<string, any>} request */
    build: async (request) => {
      expect(lockHeld).toBe(true);
      buildCount++;
      events.push('build');
      if (settings.onBuild) settings.onBuild();
      if (settings.buildGate) await settings.buildGate;
      if (settings.failAt === 'package') throw commandFailure();
      writeFileSync(path.join(request.workspace, 'app'), 'test', {
        mode: 0o700,
      });
      writeFileSync(path.join(request.workspace, 'app-next'), 'next', {
        mode: 0o700,
      });
      return {
        appId: 'steady-file-demo',
        revisionId: ARTIFACT_RECORD.revisionId,
        executable: path.join(request.workspace, 'app'),
        artifactRecord: ARTIFACT_RECORD,
        packageVersion: '0.0.15',
        next: {
          appId: 'steady-file-demo',
          revisionId: NEXT_ARTIFACT_RECORD.revisionId,
          executable: path.join(request.workspace, 'app-next'),
          artifactRecord: NEXT_ARTIFACT_RECORD,
          packageVersion: '0.0.15',
        },
      };
    },
    /** @param {Record<string, any>} request */
    run: async (request) => {
      expect(lockHeld).toBe(true);
      commands.push(request);
      events.push(request.phase);
      if (request.phase === 'apply') {
        // A response may be lost after the provider mutation and durable write.
        if (!settings.missingJournal) {
          const dataRoot =
            request.args[request.args.indexOf('--data-root') + 1];
          mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
          writeFileSync(path.join(dataRoot, 'retained-authority'), 'keep-me', {
            mode: 0o600,
          });
          journal = {
            journalId: 'journal-active',
            generation: 4,
            phase: 'active',
            deploymentInstanceId: INSTANCE_ID,
            incarnationId: `wsnc1:${'d'.repeat(43)}`,
            providerIntent: { provider: options.provider },
            resources: [
              { role: 'server', id: '123' },
              { role: 'primaryIp', id: '456' },
              { role: 'firewall', id: '789' },
            ],
          };
        }
        if (settings.abortController) settings.abortController.abort();
      }
      if (settings.failAt === request.phase) {
        throw commandFailure({
          aborted: settings.abortController !== undefined,
        });
      }
      if (
        ['local-cli', 'local-cli-next', 'remote-cli'].includes(request.phase)
      ) {
        const fingerprint = {
          bytes: Buffer.byteLength(LIVE_DEPLOYMENT_INPUT_BYTES),
          sha256: createHash('sha256')
            .update(LIVE_DEPLOYMENT_INPUT_BYTES)
            .digest('hex'),
          readStable: true,
        };
        return output({
          path: request.args[0],
          stable: true,
          baseline: fingerprint,
          current: fingerprint,
          ...(request.phase === 'local-cli-next'
            ? { acceptanceRevision: 'B' }
            : {}),
        });
      }
      if (request.phase === 'preview' || request.phase === 'preview-next') {
        const next = request.phase === 'preview-next';
        const artifact = next ? NEXT_ARTIFACT_RECORD : ARTIFACT_RECORD;
        return output({
          schemaVersion: 1,
          kind: 'wharfie.single-node-deployment.preview',
          provider: options.provider,
          status: 'actionable',
          deployment: {
            appId: 'steady-file-demo',
            deploymentId:
              request.args[request.args.indexOf('--deployment') + 1],
            deploymentInstanceId: INSTANCE_ID,
            desiredRevisionId: next
              ? 'next-desired-revision'
              : 'desired-revision',
            revisionId: artifact.revisionId,
            artifact,
          },
          journal: { state: 'absent' },
        });
      }
      if (request.phase === 'apply') return output(applyReceipt(request));
      if (request.phase === 'status') return output({ status: 'healthy' });
      if (request.phase === 'fresh-controller') {
        const value = applyReceipt(request);
        if (settings.changedHost) value.publicIpv4 = '203.0.113.99';
        if (settings.changedJournal && journal) {
          journal = {
            ...journal,
            journalId: 'journal-replaced',
            incarnationId: `wsnc1:${'e'.repeat(43)}`,
          };
        }
        return output(value);
      }
      if (request.phase === 'destroy') {
        journal = {
          ...journal,
          phase: 'destroyed',
          journalId: 'journal-destroyed',
        };
        return output({
          schemaVersion: 1,
          kind: 'wharfie.deployment.destroy',
          provider: options.provider,
          status: 'destroyed',
          appId: 'steady-file-demo',
          deploymentInstanceId: INSTANCE_ID,
        });
      }
      if (['update-next', 'restore-primary'].includes(request.phase)) {
        const next = request.phase === 'update-next';
        const artifact = next ? NEXT_ARTIFACT_RECORD : ARTIFACT_RECORD;
        journal = {
          ...journal,
          journalId: next ? 'journal-next' : 'journal-restored',
          generation: next ? 5 : 6,
          currentRelease: {
            revisionId: artifact.revisionId,
            artifactId: artifact.artifactId,
          },
        };
        return output({ status: 'active', deploymentInstanceId: INSTANCE_ID });
      }
      throw new Error(`Unexpected offline command phase: ${request.phase}`);
    },
    /** @param {Record<string, any>} request */
    durability: async (request) => {
      expect(lockHeld).toBe(true);
      expect(request.journal.phase).toBe('active');
      expect(request.state.appId).toBe('steady-file-demo');
      events.push('durability');
      if (settings.failAt === 'durability') throw commandFailure();
      await request.onWaiting({ runId: durabilityProof.runId });
      events.push('durability-completed');
      return durabilityProof;
    },
    /** @param {Record<string, any>} request */
    updates: async (request) => {
      expect(lockHeld).toBe(true);
      expect(request.journal.phase).toBe('active');
      expect(request.state.nextRelease).toEqual({
        artifactRecord: NEXT_ARTIFACT_RECORD,
        desiredRevisionId: 'next-desired-revision',
        guestArtifactId: NEXT_ARTIFACT_RECORD.artifactId,
        guestRevisionId: NEXT_ARTIFACT_RECORD.revisionId,
      });
      expect(await request.readJournal()).toEqual(request.journal);
      events.push('updates-prepared');
      return {
        /** @param {Record<string, any>} waiting */
        whileWaiting: async (waiting) => {
          expect(waiting.runId).toBe(durabilityProof.runId);
          events.push('update-while-waiting');
        },
        /** @param {Record<string, any>} proof */
        afterDurability: async (proof) => {
          expect(proof).toBe(durabilityProof);
          events.push('release-updates');
          const args = [
            'wharfie',
            'deployment',
            'update',
            '--deployment-instance',
            request.state.deploymentInstanceId,
            '--data-root',
            request.dataRoot,
            '--json',
          ];
          await request.command('B', 'update-next', args, 180_000);
          if (settings.failAt === 'release-updates') throw commandFailure();
          await request.command('A', 'restore-primary', args, 180_000);
        },
      };
    },
    readJournal: async () => {
      expect(lockHeld).toBe(true);
      events.push('read-journal');
      return journal === null ? null : structuredClone(journal);
    },
    /** @param {Record<string, any>} request */
    audit: async (request) => {
      expect(lockHeld).toBe(true);
      events.push('audit');
      expect(request.journal.phase).toBe('destroyed');
      if (settings.failAt === 'release-updates') {
        expect(request.journal.currentRelease).toEqual({
          revisionId: NEXT_ARTIFACT_RECORD.revisionId,
          artifactId: NEXT_ARTIFACT_RECORD.artifactId,
        });
      }
      expect(existsSync(request.dataRoot)).toBe(true);
      const statuses = settings.auditStatuses ?? ['absent'];
      const status = statuses[Math.min(auditIndex++, statuses.length - 1)];
      const roles =
        options.provider === 'aws'
          ? ['instance', 'rootVolume', 'securityGroup']
          : ['server', 'primaryIp', 'firewall'];
      return {
        schemaVersion: 1,
        kind: 'wharfie.live-deployment.cleanup',
        deploymentInstanceId: INSTANCE_ID,
        status,
        provider: options.provider,
        reason: status === 'unknown' ? 'provider-read-failed' : null,
        resources: roles.map((role) => ({ role, id: '123', status })),
        inventory: roles.map((role) => ({
          role,
          status,
          count: status === 'absent' ? 0 : 1,
        })),
      };
    },
    /** @param {string} executable @param {Record<string, any>} record */
    verifyExecutable: async (executable, record) => {
      expect(lockHeld).toBe(true);
      events.push('verify-executable');
      const next = path.basename(executable) === 'app-next';
      expect(readFileSync(executable, 'utf8')).toBe(next ? 'next' : 'test');
      expect(record).toEqual(next ? NEXT_ARTIFACT_RECORD : ARTIFACT_RECORD);
    },
    /** @param {Record<string, any>} value */
    validatePreview: (value) => value,
    /** @param {Record<string, any>} value */
    validateStatus: (value) => value,
    ...(settings.soakPorts ?? {}),
    wait: async () => {
      events.push('wait');
    },
    /** @param {Record<string, any>} event */
    log: (event) => {
      if (
        event.phase === 'prepare-removal' &&
        settings.revertArtifactReceiptAtRemoval
      ) {
        const runFile = path.join(runDir, 'run.json');
        const state = JSON.parse(readFileSync(runFile, 'utf8'));
        writeFileSync(
          runFile,
          JSON.stringify({ ...state, artifactRecord: null }),
        );
      }
      if (
        event.phase === 'remove-workspace' &&
        settings.interruptRemoval !== undefined
      ) {
        const retirement = JSON.parse(
          readFileSync(path.join(runDir, 'retirement.json'), 'utf8'),
        );
        expect(retirement.cleanup.status).toBe('absent');
        rmSync(path.join(runDir, 'workspace', 'app'));
        if (settings.interruptRemoval === 'complete') {
          rmSync(path.join(runDir, 'workspace'), {
            recursive: true,
            force: true,
          });
        }
        throw new Error('Interrupted workspace removal.');
      }
    },
  };
  return {
    runDir,
    workspace: path.join(runDir, 'workspace'),
    settings,
    options,
    ports,
    commands,
    events,
    lockIds,
    releasedWorkspaceExists,
    buildCount: () => buildCount,
    run: () => runLiveDeploymentAcceptance(options, ports),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('live acceptance argument boundary', () => {
  test.each([
    ['hetzner', '--location', 'fsn1'],
    ['aws', '--region', 'us-east-2'],
  ])(
    'accepts explicit %s placement and one SSH address',
    (provider, flag, placement) => {
      expect(
        parseLiveDeploymentArguments([
          '--provider',
          provider,
          flag,
          placement,
          '--allow-ssh-from',
          '203.0.113.42/32',
        ]),
      ).toEqual({ provider, placement, allowedIpv4: '203.0.113.42/32' });
    },
  );

  test.each([
    [],
    ['--provider'],
    ['--token', SECRET],
    ['--provider', 'hetzner', '--provider', 'aws'],
    ['--provider', 'unknown'],
    ['--provider', 'aws', '--location', 'fsn1'],
    ['--provider', 'hetzner', '--location', 'fsn1', '--region', 'us-east-2'],
    ['--provider', 'hetzner', '--location', 'fsn1'],
    [
      '--provider',
      'hetzner',
      '--location',
      'fsn1',
      '--allow-ssh-from',
      '0.0.0.0/0',
    ],
    [
      '--provider',
      'hetzner',
      '--location',
      'fsn1',
      '--allow-ssh-from',
      '203.0.113.42/24',
    ],
    [
      '--provider',
      'hetzner',
      '--location',
      'fsn1',
      '--allow-ssh-from',
      '203.0.113.042/32',
    ],
    ['--cleanup', '/tmp/a-run', '--provider', 'aws'],
  ])('rejects malformed or ambiguous arguments %j', (...args) => {
    expect(() => parseLiveDeploymentArguments(args)).toThrow();
  });

  test('accepts cleanup independently of deployment selectors', () => {
    expect(parseLiveDeploymentArguments(['--cleanup', './a-run'])).toEqual({
      cleanup: path.resolve('./a-run'),
    });
    expect(parseLiveDeploymentArguments(['--help'])).toEqual({ help: true });
  });
});

describe('live acceptance orchestration without cloud calls', () => {
  test('busy run lock rejects before creating a workspace or invoking acceptance effects', async () => {
    const setup = fixture({ lockBusy: true });
    await expect(setup.run()).rejects.toThrow('Acceptance lock busy.');
    expect(setup.buildCount()).toBe(0);
    expect(setup.commands).toEqual([]);
    expect(setup.events).toEqual(['acquire-lock']);
    expect(setup.releasedWorkspaceExists).toEqual([]);
    expect(existsSync(setup.runDir)).toBe(false);
  });

  test.each([
    [undefined, false],
    ['apply', false],
    ['destroy', true],
  ])(
    'holds the run lock until workspace cleanup settles with failure phase %s',
    async (failAt, retained) => {
      const setup = fixture({ failAt });
      const report = await setup.run();
      expect(report.workspaceRemoved).toBe(!retained);
      expect(setup.releasedWorkspaceExists).toEqual([retained]);
      expect(setup.events[0]).toBe('acquire-lock');
      expect(setup.events.at(-1)).toBe('release-lock');
      expect(
        setup.events.filter((event) => event === 'release-lock'),
      ).toHaveLength(1);
    },
  );

  test('a concurrent cleanup cannot read or remove the active run workspace', async () => {
    /** @type {() => void} */
    let continueBuild = () => {};
    /** @type {() => void} */
    let markBuildStarted = () => {};
    const started = new Promise((resolve) => {
      markBuildStarted = () => resolve(undefined);
    });
    const buildGate = new Promise((resolve) => {
      continueBuild = () => resolve(undefined);
    });
    const setup = fixture({ buildGate, onBuild: markBuildStarted });
    const running = setup.run();
    await started;
    const before = [...setup.events];
    try {
      await expect(
        runLiveDeploymentAcceptance({ cleanup: setup.runDir }, setup.ports),
      ).rejects.toThrow('Acceptance lock busy.');
      expect(setup.events).toEqual([...before, 'acquire-lock']);
      expect(setup.lockIds).toHaveLength(2);
      expect(setup.lockIds[1]).toBe(setup.lockIds[0]);
      expect(existsSync(setup.workspace)).toBe(true);
      expect(setup.commands).toEqual([]);
    } finally {
      continueBuild();
      await running;
    }
    expect(setup.releasedWorkspaceExists).toEqual([false]);
  });

  test('uses the packaged commands and same authority across fresh invocations, then independently verifies destruction', async () => {
    const setup = fixture();
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'passed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(setup.commands.map((call) => call.phase)).toEqual([
      'local-cli',
      'local-cli-next',
      'preview',
      'preview-next',
      'apply',
      'status',
      'fresh-controller',
      'update-next',
      'restore-primary',
      'destroy',
    ]);
    expect(new Set(setup.commands).size).toBe(setup.commands.length);
    const first = setup.commands.find((call) => call.phase === 'apply');
    const second = setup.commands.find(
      (call) => call.phase === 'fresh-controller',
    );
    expect(second?.args).toEqual(first?.args);
    for (const call of setup.commands) {
      const next = ['local-cli-next', 'preview-next', 'update-next'].includes(
        call.phase,
      );
      expect(call.file).toBe(
        path.join(setup.workspace, next ? 'app-next' : 'app'),
      );
      expect(call.cwd).toBe(setup.workspace);
    }
    expect(
      setup.events.filter((event) =>
        [
          'updates-prepared',
          'durability',
          'update-while-waiting',
          'durability-completed',
          'release-updates',
          'update-next',
          'restore-primary',
          'destroy',
          'audit',
        ].includes(event),
      ),
    ).toEqual([
      'updates-prepared',
      'durability',
      'update-while-waiting',
      'durability-completed',
      'release-updates',
      'update-next',
      'restore-primary',
      'destroy',
      'audit',
    ]);
    expect(setup.events.indexOf('audit')).toBeGreaterThan(
      setup.events.indexOf('destroy'),
    );
    expect(existsSync(setup.workspace)).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(setup.runDir, 'report.json'), 'utf8'))
        .status,
    ).toBe('passed');
    expect(statSync(setup.runDir).mode & 0o077).toBe(0);
    expect(statSync(path.join(setup.runDir, 'report.json')).mode & 0o077).toBe(
      0,
    );
  });

  test.each(['package', 'preview', 'preview-next'])(
    'a %s failure creates no cloud mutation and removes the workspace',
    async (failAt) => {
      const setup = fixture({ failAt });
      const report = await setup.run();
      expect(report).toMatchObject({
        status: 'failed',
        failure: { phase: failAt },
        cleanup: { status: 'not-created' },
        workspaceRemoved: true,
      });
      expect(
        setup.commands.some((call) =>
          ['apply', 'destroy'].includes(call.phase),
        ),
      ).toBe(false);
      expect(setup.events).not.toContain('audit');
      expect(existsSync(setup.workspace)).toBe(false);
    },
  );

  test('a lost apply response still destroys through the retained journal and audits resources', async () => {
    const setup = fixture({ failAt: 'apply' });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'apply' },
      cleanup: { status: 'absent' },
      workspaceRemoved: true,
    });
    expect(setup.commands.map((call) => call.phase)).toEqual([
      'local-cli',
      'local-cli-next',
      'preview',
      'preview-next',
      'apply',
      'destroy',
    ]);
    expect(setup.events).toContain('audit');
  });

  test('a failed durable recovery still destroys and independently verifies cleanup', async () => {
    const setup = fixture({ failAt: 'durability' });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'durability' },
      cleanup: { status: 'absent' },
      workspaceRemoved: true,
    });
    expect(setup.events.indexOf('destroy')).toBeGreaterThan(
      setup.events.indexOf('durability'),
    );
    expect(setup.events.indexOf('audit')).toBeGreaterThan(
      setup.events.indexOf('destroy'),
    );
  });

  test('a failed release proof after B update still destroys through A and independently verifies cleanup', async () => {
    const setup = fixture({ failAt: 'release-updates' });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'release-updates' },
      cleanup: { status: 'absent' },
      workspaceRemoved: true,
    });
    expect(setup.commands.slice(-2).map((call) => call.phase)).toEqual([
      'update-next',
      'destroy',
    ]);
    expect(setup.commands.at(-2)?.file).toBe(
      path.join(setup.workspace, 'app-next'),
    );
    expect(setup.commands.at(-1)?.file).toBe(path.join(setup.workspace, 'app'));
    expect(setup.events.indexOf('update-next')).toBeGreaterThan(
      setup.events.indexOf('durability-completed'),
    );
    expect(setup.events.indexOf('audit')).toBeGreaterThan(
      setup.events.indexOf('destroy'),
    );
    expect(existsSync(setup.workspace)).toBe(false);
    expect(
      JSON.parse(
        readFileSync(path.join(setup.runDir, 'retirement.json'), 'utf8'),
      ),
    ).toMatchObject({ cleanup: { status: 'absent' } });
  });

  test('an attempted apply with no recoverable journal preserves cleanup authority', async () => {
    const setup = fixture({ missingJournal: true });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      workspaceRemoved: false,
      cleanup: { status: 'unknown', failure: { phase: 'cleanup' } },
    });
    expect(existsSync(path.join(setup.workspace, 'app'))).toBe(true);
    expect(setup.commands.some((call) => call.phase === 'destroy')).toBe(false);
    expect(setup.events).not.toContain('audit');
    expect(
      JSON.parse(readFileSync(path.join(setup.runDir, 'run.json'), 'utf8'))
        .applyAttempted,
    ).toBe(true);
  });

  test('a failed destroy preserves the executable and controller journal', async () => {
    const setup = fixture({ failAt: 'destroy' });
    const report = await setup.run();
    expect(report).toMatchObject({ status: 'failed', workspaceRemoved: false });
    expect(
      readFileSync(
        path.join(setup.workspace, 'controller/retained-authority'),
        'utf8',
      ),
    ).toBe('keep-me');
    expect(existsSync(path.join(setup.workspace, 'app'))).toBe(true);
    expect(setup.events).not.toContain('audit');
  });

  test('unknown provider cleanup evidence preserves the workspace despite successful destroy', async () => {
    const setup = fixture({ auditStatuses: ['unknown'] });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      workspaceRemoved: false,
      cleanup: { status: 'unknown' },
    });
    expect(setup.commands.some((call) => call.phase === 'destroy')).toBe(true);
    expect(existsSync(setup.workspace)).toBe(true);
    expect(existsSync(path.join(setup.runDir, 'retirement.json'))).toBe(false);
  });

  test('eventually absent provider inventory is checked again before removing the workspace', async () => {
    const setup = fixture({ auditStatuses: ['present', 'absent'] });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'passed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(
      setup.events.filter((event) => ['audit', 'wait'].includes(event)),
    ).toEqual(['audit', 'wait', 'audit']);
  });

  test.each(['changedHost', 'changedJournal'])(
    'fresh-controller %s mismatch fails acceptance but still destroys resources',
    async (changed) => {
      const setup = fixture({ [changed]: true });
      const report = await setup.run();
      expect(report).toMatchObject({
        status: 'failed',
        failure: { phase: 'fresh-controller' },
        cleanup: { status: 'absent' },
        workspaceRemoved: true,
      });
      expect(setup.commands.some((call) => call.phase === 'destroy')).toBe(
        true,
      );
    },
  );

  test('cancellation stops acceptance while cleanup receives no aborted signal', async () => {
    const controller = new AbortController();
    const setup = fixture({
      failAt: 'apply',
      abortController: controller,
      options: { signal: controller.signal },
    });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'apply', aborted: true },
      cleanup: { status: 'absent' },
      workspaceRemoved: true,
    });
    expect(controller.signal.aborted).toBe(true);
    expect(setup.commands.find((call) => call.phase === 'apply')?.signal).toBe(
      controller.signal,
    );
    expect(
      setup.commands.find((call) => call.phase === 'destroy')?.signal,
    ).toBeUndefined();
  });

  test('cleanup-only resumes retained authority without packaging or applying and is repeatable after success', async () => {
    const setup = fixture({ failAt: 'destroy' });
    expect((await setup.run()).workspaceRemoved).toBe(false);
    setup.settings.failAt = undefined;
    const previousCommands = setup.commands.length;
    const cleaned = await runLiveDeploymentAcceptance(
      { cleanup: setup.runDir },
      setup.ports,
    );
    expect(cleaned).toMatchObject({
      mode: 'cleanup',
      status: 'passed',
      workspaceRemoved: true,
    });
    expect(
      setup.commands.slice(previousCommands).map((call) => call.phase),
    ).toEqual(['destroy']);
    expect(setup.buildCount()).toBe(1);
    expect(existsSync(setup.workspace)).toBe(false);
    const afterCleanup = setup.commands.length;
    const repeated = await runLiveDeploymentAcceptance(
      { cleanup: setup.runDir },
      setup.ports,
    );
    expect(repeated).toMatchObject({
      status: 'passed',
      workspaceRemoved: true,
    });
    expect(setup.commands).toHaveLength(afterCleanup);
    expect(setup.lockIds).toHaveLength(3);
    expect(new Set(setup.lockIds).size).toBe(1);
    expect(setup.releasedWorkspaceExists).toEqual([true, false, false]);
  });

  test('cleanup aliases acquire the same lock for the canonical run directory', async () => {
    const setup = fixture({ failAt: 'destroy' });
    await setup.run();
    setup.settings.failAt = undefined;
    const alias = path.join(path.dirname(setup.runDir), 'cleanup-alias');
    symlinkSync(setup.runDir, alias, 'dir');
    const report = await runLiveDeploymentAcceptance(
      { cleanup: alias },
      setup.ports,
    );
    expect(report).toMatchObject({ status: 'passed', workspaceRemoved: true });
    expect(setup.lockIds).toHaveLength(2);
    expect(setup.lockIds[1]).toBe(setup.lockIds[0]);
  });

  test.each([
    ['partial', 'missing'],
    ['partial', 'stale'],
    ['complete', 'missing'],
    ['complete', 'stale'],
  ])(
    'cleanup resumes %s workspace removal with a %s final report using durable retirement evidence',
    async (interruptRemoval, reportState) => {
      const setup = fixture({ interruptRemoval, failAt: 'apply' });
      const initial = await setup.run();
      expect(initial).toMatchObject({
        mode: 'acceptance',
        status: 'failed',
        failure: { phase: 'apply' },
        workspaceRemoved: false,
      });
      expect(existsSync(path.join(setup.workspace, 'app'))).toBe(false);
      expect(existsSync(setup.workspace)).toBe(interruptRemoval === 'partial');
      const reportFile = path.join(setup.runDir, 'report.json');
      const originalReport = readFileSync(reportFile, 'utf8');
      if (reportState === 'missing') rmSync(reportFile);
      setup.settings.interruptRemoval = undefined;
      const commands = setup.commands.length;
      const events = setup.events.length;
      const cleaned = await runLiveDeploymentAcceptance(
        { cleanup: setup.runDir },
        setup.ports,
      );
      expect(cleaned).toMatchObject({
        mode: 'cleanup',
        status: 'passed',
        cleanup: { status: 'absent' },
        workspaceRemoved: true,
      });
      expect(setup.commands).toHaveLength(commands);
      expect(setup.events.slice(events)).toEqual([
        'acquire-lock',
        'release-lock',
      ]);
      expect(existsSync(setup.workspace)).toBe(false);
      if (reportState === 'missing') expect(existsSync(reportFile)).toBe(false);
      else expect(readFileSync(reportFile, 'utf8')).toBe(originalReport);
      expect(
        JSON.parse(
          readFileSync(path.join(setup.runDir, 'cleanup-report.json'), 'utf8'),
        ),
      ).toMatchObject({ mode: 'cleanup', status: 'passed' });
    },
  );

  test.each(['binding', 'unknown', 'inventory', 'identity'])(
    'cleanup rejects mismatched or unconfirmed retirement evidence: %s',
    async (change) => {
      const setup = fixture({ interruptRemoval: 'partial' });
      await setup.run();
      setup.settings.interruptRemoval = undefined;
      const retirementFile = path.join(setup.runDir, 'retirement.json');
      const retirement = JSON.parse(readFileSync(retirementFile, 'utf8'));
      if (change === 'binding') retirement.binding.runId = 'another-run';
      if (change === 'unknown') retirement.cleanup.status = 'unknown';
      if (change === 'inventory') retirement.cleanup.inventory[0].count = 1;
      if (change === 'identity')
        retirement.cleanup.deploymentInstanceId = 'another-deployment';
      writeFileSync(retirementFile, JSON.stringify(retirement));
      const commands = setup.commands.length;
      await expect(
        runLiveDeploymentAcceptance({ cleanup: setup.runDir }, setup.ports),
      ).rejects.toThrow();
      expect(setup.commands).toHaveLength(commands);
      expect(existsSync(setup.workspace)).toBe(true);
    },
  );

  test('cleanup retirement binds the entire run state while allowing harmless JSON reformatting and key order', async () => {
    const setup = fixture({ interruptRemoval: 'partial' });
    await setup.run();
    setup.settings.interruptRemoval = undefined;
    const runFile = path.join(setup.runDir, 'run.json');
    const state = JSON.parse(readFileSync(runFile, 'utf8'));
    writeFileSync(
      runFile,
      JSON.stringify({ ...state, allowedIpv4: '203.0.113.43/32' }),
    );
    await expect(
      runLiveDeploymentAcceptance({ cleanup: setup.runDir }, setup.ports),
    ).rejects.toThrow();
    expect(existsSync(setup.workspace)).toBe(true);
    writeFileSync(
      runFile,
      JSON.stringify(Object.fromEntries(Object.entries(state).reverse())),
    );
    const cleaned = await runLiveDeploymentAcceptance(
      { cleanup: setup.runDir },
      setup.ports,
    );
    expect(cleaned).toMatchObject({ status: 'passed', workspaceRemoved: true });
  });

  test('retirement preserves a workspace when an earlier run-state publication left stale artifact authority', async () => {
    const setup = fixture({
      failAt: 'preview',
      revertArtifactReceiptAtRemoval: true,
    });
    const report = await setup.run();
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'preview' },
      cleanup: {
        status: 'not-created',
        failure: { phase: 'prepare-removal' },
      },
      workspaceRemoved: false,
    });
    expect(existsSync(setup.workspace)).toBe(true);
    expect(existsSync(path.join(setup.runDir, 'retirement.json'))).toBe(false);
    setup.settings.revertArtifactReceiptAtRemoval = false;
    const commands = setup.commands.length;
    const cleaned = await runLiveDeploymentAcceptance(
      { cleanup: setup.runDir },
      setup.ports,
    );
    expect(cleaned).toMatchObject({
      mode: 'cleanup',
      status: 'passed',
      cleanup: { status: 'not-created' },
      workspaceRemoved: true,
    });
    expect(setup.commands).toHaveLength(commands);
  });

  test('retirement cannot authorize removal through a dangling workspace symlink', async () => {
    const setup = fixture({ interruptRemoval: 'complete' });
    await setup.run();
    setup.settings.interruptRemoval = undefined;
    const target = path.join(path.dirname(setup.runDir), 'missing-target');
    symlinkSync(target, setup.workspace, 'dir');
    const commands = setup.commands.length;
    await expect(
      runLiveDeploymentAcceptance({ cleanup: setup.runDir }, setup.ports),
    ).rejects.toThrow('Expected a real private directory.');
    expect(setup.commands).toHaveLength(commands);
    expect(readdirSync(setup.runDir)).toContain('workspace');
  });

  test('ordinary local application arguments receive no cloud credentials', async () => {
    jest.replaceProperty(process, 'env', {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      HCLOUD_TOKEN: SECRET,
      AWS_ACCESS_KEY_ID: SECRET,
      UNRELATED_SECRET: SECRET,
    });
    const setup = fixture();
    await setup.run();
    const local = setup.commands.find((call) => call.phase === 'local-cli');
    const next = setup.commands.find((call) => call.phase === 'local-cli-next');
    const preview = setup.commands.find((call) => call.phase === 'preview');
    expect(JSON.stringify(local?.env)).not.toContain(SECRET);
    expect(JSON.stringify(next?.env)).not.toContain(SECRET);
    expect(preview?.env.HCLOUD_TOKEN).toBe(SECRET);
    expect(preview?.env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(preview?.env.UNRELATED_SECRET).toBeUndefined();
  });

  test('failure reports retain bounded metadata without raw output, error text, or credentials', async () => {
    const setup = fixture({ failAt: 'apply' });
    const report = await setup.run();
    expect(report.failure).toMatchObject({
      phase: 'apply',
      command: 'packaged-app',
      status: 1,
      signal: null,
    });
    for (const name of readdirSync(setup.runDir)) {
      const file = path.join(setup.runDir, name);
      expect(statSync(file).size).toBeLessThanOrEqual(256 * 1024);
      expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    }
    expect(
      liveDeploymentFailureDiagnostic(
        'apply',
        1.9,
        commandFailure({
          signal: SECRET,
          command: SECRET,
          status: '1',
        }),
      ),
    ).toMatchObject({
      durationMs: 2,
      command: 'packaged-app',
      status: null,
      signal: null,
    });
  });

  test('retains an interruption boundary only when it is a fixed diagnostic stage', () => {
    const safe = liveDeploymentFailureDiagnostic(
      'restore-update-interrupted',
      10,
      commandFailure({
        faultStage: 'verify-paused-journal',
        faultCode: 'assertion-failed',
      }),
    );
    expect(safe.faultStage).toBe('verify-paused-journal');
    expect(safe.faultCode).toBe('assertion-failed');
    expect(JSON.stringify(safe)).not.toContain(SECRET);
    for (const faultStage of [
      SECRET,
      'verify-paused-journal ' + SECRET,
      null,
      {},
    ]) {
      const unsafe = liveDeploymentFailureDiagnostic(
        'restore-update-interrupted',
        10,
        commandFailure({ faultStage, faultCode: faultStage }),
      );
      expect(unsafe).not.toHaveProperty('faultStage');
      expect(unsafe).not.toHaveProperty('faultCode');
      expect(JSON.stringify(unsafe)).not.toContain(SECRET);
    }
  });
});

describe('controller credential selection', () => {
  test('selects only the chosen ambient provider authority and host execution variables', () => {
    const environment = {
      PATH: '/bin',
      HOME: '/tmp/controller-home',
      AWS_PROFILE: 'acceptance',
      AWS_REGION: 'us-east-2',
      HCLOUD_TOKEN: SECRET,
      HETZNER_TOKEN: SECRET,
      UNRELATED_SECRET: SECRET,
    };
    expect(liveDeploymentControllerEnvironment('aws', environment)).toEqual({
      PATH: '/bin',
      HOME: '/tmp/controller-home',
      AWS_PROFILE: 'acceptance',
      AWS_REGION: 'us-east-2',
    });
    expect(liveDeploymentControllerEnvironment('hetzner', environment)).toEqual(
      {
        PATH: '/bin',
        HOME: '/tmp/controller-home',
        HCLOUD_TOKEN: SECRET,
      },
    );
  });
});

describe('resumable bounded soak orchestration', () => {
  /** @param {Record<string, any>} [changes] */
  function soakFixture(changes = {}) {
    let complete = false;
    const ticks = /** @type {Record<string, any>[]} */ ([]);
    const setup = fixture({
      options: { soakHours: 0.25, step: true },
      soakPorts: {
        wallNow: () => 1800000000000,
        createSoak: (
          /** @type {Record<string, any>} */ { startedAt, durationMs },
        ) => ({
          startedAt,
          endAt: startedAt + durationMs,
          sequence: 0,
          intervalMs: 240000,
          timerDelayMs: 1000,
        }),
        validateSoak: (/** @type {Record<string, any>} */ checkpoint) => {
          expect(checkpoint.sequence).toBeGreaterThanOrEqual(0);
        },
        soak: async (/** @type {Record<string, any>} */ request) => {
          ticks.push(structuredClone(request.checkpoint));
          if (changes.failSoak) throw commandFailure();
          const checkpoint = {
            ...request.checkpoint,
            sequence: request.checkpoint.sequence + 1,
          };
          request.saveCheckpoint(checkpoint);
          changes.abortAfterTick?.abort();
          return {
            checkpoint,
            complete,
            nextAt: checkpoint.startedAt + 240000,
          };
        },
      },
      ...changes,
    });
    return {
      ...setup,
      ticks,
      complete: () => {
        complete = true;
      },
    };
  }

  test('step retains exact authority, resume skips provisioning, final completion destroys and audits', async () => {
    const setup = soakFixture();
    expect(await setup.run()).toMatchObject({
      mode: 'soak',
      status: 'running',
      workspaceRemoved: false,
    });
    const state = JSON.parse(
      readFileSync(path.join(setup.runDir, 'run.json'), 'utf8'),
    );
    expect(state.soak).toEqual({
      durationMs: 900000,
      intervalMs: 240000,
      startedAt: 1800000000000,
      provisionAttemptAt: 1800000000000,
    });
    expect(setup.events).not.toContain('durability');
    expect(setup.events).not.toContain('updates-prepared');
    expect(
      setup.commands.filter((call) => call.phase === 'destroy'),
    ).toHaveLength(0);
    const before = setup.commands.length;
    setup.complete();
    expect(
      await runLiveDeploymentAcceptance({ resume: setup.runDir }, setup.ports),
    ).toMatchObject({
      mode: 'soak',
      status: 'passed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(setup.buildCount()).toBe(1);
    expect(setup.commands.slice(before).map((call) => call.phase)).toEqual([
      'destroy',
    ]);
    expect(setup.ticks.map((tick) => tick.sequence)).toEqual([0, 1]);
    expect(setup.ticks[1].startedAt).toBe(setup.ticks[0].startedAt);
    expect(setup.releasedWorkspaceExists).toEqual([true, false]);
    expect(setup.lockIds[0]).toBe(setup.lockIds[1]);
  });

  test('cancellation during checkpoint save destroys instead of returning a retained host', async () => {
    const abortAfterTick = new AbortController();
    const setup = soakFixture({ abortAfterTick });
    const result = await runLiveDeploymentAcceptance(
      { ...setup.options, signal: abortAfterTick.signal },
      setup.ports,
    );
    expect(result).toMatchObject({
      status: 'failed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(setup.events).toContain('audit');
  });

  test('a failed pending progress report cannot skip host cleanup', async () => {
    const setup = soakFixture();
    const log = setup.ports.log;
    setup.ports.log = (/** @type {Record<string, any>} */ event) => {
      if (event.status === 'running') throw commandFailure();
      log(event);
    };
    expect(await setup.run()).toMatchObject({
      status: 'failed',
      workspaceRemoved: true,
      failure: { phase: 'soak-checkpoint-report' },
      cleanup: { status: 'absent' },
    });
    expect(setup.events).toContain('audit');
  });

  test('a missing checkpoint after initialized authority still cleans up', async () => {
    const setup = soakFixture();
    await setup.run();
    rmSync(path.join(setup.runDir, 'soak.json'));
    expect(
      await runLiveDeploymentAcceptance({ resume: setup.runDir }, setup.ports),
    ).toMatchObject({
      status: 'failed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(setup.ticks).toHaveLength(1);
  });

  test.each(['intervalMs', 'timerDelayMs'])(
    'a changed %s cannot weaken the resumed methodology',
    async (field) => {
      const setup = soakFixture();
      await setup.run();
      const file = path.join(setup.runDir, 'soak.json');
      const checkpoint = JSON.parse(readFileSync(file, 'utf8'));
      checkpoint[field]++;
      writeFileSync(file, JSON.stringify(checkpoint));
      expect(
        await runLiveDeploymentAcceptance(
          { resume: setup.runDir },
          setup.ports,
        ),
      ).toMatchObject({
        status: 'failed',
        workspaceRemoved: true,
        failure: { phase: 'soak-authority' },
      });
      expect(setup.ticks).toHaveLength(1);
    },
  );

  test('an older rehearsal refuses new observations but retains cleanup authority', async () => {
    const setup = soakFixture();
    await setup.run();
    for (const name of ['run.json', 'soak.json']) {
      const file = path.join(setup.runDir, name);
      const retained = JSON.parse(readFileSync(file, 'utf8'));
      (name === 'run.json' ? retained.soak : retained).intervalMs = 120000;
      writeFileSync(file, JSON.stringify(retained));
    }
    await expect(
      runLiveDeploymentAcceptance({ resume: setup.runDir }, setup.ports),
    ).rejects.toThrow();
    expect(setup.ticks).toHaveLength(1);
    expect(existsSync(path.join(setup.runDir, 'workspace'))).toBe(true);
    expect(
      await runLiveDeploymentAcceptance({ cleanup: setup.runDir }, setup.ports),
    ).toMatchObject({
      status: 'passed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(setup.ticks).toHaveLength(1);
    expect(setup.buildCount()).toBe(1);
  });

  test('a failure retains diagnostic and still independently cleans the host', async () => {
    const setup = soakFixture({ failSoak: true });
    expect(await setup.run()).toMatchObject({
      status: 'failed',
      workspaceRemoved: true,
      cleanup: { status: 'absent' },
    });
    expect(existsSync(path.join(setup.runDir, 'failure.json'))).toBe(true);
    const failure = readFileSync(
      path.join(setup.runDir, 'failure.json'),
      'utf8',
    );
    expect(failure).not.toContain(SECRET);
    expect(setup.events).toContain('audit');
  });

  test('a changed deadline fails before another tick and triggers owned cleanup', async () => {
    const setup = soakFixture();
    await setup.run();
    const checkpointFile = path.join(setup.runDir, 'soak.json');
    const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8'));
    checkpoint.endAt++;
    writeFileSync(checkpointFile, JSON.stringify(checkpoint));
    const report = await runLiveDeploymentAcceptance(
      { resume: setup.runDir },
      setup.ports,
    );
    expect(report).toMatchObject({
      status: 'failed',
      workspaceRemoved: true,
      failure: { phase: 'soak-authority' },
    });
    expect(setup.ticks).toHaveLength(1);
  });

  test('explicit cleanup after a step skips the workload and retires the workspace', async () => {
    const setup = soakFixture();
    await setup.run();
    expect(
      await runLiveDeploymentAcceptance({ cleanup: setup.runDir }, setup.ports),
    ).toMatchObject({
      status: 'passed',
      mode: 'cleanup',
      workspaceRemoved: true,
    });
    expect(setup.ticks).toHaveLength(1);
  });

  test('resume refuses a recorded failure and preserves cleanup authority', async () => {
    const setup = soakFixture();
    await setup.run();
    writeFileSync(path.join(setup.runDir, 'failure.json'), '{}');
    await expect(
      runLiveDeploymentAcceptance({ resume: setup.runDir }, setup.ports),
    ).rejects.toThrow('failed soak');
    expect(existsSync(setup.workspace)).toBe(true);
    expect(setup.ticks).toHaveLength(1);
  });

  test.each(['NaN', '0', '-1', '96', '72.0', '0.5'])(
    'rejects invalid duration %s before creating resources',
    (hours) => {
      expect(() =>
        parseLiveDeploymentArguments([
          '--provider',
          'hetzner',
          '--location',
          'fsn1',
          '--allow-ssh-from',
          '203.0.113.42/32',
          '--soak-hours',
          hours,
        ]),
      ).toThrow();
    },
  );

  test.each([
    ['--resume', './run', '--provider', 'aws'],
    ['--cleanup', './run', '--step'],
    ['--resume', './run', '--soak-hours', '72'],
    ['--resume', './run', '--step', '--step'],
  ])('refuses selectors conflicting with retained authority %j', (...args) => {
    expect(() => parseLiveDeploymentArguments(args)).toThrow();
  });

  test('accepts explicit resume-step and pinned release assets', () => {
    expect(
      parseLiveDeploymentArguments(['--resume', './run', '--step']),
    ).toEqual({ resume: path.resolve('./run'), step: true });
    expect(
      parseLiveDeploymentArguments([
        '--provider',
        'aws',
        '--region',
        'us-east-2',
        '--allow-ssh-from',
        '203.0.113.42/32',
        '--soak-hours',
        '72',
        '--artifact-dir',
        '/tmp/assets',
        '--expected-commit',
        'a'.repeat(40),
      ]),
    ).toMatchObject({
      soakHours: 72,
      artifactDir: '/tmp/assets',
      expectedCommit: 'a'.repeat(40),
    });
  });
});

test.each(['artifact-upload-failed', 'service-convergence-failed'])(
  'activation diagnostics retain the fixed %s category without raw output',
  (activationFaultCode) => {
    const diagnostic = liveDeploymentFailureDiagnostic('apply', 662498, {
      diagnostic: {
        command: '/private/app',
        status: 1,
        activationFaultCode,
        stdout: SECRET,
        stderr: SECRET,
      },
    });
    expect(diagnostic).toMatchObject({
      phase: 'apply',
      command: 'packaged-app',
      status: 1,
      activationFaultCode,
      timedOut: false,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(SECRET);
    expect(
      liveDeploymentFailureDiagnostic('apply', 1, {
        diagnostic: { activationFaultCode: SECRET },
      }),
    ).not.toHaveProperty('activationFaultCode');
  },
);

test('soak diagnostics retain fixed categories while rejecting arbitrary host output', () => {
  const diagnostic = liveDeploymentFailureDiagnostic('soak-observation', 100, {
    diagnostic: {
      soakFaultStage: 'resources',
      soakFaultCode: 'assertion',
      hostFaultStage: 'observe-process',
      hostFaultCode: 'command-failed',
      stdout: SECRET,
      stderr: SECRET,
    },
  });
  expect(diagnostic).toMatchObject({
    soakFaultStage: 'resources',
    soakFaultCode: 'assertion',
    hostFaultStage: 'observe-process',
    hostFaultCode: 'command-failed',
  });
  const unsafe = liveDeploymentFailureDiagnostic('soak-observation', 100, {
    diagnostic: {
      soakFaultStage: SECRET,
      soakFaultCode: SECRET,
      hostFaultStage: SECRET,
      hostFaultCode: SECRET,
    },
  });
  expect(JSON.stringify([diagnostic, unsafe])).not.toContain(SECRET);
  expect(unsafe).not.toHaveProperty('soakFaultStage');
  expect(unsafe).not.toHaveProperty('hostFaultStage');
});

test('soak diagnostics retain only allowlisted bounded numeric measurements', () => {
  const measurements = {
    soakObservedMs: 300001,
    soakLimitMs: 300000,
    soakObservedBytes: 268435457,
    soakLimitBytes: 268435456,
  };
  expect(
    liveDeploymentFailureDiagnostic('soak-resources', 100, {
      diagnostic: { ...measurements, arbitraryMeasurement: 1 },
    }),
  ).toEqual(expect.objectContaining(measurements));
  for (const unsafe of [
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '300000',
    { value: SECRET },
  ]) {
    const diagnostic = liveDeploymentFailureDiagnostic('soak-resources', 100, {
      diagnostic: {
        ...Object.fromEntries(
          Object.keys(measurements).map((key) => [key, unsafe]),
        ),
        arbitraryMeasurement: 1,
        stdout: SECRET,
      },
    });
    for (const key of [...Object.keys(measurements), 'arbitraryMeasurement']) {
      expect(diagnostic).not.toHaveProperty(key);
    }
    expect(JSON.stringify(diagnostic)).not.toContain(SECRET);
  }
});

test('soak waits reject a backwards wall clock without extending the duration', async () => {
  let wall = 1800000000000;
  await expect(
    waitForLiveDeploymentSoakObservation(wall + 10000, {
      wallNow: () => wall,
      now: () => 0,
      wait: async () => {
        wall--;
      },
    }),
  ).rejects.toThrow('clock moved backwards');
});

test('soak waits terminate under a frozen wall clock using monotonic time', async () => {
  const wall = 1800000000000;
  let monotonic = 0;
  await expect(
    waitForLiveDeploymentSoakObservation(wall + 10000, {
      wallNow: () => wall,
      now: () => monotonic,
      wait: async () => {
        monotonic += 10000;
      },
    }),
  ).rejects.toThrow('monotonic deadline');
});
