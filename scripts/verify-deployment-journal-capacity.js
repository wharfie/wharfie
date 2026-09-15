/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This checkout-only acceptance proof keeps its local injected ports and bounded receipt together. */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  openSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../src/core/runtime/content-id.js';
import { SINGLE_NODE_DEPLOYMENT_ROOT } from '../src/core/runtime/single-node-cloud-init.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
} from '../src/core/runtime/single-node-remote-activation.js';
import {
  SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE,
  abandonSingleNodeDeploymentReleaseUpdate,
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  createSingleNodeDeploymentJournalStore,
  prepareSingleNodeDeploymentMutation,
  prepareSingleNodeDeploymentReleaseUpdate,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  settleSingleNodeDeploymentReleaseTransition,
} from '../src/core/runtime/single-node-deployment-journal.js';
import { createSingleNodeDeploymentUpdateCoordinator } from '../src/core/runtime/single-node-deployment-update.js';
import {
  createHetznerDeletionRecord,
  createHetznerDestructionAttempt,
} from '../src/core/runtime/providers/hetzner/single-node-destruction.js';
import { createHetznerSingleNodeDestroyCoordinator } from '../src/core/runtime/providers/hetzner/single-node-destroy.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
} from '../src/core/runtime/providers/hetzner/single-node-provisioning.js';
// Authority is a deterministic test fixture. No packaged executable, credential,
// network transport, or cloud provider is used by this local capacity proof.
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from '../test/runtime/fixtures/single-node-status-fixture.js';

const FORMAT = 'wharfie.deployment-journal-capacity.v1';
const MAX_REPORT_BYTES = 16 * 1024;
const MAX_RUNTIME_MS = 45 * 60_000;
const UPDATE_WRITES = 3;
/** @type {Readonly<Record<string, number>>} */
const RESOURCE_IDS = Object.freeze({
  firewall: 101,
  primaryIp: 102,
  server: 103,
});
const HELP = `Usage: node scripts/verify-deployment-journal-capacity.js [--report <new-file>]

Runs a local capacity proof with real journal files and production update/recover/
destroy coordinators. Remote activation and provider evidence are injected.
No cloud credentials or resources are used. Temporary journal files are removed.
Full history replay can take tens of minutes; deadline: 45 minutes.
A bounded report is retained automatically under the temporary directory.
`;

/** @param {string[]} args */
export function parseDeploymentJournalCapacityArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length === 0) return {};
  assert.equal(args.length, 2, 'Expected only --report <new-file>.');
  assert.equal(args[0], '--report', 'Unknown capacity acceptance option.');
  assert.ok(args[1] && !args[1].startsWith('--') && !/[\0\r\n]/u.test(args[1]));
  return { reportPath: path.resolve(args[1]) };
}

/**
 * Exact content inventory independently checks that refused operations write nothing.
 * @param {string} directory
 */
function inventory(directory) {
  const names = readdirSync(directory).sort();
  const hash = createHash('sha256');
  let bytes = 0;
  let largestRecordBytes = 0;
  for (const name of names) {
    assert.match(name, /^journal-[0-9]{16}\.json$/u);
    const selected = path.join(directory, name);
    const info = lstatSync(selected);
    assert.ok(info.isFile() && !info.isSymbolicLink());
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(info.nlink, 1);
    assert.ok(info.size <= SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES);
    bytes += info.size;
    largestRecordBytes = Math.max(largestRecordBytes, info.size);
    hash.update(name).update('\0').update(readFileSync(selected));
  }
  return {
    records: names.length,
    bytes,
    largestRecordBytes,
    digest: hash.digest('hex'),
  };
}

/**
 * Build every real legal predecessor, without quadratic store reads during fixture setup.
 * @param {Record<string, any>} store
 * @param {Parameters<typeof createSingleNodeStatusActiveJournal>[0]} fixture
 * @param {Record<string, any>} target
 * @param {() => void} checkDeadline
 */
