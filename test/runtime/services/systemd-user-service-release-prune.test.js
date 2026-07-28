/* eslint-env jest */

import { describe, expect, it } from '@jest/globals';

import {
  SYSTEMD_USER_SERVICE_RELEASE_PRUNE_KIND,
  createSystemdUserServiceReleasePruneReceipt,
  createSystemdUserServiceReleasePruneTombstoneName,
  parseSystemdUserServiceReleasePruneTombstoneName,
  validateSystemdUserServiceReleasePruneReceipt,
} from '../../../src/core/runtime/services/systemd-user-service-release-prune.js';

const SELECTED = Object.freeze({
  artifactId: `waf1_${Buffer.alloc(32, 1).toString('base64url')}`,
  revisionId: `wrv1_${Buffer.alloc(32, 2).toString('base64url')}`,
});
const ROLLBACK = Object.freeze({
  artifactId: `waf1_${Buffer.alloc(32, 3).toString('base64url')}`,
  revisionId: SELECTED.revisionId,
});
const REMOVED = Object.freeze({
  artifactId: `waf1_${Buffer.alloc(32, 4).toString('base64url')}`,
  revisionId: SELECTED.revisionId,
  artifactBytes: 123,
});
const OTHER_REVISION_ID = `wrv1_${Buffer.alloc(32, 5).toString('base64url')}`;

function makeReceipt(overrides = {}) {
  return {
    appId: 'service-demo',
    outcome: 'pruned',
    installationState: 'installed',
    selected: SELECTED,
    rollback: ROLLBACK,
    scannedReleaseCount: 3,
    retainedReleaseCount: 2,
    remainingReleaseCount: 2,
    removed: [REMOVED],
    removedCount: 1,
    removedArtifactBytes: 123,
    resumedPruneCount: 0,
    recoveredStagingCount: 0,
    ...overrides,
  };
}

describe('systemd user-service release-prune contract', () => {
  it('creates one exact recursively frozen receipt', () => {
    const receipt = createSystemdUserServiceReleasePruneReceipt(makeReceipt());

    expect(receipt).toEqual({
      schemaVersion: 1,
      kind: SYSTEMD_USER_SERVICE_RELEASE_PRUNE_KIND,
      action: 'prune',
      requestStatus: 'fulfilled',
      ...makeReceipt(),
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.selected)).toBe(true);
    expect(Object.isFrozen(receipt.rollback)).toBe(true);
    expect(Object.isFrozen(receipt.removed)).toBe(true);
    expect(Object.isFrozen(receipt.removed[0])).toBe(true);
  });

  it('accepts an exact no-op receipt and rejects inconsistent counts or extras', () => {
    expect(
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({
          outcome: 'nothing-to-prune',
          rollback: null,
          scannedReleaseCount: 1,
          retainedReleaseCount: 1,
          remainingReleaseCount: 1,
          removed: [],
          removedCount: 0,
          removedArtifactBytes: 0,
        }),
      ),
    ).toMatchObject({
      outcome: 'nothing-to-prune',
      removed: [],
      rollback: null,
    });
    expect(() =>
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({ removedCount: 0 }),
      ),
    ).toThrow(/counts are inconsistent/);
    expect(() =>
      validateSystemdUserServiceReleasePruneReceipt({
        ...createSystemdUserServiceReleasePruneReceipt(makeReceipt()),
        privatePath: '/secret',
      }),
    ).toThrow(/unsupported or missing fields/);
  });

  it('counts recovered staging cleanup as a pruning change', () => {
    expect(
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({
          outcome: 'pruned',
          rollback: null,
          scannedReleaseCount: 1,
          retainedReleaseCount: 1,
          remainingReleaseCount: 1,
          removed: [],
          removedCount: 0,
          removedArtifactBytes: 0,
          recoveredStagingCount: 1,
        }),
      ),
    ).toMatchObject({
      outcome: 'pruned',
      removedCount: 0,
      resumedPruneCount: 0,
      recoveredStagingCount: 1,
    });
    expect(() =>
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({
          outcome: 'nothing-to-prune',
          rollback: null,
          scannedReleaseCount: 1,
          retainedReleaseCount: 1,
          remainingReleaseCount: 1,
          removed: [],
          removedCount: 0,
          removedArtifactBytes: 0,
          recoveredStagingCount: 1,
        }),
      ),
    ).toThrow(/outcome does not match/);
  });

  it('requires artifact IDs to be unique across every receipt role', () => {
    expect(() =>
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({
          rollback: {
            artifactId: SELECTED.artifactId,
            revisionId: OTHER_REVISION_ID,
          },
        }),
      ),
    ).toThrow(/rollback artifactId must differ/);
    expect(() =>
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({
          removed: [
            {
              artifactId: SELECTED.artifactId,
              revisionId: OTHER_REVISION_ID,
              artifactBytes: REMOVED.artifactBytes,
            },
          ],
        }),
      ),
    ).toThrow(/protected release/);
    expect(() =>
      createSystemdUserServiceReleasePruneReceipt(
        makeReceipt({
          scannedReleaseCount: 4,
          removed: [
            REMOVED,
            {
              ...REMOVED,
              revisionId: OTHER_REVISION_ID,
            },
          ],
          removedCount: 2,
          removedArtifactBytes: REMOVED.artifactBytes * 2,
        }),
      ),
    ).toThrow(/artifactId duplicates/);
  });

  it('round-trips only exact deterministic prune tombstone names', () => {
    const name = createSystemdUserServiceReleasePruneTombstoneName({
      ...REMOVED,
      size: REMOVED.artifactBytes,
    });

    expect(parseSystemdUserServiceReleasePruneTombstoneName(name)).toEqual({
      artifactId: REMOVED.artifactId,
      revisionId: REMOVED.revisionId,
      artifactBytes: REMOVED.artifactBytes,
    });
    expect(
      parseSystemdUserServiceReleasePruneTombstoneName(`${name}.extra`),
    ).toBeNull();
    expect(
      parseSystemdUserServiceReleasePruneTombstoneName(
        '.wharfie-release-prune-v1.not-an-artifact.not-a-revision.1',
      ),
    ).toBeNull();
  });
});
