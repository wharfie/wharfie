import { beforeAll, describe, expect, it } from '@jest/globals';

import { assertLiveDeploymentJournalScope } from '../../scripts/verify-live-deployment.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  abandonSingleNodeDeploymentReleaseUpdate,
  advanceSingleNodeDeploymentJournal,
  prepareSingleNodeDeploymentReleaseUpdate,
  recordSingleNodeDeploymentActivation,
  settleSingleNodeDeploymentReleaseTransition,
  validateSingleNodeDeploymentJournal,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
  getSingleNodeRemoteArtifactPaths,
} from '../../src/core/runtime/single-node-remote-activation.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from '../runtime/fixtures/single-node-status-fixture.js';

/** @typedef {Readonly<Record<string, any>>} Document */
/** @type {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} */
let fixture;
/** @type {Document} */
let state;
/** @type {Document} */
let targetB;
/** @type {Document} */
let targetC;
/** @type {Document} */
let activeA;
/** @type {Document} */
let pendingB;
/** @type {Document} */
let activeB;
/** @type {Document} */
let pendingA;
/** @type {Document} */
let restoredA;
/** @type {Document} */
let foreignDeployment;

/**
 * Produce complete, hashed activation evidence through the public journal
 * transitions so scope tests never rely on malformed journal documents.
 * @param {Document} pending - Prepared release transition.
 * @returns {Document} - Valid activation record for the exact target.
 */
function activate(pending) {
  const desired = pending.release.transition.target.desired;
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
      ...desired.artifact,
      remotePath: getSingleNodeRemoteArtifactPaths(
        desired,
        fixture.incarnationId,
      ).remoteArtifactPath,
    },
    service: {
      appId: desired.intent.appId,
      unit: `wharfie-${desired.intent.appId}.service`,
      health: 'healthy',
      activeArtifactId: desired.artifact.artifactId,
      activeRevisionId: desired.artifact.revisionId,
    },
  });
  return recordSingleNodeDeploymentActivation(pending, {
    ...payload,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: payload,
      valuePath: 'liveDeploymentJournalTest.activation',
    }),
  });
}

beforeAll(async () => {
  fixture = await createSingleNodeStatusAuthorityFixture({
    deploymentId: 'acceptance-journal-scope',
  });
  foreignDeployment = await createSingleNodeStatusAuthorityFixture({
    deploymentId: 'acceptance-other-deployment',
  });
  targetB = createSingleNodeStatusUpdateTarget(fixture, 'accepted-b');
  targetC = createSingleNodeStatusUpdateTarget(fixture, 'unaccepted-c');
  activeA = createSingleNodeStatusActiveJournal(fixture);
  pendingB = prepareSingleNodeDeploymentReleaseUpdate(activeA, targetB.desired);
  activeB = settleSingleNodeDeploymentReleaseTransition(activate(pendingB));
  pendingA = prepareSingleNodeDeploymentReleaseUpdate(activeB, fixture.desired);
  restoredA = settleSingleNodeDeploymentReleaseTransition(activate(pendingA));
  state = {
    appId: fixture.desired.intent.appId,
    deploymentId: fixture.desired.intent.deployment.id,
    deploymentInstanceId: fixture.desired.deploymentInstanceId,
    provider: 'hetzner',
    placement: 'fsn1',
    allowedIpv4: '203.0.113.7/32',
    desiredRevisionId: fixture.desired.desiredRevisionId,
    guestArtifactId: fixture.artifactRecord.artifactId,
    guestRevisionId: fixture.artifactRecord.revisionId,
    nextRelease: {
      desiredRevisionId: targetB.desired.desiredRevisionId,
      guestArtifactId: targetB.artifactRecord.artifactId,
      guestRevisionId: targetB.artifactRecord.revisionId,
    },
  };
});

