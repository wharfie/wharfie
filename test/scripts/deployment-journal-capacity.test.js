import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
  parseDeploymentJournalCapacityArguments,
  superviseDeploymentJournalCapacity,
  verifyDeploymentJournalCapacity,
} from '../../scripts/verify-deployment-journal-capacity.js';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import { createSingleNodeDeploymentUpdateCoordinator } from '../../src/core/runtime/single-node-deployment-update.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from '../runtime/fixtures/single-node-status-fixture.js';

/** @type {string[]} */
const roots = [];

/** Keep every test's report and temporary workspace in one owned directory. */
function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-capacity-test-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('deployment journal capacity acceptance driver', () => {
  it('accepts the default local proof, help, and one explicit new report destination', () => {
    expect(parseDeploymentJournalCapacityArguments([])).toEqual({});
    expect(parseDeploymentJournalCapacityArguments(['--help'])).toEqual({
      help: true,
    });
    expect(
      parseDeploymentJournalCapacityArguments(['--report', 'capacity.json']),
    ).toEqual({ reportPath: path.resolve('capacity.json') });
  });

  it.each([
    ['--provider', 'aws'],
    ['--report'],
    ['--report', 'a', '--report', 'b'],
    ['--report', '--help'],
    ['--help', '--report', 'a'],
    ['--report', ''],
    ['--report', 'invalid\nfile'],
    ['--report', 'invalid\0file'],
  ])('rejects ambiguous or unsupported arguments %j', (...args) => {
    expect(() => parseDeploymentJournalCapacityArguments(args)).toThrow();
  });

  it('refuses to overwrite an existing report before making a workspace', async () => {
    const root = temporaryRoot();
    const reportPath = path.join(root, 'existing.json');
    writeFileSync(reportPath, 'keep this exact report');
    await expect(
      verifyDeploymentJournalCapacity({ reportPath, temporaryParent: root }),
    ).rejects.toThrow('new file');
    expect(readFileSync(reportPath, 'utf8')).toBe('keep this exact report');
    expect(readdirSync(root)).toEqual(['existing.json']);
  });

  it('refuses a report symlink without writing through it', async () => {
    const root = temporaryRoot();
    const target = path.join(root, 'target.json');
    const reportPath = path.join(root, 'link.json');
    writeFileSync(target, 'preserve');
    symlinkSync(target, reportPath);
    await expect(
      verifyDeploymentJournalCapacity({ reportPath, temporaryParent: root }),
    ).rejects.toThrow('new file');
    expect(readFileSync(target, 'utf8')).toBe('preserve');
    expect(readdirSync(root).sort()).toEqual(['link.json', 'target.json']);
  });

  it('rejects a dangling report symlink before fixture creation', async () => {
    const root = temporaryRoot();
    const reportPath = path.join(root, 'dangling.json');
    symlinkSync(path.join(root, 'absent.json'), reportPath);
    await expect(
      verifyDeploymentJournalCapacity({ reportPath, temporaryParent: root }),
    ).rejects.toThrow('new file');
    expect(readdirSync(root)).toEqual(['dangling.json']);
  });

  it('retains bounded phase metadata and independently removes its workspace after failure', async () => {
    const root = temporaryRoot();
    const reportPath = path.join(root, 'failure.json');
    const sensitive = 'injected-secret-that-must-not-appear-in-a-report';
    await expect(
      verifyDeploymentJournalCapacity({
        reportPath,
        temporaryParent: root,
        onPhase: () => {
          throw new Error(sensitive);
        },
      }),
    ).rejects.toThrow('Local journal capacity acceptance failed.');
    const bytes = readFileSync(reportPath, 'utf8');
    expect(Buffer.byteLength(bytes)).toBeLessThan(16 * 1024);
    expect(bytes).not.toContain(sensitive);
    expect(JSON.parse(bytes)).toMatchObject({
      status: 'failed',
      evidence:
        'local-production-journal-and-coordinators-with-injected-remote-provider',
      cloudResourcesCreated: 0,
      limits: {
        maxRecords: 4096,
        maxRecordBytes: 1024 * 1024,
        recoveryReserveRecords: 32,
      },
      failure: { phase: 'seed-valid-chain', code: 'CAPACITY_PROOF_FAILED' },
      cleanup: { workspaceRemoved: true },
    });
    expect(readdirSync(root)).toEqual(['failure.json']);
  });

  it('the real operator refuses a new target at reserve before SSH and still repairs the committed target', async () => {
    // The fast unit case injects only the read result; the standalone acceptance
    // independently validates the entire 4,064-record filesystem predecessor chain.
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const target = createSingleNodeStatusUpdateTarget(fixture, 'near-capacity');
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const { journalId: _initialId, ...payload } = initial;
    const nearLimit = {
      ...payload,
      generation: 4063,
      previousJournalId: initial.journalId,
    };
    const journal = {
      ...nearLimit,
      journalId: createCanonicalJsonSha256Id({
        domain: SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN,
        prefix: SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
        value: nearLimit,
        valuePath: 'capacityTest.journal',
      }),
    };
    const observations = {
      identities: 0,
      activations: 0,
      commits: 0,
      releases: 0,
    };
    const coordinator = createSingleNodeDeploymentUpdateCoordinator({
      acquireOperationLock: async () => async () => {
        observations.releases += 1;
      },
      createJournalStore: () => ({
        read: async () => journal,
        commit: async () => {
          observations.commits += 1;
          throw new Error('No journal write should occur.');
        },
      }),
      readSshIdentity: async () => {
        observations.identities += 1;
        return fixture.sshIdentity;
      },
      activate: async () => {
        observations.activations += 1;
        return initial.release.current.activation;
      },
    });
    const dataRoot = temporaryRoot();
    const artifactPath = path.join(dataRoot, 'injected-artifact');
    await expect(
      coordinator.update({ ...target, dataRoot, artifactPath }),
    ).rejects.toMatchObject({
      code: 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RESERVE',
    });
    expect(observations).toEqual({
      identities: 0,
      activations: 0,
      commits: 0,
      releases: 1,
    });
    const repaired = await coordinator.recover({
      desired: fixture.desired,
      revision: fixture.revision,
      artifactRecord: fixture.artifactRecord,
      observation: {
        artifactId: fixture.artifactRecord.artifactId,
        byteDigest: fixture.artifactRecord.byteDigest,
        size: fixture.artifactRecord.size,
      },
      dataRoot,
      artifactPath,
    });
    expect(repaired).toMatchObject({
      status: 'active',
      journalId: journal.journalId,
      journalGeneration: 4063,
    });
    expect(observations).toEqual({
      identities: 1,
      activations: 1,
      commits: 0,
      releases: 2,
    });
  });

  it('the supervisor stops a real worker at its deadline and retains cleanup evidence', async () => {
    const root = temporaryRoot();
    const reportPath = path.join(root, 'deadline.json');
    const report = await superviseDeploymentJournalCapacity({
      reportPath,
      timeoutMs: 1,
    });
    expect(report).toMatchObject({
      status: 'failed',
      failure: { code: 'CAPACITY_PROOF_DEADLINE' },
      cleanup: { workspaceRemoved: true, supervisorWorkspaceRemoved: true },
      worker: { status: null, signal: 'SIGKILL' },
      deadlineMs: 1,
    });
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(report);
    expect(report.durationMs).toBeLessThan(10_000);
  });

  it('the supervisor refuses an existing report without starting expensive work', async () => {
    const root = temporaryRoot();
    const reportPath = path.join(root, 'prior.json');
    writeFileSync(reportPath, 'preserve prior evidence');
    await expect(
      superviseDeploymentJournalCapacity({ reportPath, timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(reportPath, 'utf8')).toBe('preserve prior evidence');
  });

  it('the supervisor cleans a fixture after a worker has started and bounds callback failure evidence', async () => {
    const root = temporaryRoot();
    const reportPath = path.join(root, 'active-worker.json');
    const secret = 'callback-diagnostic-must-not-be-retained';
    const report = await superviseDeploymentJournalCapacity({
      reportPath,
      timeoutMs: 10_000,
      onPhase: () => {
        throw new Error(secret);
      },
    });
    expect(report).toMatchObject({
      status: 'failed',
      failure: {
        phase: 'seed-valid-chain',
        code: 'CAPACITY_PROOF_MESSAGE_INVALID',
      },
      cleanup: { workspaceRemoved: true, supervisorWorkspaceRemoved: true },
      worker: { status: null, signal: 'SIGKILL' },
    });
    expect(readFileSync(reportPath, 'utf8')).not.toContain(secret);
  });
});
