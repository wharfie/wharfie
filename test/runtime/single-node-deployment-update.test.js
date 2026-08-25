import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  getSingleNodeDeploymentCurrentRelease,
  validateSingleNodeDeploymentJournalSuccessor,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import { createSingleNodeDeploymentDesired } from '../../src/core/runtime/single-node-deployment-desired.js';
import {
  SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_KIND,
  createSingleNodeDeploymentUpdateCoordinator,
} from '../../src/core/runtime/single-node-deployment-update.js';
import { SINGLE_NODE_DEPLOYMENT_ROOT } from '../../src/core/runtime/single-node-cloud-init.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/single-node-remote-activation.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
} from './fixtures/single-node-status-fixture.js';

const DATA_ROOT = '/tmp/wharfie-single-node-update-test/data';

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/**
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 * @param {string} label
 */
function createTarget(fixture, label) {
  const revision = createApplicationRevision({
    contract: fixture.revision.contract,
    inputs: {
      ...fixture.revision.inputs,
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${label}`),
      },
    },
  });
  const bytes = Buffer.from(`updated Linux SEA payload ${label}`);
  const artifactRecord = createArtifactRecord({
    bytes,
    revision,
    target: fixture.artifactRecord.target,
    provenance: {
      ...fixture.artifactRecord.provenance,
      builder: {
        ...fixture.artifactRecord.provenance.builder,
        runtimeDigest: revision.inputs.runtime.digest,
      },
    },
  });
  const observation = Object.freeze({
    artifactId: artifactRecord.artifactId,
    byteDigest: artifactRecord.byteDigest,
    size: artifactRecord.size,
  });
  return Object.freeze({
    revision,
    artifactRecord,
    observation,
    desired: createSingleNodeDeploymentDesired({
      intent: fixture.desired.intent,
      revision,
      artifactRecord,
      observation,
    }),
  });
}

/**
 * @param {Readonly<Record<string, any>>} desired
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 */
function activationEvidence(desired, fixture) {
  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    desiredRevisionId: desired.desiredRevisionId,
    address: fixture.publicIpv4,
    sshHostKey: {
      algorithm: 'ssh-ed25519',
      fingerprint: fixture.hostKeyFingerprint,
    },
    bootstrap: {
      contractVersion: 1,
      sshPublicKeyFingerprint: fixture.sshIdentity.publicKeyFingerprint,
    },
    artifact: {
      artifactId: desired.artifact.artifactId,
      revisionId: desired.artifact.revisionId,
      byteDigest: desired.artifact.byteDigest,
      size: desired.artifact.size,
      remotePath: `${SINGLE_NODE_DEPLOYMENT_ROOT}/${desired.deploymentInstanceId}/artifacts/${desired.artifact.artifactId}/app-sea`,
    },
    service: {
      appId: desired.intent.appId,
      unit: `wharfie-${desired.intent.appId}.service`,
      health: 'healthy',
      activeArtifactId: desired.artifact.artifactId,
      activeRevisionId: desired.artifact.revisionId,
    },
  });
  return Object.freeze({
    ...payload,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: payload,
      valuePath: 'singleNodeDeploymentUpdateTest.activationEvidence',
    }),
  });
}

/**
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 * @param {Readonly<Record<string, any>>} initialJournal
 * @param {{failActivationCalls?: number, loseCommitReplyAt?: 'prepared'|'activation'|'settled'}} [options]
 */
function createHarness(fixture, initialJournal, options = {}) {
  /** @type {Readonly<Record<string, any>>} */
  let journal = initialJournal;
  /** @type {string[]} */
  const events = [];
  /** @type {Readonly<Record<string, any>>[]} */
  const activationRequests = [];
  let activationCalls = 0;
  let lostCommitReply = false;
  const release = jest.fn(async () => {
    events.push('release');
  });
  const dependencies = {
    acquireOperationLock: async () => {
      events.push('lock');
      return release;
    },
    createJournalStore: () => ({
      read: async () => {
        events.push('journal-read');
        return journal;
      },
      commit: async (/** @type {Record<string, any>} */ request) => {
        if (
          request.expectedGeneration !== journal.generation ||
          request.expectedJournalId !== journal.journalId
        ) {
          throw new Error('injected journal CAS mismatch');
        }
        const prior = journal;
        journal = validateSingleNodeDeploymentJournalSuccessor(
          journal,
          request.next,
        );
        const transition = journal.release.transition;
        const recordedActivation =
          prior.release.transition?.target.activation === null &&
          transition?.target.activation !== null;
        const commitKind = recordedActivation
          ? 'activation'
          : transition === null
            ? 'settled'
            : 'prepared';
        events.push(`journal-${commitKind}`);
        if (options.loseCommitReplyAt === commitKind && !lostCommitReply) {
          lostCommitReply = true;
          throw new Error(`injected lost ${commitKind} commit response`);
        }
        return journal;
      },
    }),
    readSshIdentity: async () => {
      events.push('identity');
      return fixture.sshIdentity;
    },
    activate: async (/** @type {Record<string, any>} */ value) => {
      activationCalls += 1;
      activationRequests.push(value);
      events.push(`activate-${activationCalls}`);
      if (Object.hasOwn(value, 'artifactSource')) {
        await value.artifactSource.close();
      }
      if (activationCalls <= (options.failActivationCalls ?? 0)) {
        throw new Error('injected lost remote activation response');
      }
      return activationEvidence(value.desired, fixture);
    },
  };
  return {
    dependencies,
    events,
    release,
    getJournal: () => journal,
    getActivationCalls: () => activationCalls,
    getActivationRequests: () => activationRequests,
  };
}

/** @param {Readonly<Record<string, any>>} target */
function createRequest(target) {
  const close = jest.fn(async () => undefined);
  return {
    value: {
      desired: target.desired,
      revision: target.revision,
      artifactRecord: target.artifactRecord,
      observation: target.observation,
      artifactSource: {
        observation: target.observation,
        createReadStream: jest.fn(),
        verifyUnchanged: jest.fn(),
        close,
      },
      dataRoot: DATA_ROOT,
    },
    close,
  };
}

describe('provider-neutral single-node deployment update', () => {
  it('settles a new exact release without provider authority', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const target = createTarget(fixture, 'v2');
    const request = createRequest(target);
    const harness = createHarness(fixture, initial);
    const coordinator = createSingleNodeDeploymentUpdateCoordinator(
      harness.dependencies,
    );

    const result = await coordinator.update(request.value);
    const current = getSingleNodeDeploymentCurrentRelease(harness.getJournal());

    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: SINGLE_NODE_DEPLOYMENT_UPDATE_RESULT_KIND,
      provider: 'hetzner',
      status: 'active',
      deploymentInstanceId: fixture.desired.deploymentInstanceId,
      priorDesiredRevisionId: fixture.desired.desiredRevisionId,
      priorArtifactId: fixture.desired.artifact.artifactId,
      desiredRevisionId: target.desired.desiredRevisionId,
      artifactId: target.desired.artifact.artifactId,
    });
    expect(current?.desired).toEqual(target.desired);
    expect(harness.getJournal().release.rollback.desired).toEqual(
      fixture.desired,
    );
    expect(harness.getJournal().release.transition).toBeNull();
    expect(harness.events).toEqual([
      'lock',
      'journal-read',
      'journal-prepared',
      'identity',
      'activate-1',
      'journal-activation',
      'journal-settled',
      'release',
    ]);
    expect(harness.getActivationRequests()[0].retainedArtifactIds).toEqual(
      [
        fixture.desired.artifact.artifactId,
        target.desired.artifact.artifactId,
      ].sort(),
    );
    expect(request.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(1);
  });

  it.each(['prepared', 'activation', 'settled'])(
    'replays the same target after losing the %s journal commit response',
    async (commitKind) => {
      const fixture = await createSingleNodeStatusAuthorityFixture();
      const initial = createSingleNodeStatusActiveJournal(fixture);
      const target = createTarget(fixture, `v2-${commitKind}-replay`);
      const harness = createHarness(fixture, initial, {
        loseCommitReplyAt: /** @type {'prepared'|'activation'|'settled'} */ (
          commitKind
        ),
      });
      const coordinator = createSingleNodeDeploymentUpdateCoordinator(
        harness.dependencies,
      );
      const first = createRequest(target);

      await expect(coordinator.update(first.value)).rejects.toThrow(
        `injected lost ${commitKind} commit response`,
      );
      expect(first.close).toHaveBeenCalledTimes(1);

      const second = createRequest(target);
      await expect(coordinator.update(second.value)).resolves.toMatchObject({
        status: 'active',
        desiredRevisionId: target.desired.desiredRevisionId,
      });

      expect(harness.getJournal().release.transition).toBeNull();
      expect(harness.getActivationCalls()).toBe(
        commitKind === 'prepared' ? 1 : 2,
      );
      expect(second.close).toHaveBeenCalledTimes(1);
      expect(harness.release).toHaveBeenCalledTimes(2);
    },
  );

  it('replays the same durable target after a lost remote activation response', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const target = createTarget(fixture, 'v2-remote-replay');
    const harness = createHarness(fixture, initial, {
      failActivationCalls: 1,
    });
    const coordinator = createSingleNodeDeploymentUpdateCoordinator(
      harness.dependencies,
    );

    const first = createRequest(target);
    await expect(coordinator.update(first.value)).rejects.toThrow(
      'injected lost remote activation response',
    );
    expect(harness.getJournal().release.transition.target.desired).toEqual(
      target.desired,
    );

    const second = createRequest(target);
    await expect(coordinator.update(second.value)).resolves.toMatchObject({
      status: 'active',
      desiredRevisionId: target.desired.desiredRevisionId,
    });

    expect(harness.getJournal().release.transition).toBeNull();
    expect(harness.getActivationCalls()).toBe(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
  });

  it('rejects a different in-flight target before identity or SSH access', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const firstTarget = createTarget(fixture, 'v2-pending');
    const secondTarget = createTarget(fixture, 'v3-conflict');
    const harness = createHarness(fixture, initial, {
      failActivationCalls: 1,
    });
    const coordinator = createSingleNodeDeploymentUpdateCoordinator(
      harness.dependencies,
    );
    const first = createRequest(firstTarget);

    await expect(coordinator.update(first.value)).rejects.toThrow(
      'injected lost remote activation response',
    );
    const identityCount = harness.events.filter(
      (event) => event === 'identity',
    ).length;
    const activationCount = harness.getActivationCalls();
    const second = createRequest(secondTarget);

    await expect(coordinator.update(second.value)).rejects.toThrow();
    expect(harness.events.filter((event) => event === 'identity')).toHaveLength(
      identityCount,
    );
    expect(harness.getActivationCalls()).toBe(activationCount);
    expect(harness.getJournal().release.transition.target.desired).toEqual(
      firstTarget.desired,
    );
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
  });

  it('re-proves current, abandons a failed target, and permits a later update', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const failedTarget = createTarget(fixture, 'v2-failed');
    const laterTarget = createTarget(fixture, 'v3-after-restore');
    const currentTarget = {
      revision: fixture.revision,
      artifactRecord: fixture.artifactRecord,
      observation: {
        artifactId: fixture.artifactRecord.artifactId,
        byteDigest: fixture.artifactRecord.byteDigest,
        size: fixture.artifactRecord.size,
      },
      desired: fixture.desired,
    };
    const harness = createHarness(fixture, initial, {
      failActivationCalls: 1,
    });
    const coordinator = createSingleNodeDeploymentUpdateCoordinator(
      harness.dependencies,
    );

    const failed = createRequest(failedTarget);
    await expect(coordinator.update(failed.value)).rejects.toThrow(
      'injected lost remote activation response',
    );
    expect(harness.getJournal().release.transition.target.desired).toEqual(
      failedTarget.desired,
    );

    const restore = createRequest(currentTarget);
    await expect(coordinator.recover(restore.value)).resolves.toMatchObject({
      status: 'active',
      desiredRevisionId: fixture.desired.desiredRevisionId,
    });
    expect(harness.getJournal().release.transition).toBeNull();
    expect(harness.getActivationRequests()[1].retainedArtifactIds).toEqual([
      fixture.desired.artifact.artifactId,
    ]);
    expect(
      getSingleNodeDeploymentCurrentRelease(harness.getJournal())?.desired,
    ).toEqual(fixture.desired);

    const later = createRequest(laterTarget);
    await expect(coordinator.update(later.value)).resolves.toMatchObject({
      status: 'active',
      desiredRevisionId: laterTarget.desired.desiredRevisionId,
    });
    expect(
      getSingleNodeDeploymentCurrentRelease(harness.getJournal())?.desired,
    ).toEqual(laterTarget.desired);
    expect(harness.getJournal().release.rollback.desired).toEqual(
      fixture.desired,
    );
    expect(failed.close).toHaveBeenCalledTimes(1);
    expect(restore.close).toHaveBeenCalledTimes(1);
    expect(later.close).toHaveBeenCalledTimes(1);
  });

  it('does not let recovery select a new release from stable current authority', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const target = createTarget(fixture, 'v2-not-recovery');
    const request = createRequest(target);
    const harness = createHarness(fixture, initial);
    const coordinator = createSingleNodeDeploymentUpdateCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.recover(request.value)).rejects.toThrow(
      'recovery requires the exact current or in-flight target release',
    );
    expect(harness.getJournal()).toBe(initial);
    expect(harness.events).toEqual(['lock', 'journal-read', 'release']);
    expect(request.close).toHaveBeenCalledTimes(1);
  });

  it('repairs the settled current release without rewriting the journal', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const initial = createSingleNodeStatusActiveJournal(fixture);
    const target = {
      revision: fixture.revision,
      artifactRecord: fixture.artifactRecord,
      observation: {
        artifactId: fixture.artifactRecord.artifactId,
        byteDigest: fixture.artifactRecord.byteDigest,
        size: fixture.artifactRecord.size,
      },
      desired: fixture.desired,
    };
    const request = createRequest(target);
    const harness = createHarness(fixture, initial);
    const coordinator = createSingleNodeDeploymentUpdateCoordinator(
      harness.dependencies,
    );

    const result = await coordinator.update(request.value);

    expect(result).toMatchObject({
      priorDesiredRevisionId: fixture.desired.desiredRevisionId,
      desiredRevisionId: fixture.desired.desiredRevisionId,
      journalId: initial.journalId,
      journalGeneration: initial.generation,
    });
    expect(harness.getJournal()).toBe(initial);
    expect(harness.events).toEqual([
      'lock',
      'journal-read',
      'identity',
      'activate-1',
      'release',
    ]);
    expect(request.close).toHaveBeenCalledTimes(1);
  });
});