describe('live acceptance journal scope across the packaged release pair', () => {
  it('accepts valid pending, restored, settled, and destroying journals while preserving original substrate A', () => {
    const journals = [
      activeA,
      pendingB,
      activate(pendingB),
      abandonSingleNodeDeploymentReleaseUpdate(pendingB),
      activeB,
      pendingA,
      activate(pendingA),
      restoredA,
      advanceSingleNodeDeploymentJournal(pendingB, 'destroying'),
      advanceSingleNodeDeploymentJournal(activeB, 'destroying'),
      advanceSingleNodeDeploymentJournal(pendingA, 'destroying'),
    ];
    for (const journal of journals) {
      expect(validateSingleNodeDeploymentJournal(journal)).toEqual(journal);
      expect(journal.providerIntent).toEqual(activeA.providerIntent);
      expect(journal.resources).toEqual(activeA.resources);
      expect(journal.incarnationId).toBe(activeA.incarnationId);
      expect(() =>
        assertLiveDeploymentJournalScope(journal, state),
      ).not.toThrow();
    }
    expect(activeB.release.current.desired).toEqual(targetB.desired);
    expect(activeB.release.rollback.desired).toEqual(fixture.desired);
    expect(pendingA.release.current.desired).toEqual(targetB.desired);
    expect(pendingA.release.transition.target.desired).toEqual(fixture.desired);
    expect(restoredA.release.current.desired).toEqual(fixture.desired);
    expect(restoredA.release.rollback.desired).toEqual(targetB.desired);
  });

  it('keeps earlier one-release cleanup authority valid without authorizing B', () => {
    const { nextRelease, ...singleReleaseState } = state;
    expect(nextRelease).toBeDefined();
    expect(() =>
      assertLiveDeploymentJournalScope(activeA, singleReleaseState),
    ).not.toThrow();
    expect(() =>
      assertLiveDeploymentJournalScope(pendingB, singleReleaseState),
    ).toThrow('outside the accepted package pair');
  });

  it.each(['current', 'rollback', 'target'])(
    'rejects a third valid release in %s authority',
    (role) => {
      const pendingC = prepareSingleNodeDeploymentReleaseUpdate(
        activeA,
        targetC.desired,
      );
      const activeC = settleSingleNodeDeploymentReleaseTransition(
        activate(pendingC),
      );
      const currentBWithRollbackC = settleSingleNodeDeploymentReleaseTransition(
        activate(
          prepareSingleNodeDeploymentReleaseUpdate(activeC, targetB.desired),
        ),
      );
      const journal =
        role === 'current'
          ? activeC
          : role === 'rollback'
            ? currentBWithRollbackC
            : pendingC;
      expect(validateSingleNodeDeploymentJournal(journal)).toEqual(journal);
      expect(() => assertLiveDeploymentJournalScope(journal, state)).toThrow(
        'outside the accepted package pair',
      );
    },
  );

  it.each(['desiredRevisionId', 'guestArtifactId', 'guestRevisionId'])(
    'requires the exact authorized B %s',
    (field) => {
      /** @type {Record<string, string>} */
      const replacement = {
        desiredRevisionId: targetC.desired.desiredRevisionId,
        guestArtifactId: targetC.artifactRecord.artifactId,
        guestRevisionId: targetC.artifactRecord.revisionId,
      };
      expect(() =>
        assertLiveDeploymentJournalScope(pendingB, {
          ...state,
          nextRelease: { ...state.nextRelease, [field]: replacement[field] },
        }),
      ).toThrow('outside the accepted package pair');
    },
  );

  it('does not replace original substrate A with the now-current B identity', () => {
    expect(activeB.providerIntent.intent.plan.desired).toEqual(fixture.desired);
    expect(() =>
      assertLiveDeploymentJournalScope(activeB, {
        ...state,
        desiredRevisionId: targetB.desired.desiredRevisionId,
      }),
    ).toThrow();
  });

  it.each([
    ['appId', 'another-app'],
    ['deploymentId', 'acceptance-other-deployment'],
    ['provider', 'aws'],
    ['placement', 'hel1'],
    ['allowedIpv4', '203.0.113.8/32'],
  ])('rejects a different acceptance %s scope', (field, value) => {
    expect(() =>
      assertLiveDeploymentJournalScope(activeB, { ...state, [field]: value }),
    ).toThrow();
  });

  it('rejects another canonical deployment instance in the retained state', () => {
    expect(() =>
      assertLiveDeploymentJournalScope(pendingA, {
        ...state,
        deploymentInstanceId: foreignDeployment.desired.deploymentInstanceId,
      }),
    ).toThrow();
  });
});