async function seedJournal(store, fixture, target, checkDeadline) {
  await store.prepareStorage();
  let journal = createSingleNodeDeploymentJournal({
    desired: fixture.desired,
    providerIntent: fixture.providerIntent,
  });
  const evidenceA =
    createSingleNodeStatusActiveJournal(fixture).release.current.activation;
  const { activationEvidenceId: _oldEvidenceId, ...payload } = evidenceA;
  const desired = target.desired;
  const nextPayload = {
    ...payload,
    desiredRevisionId: desired.desiredRevisionId,
    artifact: {
      artifactId: desired.artifact.artifactId,
      revisionId: desired.artifact.revisionId,
      byteDigest: desired.artifact.byteDigest,
      size: desired.artifact.size,
      remotePath: `${SINGLE_NODE_DEPLOYMENT_ROOT}/${desired.deploymentInstanceId}/artifacts/${desired.artifact.artifactId}/app-sea`,
    },
    service: {
      ...payload.service,
      activeArtifactId: desired.artifact.artifactId,
      activeRevisionId: desired.artifact.revisionId,
    },
  };
  const evidenceB = {
    ...nextPayload,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: nextPayload,
      valuePath: 'capacityProof.activationEvidence',
    }),
  };
  const evidence = new Map([
    [fixture.desired.desiredRevisionId, evidenceA],
    [target.desired.desiredRevisionId, evidenceB],
  ]);
  /**
   * Write one complete fixture generation; production readers validate its chain.
   * @param {Readonly<Record<string, any>>} next
   */
  function append(next) {
    checkDeadline();
    journal = next;
    const file = path.join(
      store.paths.journalRoot,
      `journal-${String(journal.generation).padStart(16, '0')}.json`,
    );
    const bytes = `${JSON.stringify(journal)}\n`;
    assert.ok(
      Buffer.byteLength(bytes) <= SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
    );
    writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    chmodSync(file, 0o600);
  }
  append(journal);
  append(advanceSingleNodeDeploymentJournal(journal, 'provisioning'));
  for (const role of ['firewall', 'primaryIp', 'server']) {
    append(
      prepareSingleNodeDeploymentMutation(
        journal,
        createHetznerProvisioningMutationAttempt(
          fixture.providerIntent.intent,
          role,
        ),
      ),
    );
    append(
      completeSingleNodeDeploymentMutation(
        journal,
        createHetznerProvisionedResourceRecord(
          fixture.providerIntent.intent,
          role,
          RESOURCE_IDS[role],
        ),
      ),
    );
    if (role !== 'firewall') {
      const resource = journal.resources.find(
        (/** @type {Record<string, any>} */ entry) => entry.role === role,
      );
      append(
        recordSingleNodeDeploymentResource(journal, {
          ...resource,
          publicIpv4: fixture.publicIpv4,
        }),
      );
    }
  }
  append(advanceSingleNodeDeploymentJournal(journal, 'provisioned'));
  append(
    recordSingleNodeDeploymentSshHost(journal, {
      address: fixture.publicIpv4,
      algorithm: 'ssh-ed25519',
      fingerprint: fixture.hostKeyFingerprint,
    }),
  );
  append(advanceSingleNodeDeploymentJournal(journal, 'activating'));
  append(recordSingleNodeDeploymentActivation(journal, evidenceA));
  append(settleSingleNodeDeploymentReleaseTransition(journal));
  append(advanceSingleNodeDeploymentJournal(journal, 'active'));
  const initialActiveGeneration = journal.generation;
  const lastAllowedGeneration =
    SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS -
    SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE -
    UPDATE_WRITES -
    1;
  let abandonedUpdates = 0;
  while ((lastAllowedGeneration - journal.generation) % UPDATE_WRITES !== 0) {
    append(prepareSingleNodeDeploymentReleaseUpdate(journal, target.desired));
    append(abandonSingleNodeDeploymentReleaseUpdate(journal));
    abandonedUpdates += 1;
    assert.ok(abandonedUpdates <= 2);
  }
  let successfulUpdates = 0;
  while (journal.generation < lastAllowedGeneration) {
    const desired =
      journal.release.current.desired.desiredRevisionId ===
      fixture.desired.desiredRevisionId
        ? target.desired
        : fixture.desired;
    append(prepareSingleNodeDeploymentReleaseUpdate(journal, desired));
    append(
      recordSingleNodeDeploymentActivation(
        journal,
        evidence.get(desired.desiredRevisionId),
      ),
    );
    append(settleSingleNodeDeploymentReleaseTransition(journal));
    successfulUpdates += 1;
  }
  assert.equal(journal.generation, lastAllowedGeneration);
  return {
    journal,
    evidence,
    initialActiveGeneration,
    successfulUpdates,
    abandonedUpdates,
  };
}

