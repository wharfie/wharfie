/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-description, jsdoc/require-returns-description -- These offline fixtures describe injected acceptance boundaries. */

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
      appId: 'hello-world',
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
      return {
        appId: 'hello-world',
        executable: path.join(request.workspace, 'app'),
        artifactRecord: ARTIFACT_RECORD,
        packageVersion: '0.0.15',
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
      if (request.phase === 'local-cli' || request.phase === 'remote-cli') {
        return output('Hello, Wharfie acceptance!\n');
      }
      if (request.phase === 'preview') {
        return output({
          schemaVersion: 1,
          kind: 'wharfie.single-node-deployment.preview',
          provider: options.provider,
          status: 'actionable',
          deployment: {
            appId: 'hello-world',
            deploymentId:
              request.args[request.args.indexOf('--deployment') + 1],
            deploymentInstanceId: INSTANCE_ID,
            desiredRevisionId: 'desired-revision',
            revisionId: ARTIFACT_RECORD.revisionId,
            artifact: ARTIFACT_RECORD,
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
          appId: 'hello-world',
          deploymentInstanceId: INSTANCE_ID,
        });
      }
      throw new Error(`Unexpected offline command phase: ${request.phase}`);
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
      expect(existsSync(request.dataRoot)).toBe(true);
      const statuses = settings.auditStatuses ?? ['absent'];
      const status = statuses[Math.min(auditIndex++, statuses.length - 1)];
      return { status, provider: options.provider };
    },
    /** @param {string} executable */
    verifyExecutable: async (executable) => {
      expect(lockHeld).toBe(true);
      events.push('verify-executable');
      expect(readFileSync(executable, 'utf8')).toBe('test');
    },
    /** @param {Record<string, any>} value */
    validatePreview: (value) => value,
    /** @param {Record<string, any>} value */
    validateStatus: (value) => value,
    wait: async () => {
      events.push('wait');
    },
    log: () => {},
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
      'preview',
      'apply',
      'status',
      'remote-cli',
      'fresh-controller',
      'destroy',
    ]);
    expect(new Set(setup.commands).size).toBe(setup.commands.length);
    const first = setup.commands.find((call) => call.phase === 'apply');
    const second = setup.commands.find(
      (call) => call.phase === 'fresh-controller',
    );
    expect(second?.args).toEqual(first?.args);
    for (const call of setup.commands) {
      expect(call.file).toBe(path.join(setup.workspace, 'app'));
      expect(call.cwd).toBe(setup.workspace);
    }
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

  test.each(['package', 'preview'])(
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
      'preview',
      'apply',
      'destroy',
    ]);
    expect(setup.events).toContain('audit');
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
    const preview = setup.commands.find((call) => call.phase === 'preview');
    expect(JSON.stringify(local?.env)).not.toContain(SECRET);
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
