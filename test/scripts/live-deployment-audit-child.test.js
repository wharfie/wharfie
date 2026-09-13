import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  auditLiveDeploymentCleanupInChild,
  createLiveDeploymentCleanupChildAuditor,
} from '../../scripts/live-deployment-audit-child.js';
import { runLiveDeploymentProcess } from '../../scripts/live-deployment-package.js';
import { REPO_ROOT } from '../../scripts/package-verification.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
} from '../runtime/fixtures/single-node-status-fixture.js';

/** @type {ReturnType<typeof createSingleNodeStatusActiveJournal>} */
let journal;
/** @type {string[]} */
const directories = [];
const DATA_ROOT = '/private/live-acceptance/controller';

beforeAll(async () => {
  journal = createSingleNodeStatusActiveJournal(
    await createSingleNodeStatusAuthorityFixture(),
  );
});

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function absentReport() {
  const roles = ['server', 'primaryIp', 'firewall'];
  return {
    schemaVersion: 1,
    kind: 'wharfie.live-deployment.cleanup',
    provider: 'hetzner',
    deploymentInstanceId: journal.deploymentInstanceId,
    status: 'absent',
    reason: null,
    resources: roles.map((role) => ({
      role,
      id: journal.resources.find(
        (/** @type {Record<string, any>} */ entry) => entry.role === role,
      )?.providerResourceId,
      status: 'absent',
    })),
    inventory: roles.map((role) => ({ role, count: 0, status: 'absent' })),
  };
}

/** @param {unknown} document */
function runnerReturning(document) {
  return jest.fn(async () => ({
    stdout: JSON.stringify(document),
    stderr: '',
    status: 0,
    signal: /** @type {null} */ (null),
    durationMs: 1,
  }));
}

describe('isolated live provider cleanup audit', () => {
  it('sends only bounded authority on stdin with a fixed command and explicit environment', async () => {
    const report = absentReport();
    /** @type {jest.Mock<typeof runLiveDeploymentProcess>} */
    const run = runnerReturning(report);
    const audit = createLiveDeploymentCleanupChildAuditor({ run });
    const env = { HCLOUD_TOKEN: 'private-token' };
    await expect(audit({ journal, dataRoot: DATA_ROOT, env })).resolves.toEqual(
      report,
    );
    const request = run.mock.calls[0][0];
    expect(request.file).toBe(process.execPath);
    expect(request.args).toEqual([
      path.join(REPO_ROOT, 'scripts/live-deployment-audit-child.js'),
      '--internal-provider-audit',
    ]);
    expect(request.env).toBe(env);
    expect(request.timeoutMs).toBe(120_000);
    expect(JSON.parse(request.stdin ?? '')).toEqual({
      journal,
      dataRoot: DATA_ROOT,
    });
    expect(request.stdin).not.toContain('private-token');
    expect(JSON.stringify(request.args)).not.toContain(
      journal.deploymentInstanceId,
    );
  });

  it.each([
    { kind: 'wrong-kind' },
    { provider: 'aws' },
    { deploymentInstanceId: 'another-deployment' },
    { reason: 'private provider message' },
    { secret: 'private provider message' },
    { status: 'unknown' },
    { inventory: [] },
  ])(
    'rejects mismatched or malformed child evidence without exposing its contents %#',
    async (change) => {
      const audit = createLiveDeploymentCleanupChildAuditor({
        run: runnerReturning({ ...absentReport(), ...change }),
      });
      const error = await audit({
        journal,
        dataRoot: DATA_ROOT,
        env: {},
      }).catch((failure) => failure);
      expect(error.message).toBe('Live deployment cleanup audit failed.');
      expect(JSON.stringify(error)).not.toContain('private provider message');
    },
  );

  it('rejects oversized input before spawning and oversized child output before accepting evidence', async () => {
    const run = runnerReturning({ secret: 'x'.repeat(256 * 1024) });
    const audit = createLiveDeploymentCleanupChildAuditor({ run });
    await expect(
      audit({ journal: null, dataRoot: DATA_ROOT, env: {} }),
    ).rejects.toThrow('Live deployment cleanup audit failed.');
    await expect(
      audit({ journal, dataRoot: `/${'x'.repeat(256 * 1024)}`, env: {} }),
    ).rejects.toThrow('Live deployment cleanup audit failed.');
    expect(run).not.toHaveBeenCalled();
    await expect(
      audit({ journal, dataRoot: DATA_ROOT, env: {} }),
    ).rejects.toThrow('Live deployment cleanup audit failed.');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs the actual audit child over stdin without credentials or cloud access', async () => {
    const report = await auditLiveDeploymentCleanupInChild({
      journal,
      dataRoot: DATA_ROOT,
      env: {},
    });
    expect(report).toMatchObject({
      provider: 'hetzner',
      deploymentInstanceId: journal.deploymentInstanceId,
      status: 'unknown',
      reason: 'credential-binding-failed',
    });
  });

  it('kills a stalled AWS authority opener and the credential descendant holding its pipes', async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'wharfie-audit-child-test-')),
    );
    directories.push(directory);
    const heartbeat = path.join(directory, 'credential-heartbeat');
    const authority = pathToFileURL(
      path.join(REPO_ROOT, 'src/core/runtime/providers/aws/authority.js'),
    ).href;
    const descendant = `const fs = require('node:fs'); let count = 0; setInterval(() => fs.writeFileSync(process.env.HEARTBEAT, String(++count)), 10);`;
    const fixture = `
      import { spawn } from 'node:child_process';
      import { createAwsSingleNodeReadAuthorityFactory } from ${JSON.stringify(authority)};
      spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio: 'inherit'});
      const open = createAwsSingleNodeReadAuthorityFactory({
        resolveCredentials: async () => await new Promise(() => {}),
        createStsClient: async () => {},
        createEc2Client: async () => {},
      });
      await open({region: 'us-east-2'});
    `;
    const audit = createLiveDeploymentCleanupChildAuditor({
      timeoutMs: 1500,
      run: async (options) =>
        await runLiveDeploymentProcess({
          ...options,
          args: ['--input-type=module', '-e', fixture],
        }),
    });
    const error = await audit({
      journal,
      dataRoot: DATA_ROOT,
      env: { HEARTBEAT: heartbeat },
    }).catch((failure) => failure);
    expect(error.diagnostic).toMatchObject({
      timedOut: true,
      signal: 'SIGKILL',
      phase: 'cleanup-audit',
    });
    const stopped = await readFile(heartbeat, 'utf8');
    expect(Number(stopped)).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(await readFile(heartbeat, 'utf8')).toBe(stopped);
  });
});