/**
 * Exercise the real local durable boundary. The injected provider only returns
 * deterministic authority; this receipt must never be presented as cloud proof.
 * @param {{reportPath?: string, temporaryParent?: string, onPhase?: (name: string, snapshot: Record<string, any>) => void}} [options]
 */
export async function verifyDeploymentJournalCapacity(options = {}) {
  const started = performance.now();
  const report = /** @type {Record<string, any>} */ ({
    format: FORMAT,
    status: 'running',
    evidence:
      'local-production-journal-and-coordinators-with-injected-remote-provider',
    provider: 'hetzner',
    cloudResourcesCreated: 0,
    limits: {
      maxRecords: SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS,
      maxRecordBytes: SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
      recoveryReserveRecords:
        SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE,
    },
    phases: [],
    cleanup: { workspaceRemoved: false },
  });
  if (options.reportPath !== undefined) {
    assert.ok(path.isAbsolute(options.reportPath));
    // lstat also rejects a dangling symlink before the expensive proof starts.
    let existingReport = false;
    try {
      lstatSync(options.reportPath);
      existingReport = true;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT')
        throw error;
    }
    assert.ok(!existingReport, 'Capacity report must be a new file.');
  }
  const root = realpathSync(
    mkdtempSync(
      path.join(
        options.temporaryParent ?? os.tmpdir(),
        'wharfie-journal-capacity-',
      ),
    ),
  );
  chmodSync(root, 0o700);
  let phase = 'fixture';
  let failure;
  /** Bound fixture construction and the interval between real durable operations. */
  function checkDeadline() {
    assert.ok(
      performance.now() - started < MAX_RUNTIME_MS,
      'Local capacity proof exceeded its 45-minute deadline.',
    );
  }
  /**
   * Record the latency of each capacity-boundary operation.
   * @template T
   * @param {string} name
   * @param {() => Promise<T>} action
   * @returns {Promise<T>}
   */
  async function measure(name, action) {
    phase = name;
    checkDeadline();
    const phaseStarted = performance.now();
    options.onPhase?.(name, report);
    try {
      return await action();
    } finally {
      report.phases.push({
        phase: name,
        durationMs: Math.round(performance.now() - phaseStarted),
      });
      checkDeadline();
    }
  }
  try {
    const fixture = await createSingleNodeStatusAuthorityFixture({
      deploymentId: 'journal-capacity',
    });
    const target = createSingleNodeStatusUpdateTarget(fixture, 'capacity-b');
    const identity = {
      appId: fixture.desired.intent.appId,
      deploymentInstanceId: fixture.desired.deploymentInstanceId,
      dataRoot: root,
    };
    const openStore = () => {
      const actual = createSingleNodeDeploymentJournalStore(identity);
      return {
        ...actual,
        paths: actual.paths,
        read: async () => {
          checkDeadline();
          const result = await actual.read();
          checkDeadline();
          return result;
        },
        commit: async (/** @type {unknown} */ request) => {
          checkDeadline();
          const result = await actual.commit(request);
          checkDeadline();
          return result;
        },
      };
    };
    const store = openStore();
    const seeded = await measure('seed-valid-chain', () =>
      seedJournal(store, fixture, target, checkDeadline),
    );
    report.seed = {
      initialActiveGeneration: seeded.initialActiveGeneration,
      successfulUpdates: seeded.successfulUpdates,
      abandonedUpdates: seeded.abandonedUpdates,
      generation: seeded.journal.generation,
      ...inventory(store.paths.journalRoot),
    };
    const reopened = await measure('read-full-chain', () => openStore().read());
    assert.equal(reopened.journalId, seeded.journal.journalId);
    const targets = new Map([
      [
        fixture.desired.desiredRevisionId,
        {
          ...fixture,
          observation: {
            artifactId: fixture.artifactRecord.artifactId,
            byteDigest: fixture.artifactRecord.byteDigest,
            size: fixture.artifactRecord.size,
          },
        },
      ],
      [target.desired.desiredRevisionId, target],
    ]);
    const next = targets.get(
      reopened.release.current.desired.desiredRevisionId ===
        fixture.desired.desiredRevisionId
        ? target.desired.desiredRevisionId
        : fixture.desired.desiredRevisionId,
    );
    const previous = targets.get(
      reopened.release.current.desired.desiredRevisionId,
    );
    assert.ok(next !== undefined && previous !== undefined);
    const counters = {
      identityReads: 0,
      activations: 0,
      commits: 0,
      locks: 0,
      releases: 0,
    };
    let activeRevisionId = reopened.release.current.desired.desiredRevisionId;
    let loseActivationReply = true;
    /** Open a fresh production store for each controller operation. */
    function journalStore() {
      const actual = openStore();
      return {
        ...actual,
        commit: async (/** @type {Record<string, any>} */ request) => {
          const result = await actual.commit(request);
          counters.commits += 1;
          return result;
        },
      };
    }
    const acquireOperationLock = async () => {
      counters.locks += 1;
      return async () => {
        counters.releases += 1;
      };
    };
    /** Use the command's coordinator with deterministic remote observations. */
    function coordinator() {
      return createSingleNodeDeploymentUpdateCoordinator({
        acquireOperationLock,
        createJournalStore: journalStore,
        readSshIdentity: async () => {
          counters.identityReads += 1;
          return fixture.sshIdentity;
        },
        activate: async (/** @type {Record<string, any>} */ value) => {
          counters.activations += 1;
          activeRevisionId = value.desired.desiredRevisionId;
          if (loseActivationReply) {
            loseActivationReply = false;
            throw Object.assign(new Error('Injected lost activation reply.'), {
              code: 'CAPACITY_PROOF_INTERRUPTED',
            });
          }
          return seeded.evidence.get(value.desired.desiredRevisionId);
        },
      });
    }
    /**
     * Bind the selected fixture release to the coordinator input contract.
     * @param {Readonly<Record<string, any>>} selected
     */
    function input(selected) {
      return {
        desired: selected.desired,
        revision: selected.revision,
        artifactRecord: selected.artifactRecord,
        observation: selected.observation,
        dataRoot: root,
        artifactPath: path.join(root, 'injected-artifact-not-executed'),
      };
    }
    await measure('interrupt-last-allowed-update', async () => {
      await assert.rejects(coordinator().update(input(next)), {
        code: 'CAPACITY_PROOF_INTERRUPTED',
      });
    });
    assert.equal(counters.commits, 1);
    const recovered = await measure('recover-from-fresh-coordinator', () =>
      coordinator().recover(input(next)),
    );
    assert.equal(
      recovered.journalGeneration - reopened.generation,
      UPDATE_WRITES,
    );
    assert.equal(recovered.desiredRevisionId, activeRevisionId);
    assert.equal(counters.commits, UPDATE_WRITES);
    report.update = {
      recordsWritten: counters.commits,
      activationReplyLost: true,
      freshCoordinatorRecovered: true,
      generation: recovered.journalGeneration,
      remainingRecords:
        SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS -
        recovered.journalGeneration -
        1,
    };
    assert.equal(
      report.update.remainingRecords,
      SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE,
    );
    const before = inventory(store.paths.journalRoot);
    const beforeCounters = { ...counters };
    await measure('refuse-new-update', async () => {
      await assert.rejects(coordinator().update(input(previous)), {
        code: 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RESERVE',
      });
    });
    assert.deepEqual(inventory(store.paths.journalRoot), before);
    assert.equal(counters.identityReads, beforeCounters.identityReads);
    assert.equal(counters.activations, beforeCounters.activations);
    assert.equal(counters.commits, beforeCounters.commits);
    report.refusal = {
      code: 'WHARFIE_SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RESERVE',
      beforeRecords: before.records,
      journalBytesUnchanged: true,
      sshIdentityUnread: true,
      remoteMutationCalls: 0,
    };
    const repair = await measure('repair-current-at-reserve', () =>
      coordinator().recover(input(next)),
    );
    assert.equal(repair.journalId, recovered.journalId);
    assert.deepEqual(inventory(store.paths.journalRoot), before);
    report.repair = { currentRecovered: true, recordsWritten: 0 };
    let interruptedDestroy = false;
    const deleted = new Set();
    /** Keep journal fencing real while injecting provider deletion evidence. */
    function destroyCoordinator() {
      return createHetznerSingleNodeDestroyCoordinator({
        acquireOperationLock,
        createJournalStore: journalStore,
        readToken: async () => 'injected-local-capacity-proof',
        requireCredentialBinding: async () => ({
          schemaVersion: 1,
          kind: 'hetznerCredentialBindingEvidence',
          deploymentInstanceId: identity.deploymentInstanceId,
          bindingId: `whcb1_${sha256Base64Url('capacity-proof-binding')}`,
        }),
        createApi: () => ({}),
        reconcilePreparedMutation: async () => {
          throw new Error('Unexpected pending provisioning mutation.');
        },
        waitForAction: async () => {
          throw new Error('Unexpected live provider wait.');
        },
        wait: async () => {
          throw new Error('Unexpected live provider wait.');
        },
        convergeDestruction: async (
          /** @type {Record<string, any>} */ value,
        ) => {
          const deletions = { ...value.storedDeletionRecords };
          for (const role of ['server', 'primaryIp', 'firewall']) {
            if (deletions[role] !== null) {
              assert.ok(deleted.has(role));
              continue;
            }
            const attempt = createHetznerDestructionAttempt(
              value.intent,
              role,
              value.storedResourceIds[role],
            );
            await value.recordDestroyAttempt(attempt);
            assert.ok(
              !deleted.has(role),
              'Committed resource deletion repeated.',
            );
            deleted.add(role);
            deletions[role] = createHetznerDeletionRecord(
              value.intent,
              role,
              value.storedResourceIds[role],
              attempt,
            );
            await value.recordDeletion(deletions[role]);
            if (!interruptedDestroy) {
              interruptedDestroy = true;
              throw Object.assign(new Error('Injected lost destroy reply.'), {
                code: 'CAPACITY_PROOF_DESTROY_INTERRUPTED',
              });
            }
          }
          return {
            schemaVersion: 1,
            kind: 'hetznerSingleNodeDestructionResult',
            provisioningIntentId: value.intent.provisioningIntentId,
            planId: value.intent.plan.planId,
            providerSpecId: value.intent.plan.providerSpec.providerSpecId,
            deploymentInstanceId: identity.deploymentInstanceId,
            incarnationId: fixture.incarnationId,
            status: 'destroyed',
            resources: Object.fromEntries(
              ['server', 'primaryIp', 'firewall'].map((role) => [
                role,
                {
                  providerResourceId: value.storedResourceIds[role],
                  state: 'absent',
                  deletionId: deletions[role].deletionId,
                },
              ]),
            ),
          };
        },
      });
    }
    const beforeDestroyCommits = counters.commits;
    await measure('interrupt-destroy-at-reserve', async () => {
      await assert.rejects(destroyCoordinator().destroy(identity), {
        code: 'CAPACITY_PROOF_DESTROY_INTERRUPTED',
      });
    });
    const destroyed = await measure(
      'resume-destroy-from-fresh-coordinator',
      () => destroyCoordinator().destroy(identity),
    );
    assert.equal(destroyed.status, 'destroyed');
    assert.equal(deleted.size, 3);
    const final = await measure('independent-final-journal-read', () =>
      openStore().read(),
    );
    assert.equal(final.phase, 'destroyed');
    assert.equal(final.journalId, destroyed.journalId);
    assert.equal(final.deletionRecords.length, 3);
    assert.equal(counters.locks, counters.releases);
    const finalInventory = inventory(store.paths.journalRoot);
    report.destroy = {
      freshCoordinatorResumed: true,
      committedDeletionRepeated: false,
      recordsWritten: counters.commits - beforeDestroyCommits,
      remainingRecords:
        SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS - finalInventory.records,
      ...finalInventory,
    };
    assert.equal(report.destroy.recordsWritten, 8);
    assert.ok(report.destroy.remainingRecords > 0);
    report.retention = {
      successfulUpdateRecords: UPDATE_WRITES,
      interruptedUpdatesMayUseAdditionalRecords: true,
      compactionSupported: false,
      guidance:
        'Retain the complete private controller journal. Plan a new deployment before the recovery reserve; never delete individual journal records to make space.',
    };
    report.status = 'passed';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    const code = /** @type {{code?: unknown} | null | undefined} */ (error)
      ?.code;
    report.failure = {
      phase,
      code:
        typeof code === 'string' && /^[A-Z0-9_]{1,100}$/u.test(code)
          ? code
          : 'CAPACITY_PROOF_FAILED',
    };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
      report.cleanup.workspaceRemoved = !existsSync(root);
      assert.ok(report.cleanup.workspaceRemoved);
    } catch (error) {
      failure =
        failure === undefined
          ? error
          : new AggregateError([failure, error], 'Proof and cleanup failed.');
      report.status = 'failed';
      report.cleanup.workspaceRemoved = false;
      report.failure ??= {
        phase: 'cleanup',
        code: 'CAPACITY_PROOF_CLEANUP_FAILED',
      };
    }
    report.durationMs = Math.round(performance.now() - started);
    const encoded = `${JSON.stringify(report, null, 2)}\n`;
    assert.ok(Buffer.byteLength(encoded) <= MAX_REPORT_BYTES);
    if (options.reportPath !== undefined)
      writeFileSync(options.reportPath, encoded, { flag: 'wx', mode: 0o600 });
  }
  if (failure !== undefined)
    throw Object.assign(
      new Error('Local journal capacity acceptance failed.', {
        cause: failure,
      }),
      { report },
    );
  return report;
}

/**
 * Keep the wall-clock deadline independent of expensive journal validation.
 * The child can touch only the parent's fresh local fixture; it makes no remote
 * calls. The parent removes that fixture even when the child must be killed.
 * @param {{reportPath: string, timeoutMs?: number, onPhase?: (name: string) => void}} options
 * @returns {Promise<Record<string, any>>}
 */
export async function superviseDeploymentJournalCapacity(options) {
  assert.ok(path.isAbsolute(options.reportPath));
  const timeoutMs = options.timeoutMs ?? MAX_RUNTIME_MS;
  assert.ok(
    Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= MAX_RUNTIME_MS,
  );
  const parent = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'wharfie-capacity-supervisor-')),
  );
  chmodSync(parent, 0o700);
  const childReport = path.join(parent, 'child-report.json');
  const started = performance.now();
  let phaseStarted = started;
  let phase = 'worker-starting';
  let reason = /** @type {string | null} */ (null);
  let lastSnapshot = /** @type {Record<string, any>} */ ({
    format: FORMAT,
    status: 'running',
    evidence:
      'local-production-journal-and-coordinators-with-injected-remote-provider',
    provider: 'hetzner',
    cloudResourcesCreated: 0,
    limits: {
      maxRecords: SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS,
      maxRecordBytes: SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_BYTES,
      recoveryReserveRecords:
        SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE,
    },
    phases: [],
  });
  let outputBytes = 0;
  // The destination is exclusively reserved before expensive work, including
  // dangling symlinks. No existing report can be overwritten at completion.
  let reportDescriptor;
  try {
    reportDescriptor = openSync(
      options.reportPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW || 0),
      0o600,
    );
    fchmodSync(reportDescriptor, 0o600);
  } catch (error) {
    if (reportDescriptor !== undefined) closeSync(reportDescriptor);
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
  const source = `import { verifyDeploymentJournalCapacity } from ${JSON.stringify(import.meta.url)};
try {
  await verifyDeploymentJournalCapacity({
    reportPath: ${JSON.stringify(childReport)},
    temporaryParent: ${JSON.stringify(parent)},
    onPhase: (phase, snapshot) => process.send?.({ phase, snapshot }),
  });
} catch { process.exitCode = 1; }
`;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const stop = (/** @type {string} */ code) => {
    reason ??= code;
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => stop('CAPACITY_PROOF_DEADLINE'), timeoutMs);
  const interrupt = () => stop('CAPACITY_PROOF_INTERRUPTED');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  assert.ok(child.stdout !== null && child.stderr !== null);
  child.stdout.on('data', (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_REPORT_BYTES) stop('CAPACITY_PROOF_OUTPUT_BOUND');
  });
  child.stderr.on('data', (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_REPORT_BYTES) stop('CAPACITY_PROOF_OUTPUT_BOUND');
  });
  child.on('message', (value) => {
    try {
      const message = /** @type {Record<string, any>} */ (value);
      assert.ok(
        typeof message.phase === 'string' &&
          /^[a-z-]{1,80}$/u.test(message.phase),
      );
      assert.ok(Buffer.byteLength(JSON.stringify(message)) <= MAX_REPORT_BYTES);
      assert.equal(message.snapshot.format, FORMAT);
      lastSnapshot = message.snapshot;
      phase = message.phase;
      phaseStarted = performance.now();
      options.onPhase?.(phase);
    } catch {
      stop('CAPACITY_PROOF_MESSAGE_INVALID');
    }
  });
  const outcome = await new Promise(
    /** @param {(value: {status: number | null, signal: NodeJS.Signals | null}) => void} resolve */ (
      resolve,
    ) => {
      child.once('error', () => {
        reason ??= 'CAPACITY_PROOF_WORKER_FAILED';
      });
      child.once('close', (status, signal) => resolve({ status, signal }));
    },
  );
  clearTimeout(timer);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  let report = lastSnapshot;
  try {
    if (reason === null) {
      const info = lstatSync(childReport);
      assert.ok(
        info.isFile() &&
          !info.isSymbolicLink() &&
          info.size <= MAX_REPORT_BYTES,
      );
      report = JSON.parse(readFileSync(childReport, 'utf8'));
      assert.equal(report.format, FORMAT);
      assert.ok(['passed', 'failed'].includes(report.status));
      if (outcome.status !== 0 || outcome.signal !== null)
        assert.equal(report.status, 'failed');
    }
  } catch {
    reason ??= 'CAPACITY_PROOF_WORKER_FAILED';
  }
  if (reason !== null) {
    report.status = 'failed';
    report.failure = { phase, code: reason };
    report.phases.push({
      phase,
      durationMs: Math.round(performance.now() - phaseStarted),
    });
  }
  try {
    rmSync(parent, { recursive: true, force: true });
    assert.ok(!existsSync(parent));
  } catch {
    report.status = 'failed';
    report.failure ??= {
      phase: 'cleanup',
      code: 'CAPACITY_PROOF_CLEANUP_FAILED',
    };
  }
  report.cleanup = {
    workspaceRemoved: !existsSync(parent),
    supervisorWorkspaceRemoved: !existsSync(parent),
  };
  report.durationMs = Math.round(performance.now() - started);
  report.worker = { status: outcome.status, signal: outcome.signal };
  report.deadlineMs = timeoutMs;
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(Buffer.byteLength(encoded) <= MAX_REPORT_BYTES);
  // This exclusively created regular file remains the supervisor's report.
  try {
    const info = fstatSync(reportDescriptor);
    assert.ok(info.isFile() && info.nlink === 1 && info.size === 0);
    writeFileSync(reportDescriptor, encoded);
    fsyncSync(reportDescriptor);
  } finally {
    closeSync(reportDescriptor);
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseDeploymentJournalCapacityArguments(
      process.argv.slice(2),
    );
    if (options.help) process.stdout.write(HELP);
    else {
      const reportPath =
        options.reportPath ??
        path.join(
          os.tmpdir(),
          `wharfie-journal-capacity-report-${randomUUID()}.json`,
        );
      process.stderr.write(`Capacity proof report: ${reportPath}\n`);
      const report = await superviseDeploymentJournalCapacity({
        reportPath,
        onPhase: (name) => process.stderr.write(`Capacity proof: ${name}\n`),
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.status !== 'passed') process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Local capacity proof failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
