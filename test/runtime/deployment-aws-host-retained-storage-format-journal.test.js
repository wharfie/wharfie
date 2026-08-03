import { beforeAll, describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL,
  advanceAwsSingleNodeHostRetainedStorageFormatJournal,
  createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal,
  createAwsSingleNodeHostRetainedStorageBlankFormatProof,
  createAwsSingleNodeHostRetainedStorageExactProfileFormatProof,
  createAwsSingleNodeHostRetainedStoragePreparedFormatJournal,
  getAwsSingleNodeHostRetainedStorageFormatTarget,
  getAwsSingleNodeHostRetainedStorageProfileMarkerBytes,
  getAwsSingleNodeHostRetainedStorageProfileMarkerId,
  getAwsSingleNodeHostRetainedStorageProfileMarkerText,
  validateAwsSingleNodeHostRetainedStorageBlankFormatProof,
  validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof,
  validateAwsSingleNodeHostRetainedStorageFormatJournal,
  validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired,
  validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor,
  validateAwsSingleNodeHostRetainedStorageFormatTarget,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-format-journal.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from '../../src/core/runtime/deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
} from '../../src/core/runtime/deployment-aws-host-runtime-account.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const RUNTIME_UID = AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID;
const RUNTIME_GID = AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID;
const EXPECTED_PROFILE_FEATURES = Object.freeze([
  '64bit',
  'dir_index',
  'dir_nlink',
  'ext_attr',
  'extent',
  'extra_isize',
  'filetype',
  'flex_bg',
  'has_journal',
  'huge_file',
  'large_file',
  'metadata_csum',
  'sparse_super',
]);
/** @type {Readonly<AnyRecord>} */
let request;
/** @type {Readonly<AnyRecord>} */
let desired;
/** @type {Readonly<AnyRecord>} */
let reconcileDesired;
/** @type {string} */
let intentId;
/** @type {string} */
let reconcileIntentId;
/** @type {string} */
let controlIntentId;

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Readonly<AnyRecord>} value @returns {AnyRecord} */
function mutableClone(value) {
  return /** @type {AnyRecord} */ (clone(value));
}

/** @param {Readonly<AnyRecord>} requestValue @returns {Readonly<AnyRecord>} */
function runtimeEvidence(requestValue) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: requestValue.requestId,
    accountId: requestValue.providerScope.accountId,
    userId: `${requestValue.runtimeRoleId}:${requestValue.nodeProviderResourceId}`,
    arn: `arn:${requestValue.providerScope.partition}:sts::${requestValue.providerScope.accountId}:assumed-role/${requestValue.runtimeRoleName}/${requestValue.nodeProviderResourceId}`,
  });
}

/**
 * Capture the production adapter's exact desired contract rather than
 * duplicating it in this test.
 * @param {Readonly<AnyRecord>} requestValue - Exact activation request.
 * @returns {Promise<Readonly<AnyRecord>>} - Adapter-emitted desired state.
 */
async function captureDesired(requestValue) {
  /** @type {Readonly<AnyRecord>|undefined} */
  let captured;
  const adapter = createAwsSingleNodeHostApplicationStorageAdapter({
    command: {
      inspect(/** @type {Readonly<AnyRecord>} */ candidate) {
        captured = candidate;
        return { status: 'ready' };
      },
      converge() {
        throw new Error('desired capture must not converge');
      },
    },
  });
  await adapter.observe(
    deepFreeze({
      request: requestValue,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          requestValue,
          'application-storage',
        ),
        kind: 'application-storage',
        attemptGeneration: 0,
      },
      priorEvidence: {
        'runtime-identity': runtimeEvidence(requestValue),
      },
    }),
  );
  if (captured === undefined) throw new Error('desired state was not captured');
  return captured;
}

/** @param {Readonly<AnyRecord>} desiredValue @param {number} minor @returns {Readonly<AnyRecord>} */
function proofDevice(desiredValue, minor) {
  return deepFreeze({
    path: `/dev/nvme${minor}n1`,
    major: 259,
    minor,
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: desiredValue.volumeProviderResourceId,
    byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
      desiredValue.volumeProviderResourceId,
    ),
    byIdTarget: `../../nvme${minor}n1`,
  });
}

/** @param {Readonly<AnyRecord>} desiredValue @returns {Readonly<AnyRecord>} */
function exactProfile(desiredValue) {
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desiredValue);
  return deepFreeze({
    profileId: 'wharfie-ext4-v1',
    markerId: getAwsSingleNodeHostRetainedStorageProfileMarkerId(target),
    filesystem: {
      type: 'ext4',
      uuid: target.filesystem.uuid,
      label: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL,
      blockSizeBytes: 4096,
      inodeSizeBytes: 256,
      reservedBlockCount: 0,
      creatorOs: 'Linux',
      revision: 'dynamic',
      errorsBehavior: 'remount-ro',
      defaultMountOptions: [],
      directoryHashAlgorithm: 'half_md4',
      directoryHashSeed: target.filesystem.uuid,
      features: [...EXPECTED_PROFILE_FEATURES],
    },
    journal: {
      kind: 'internal',
      inode: 8,
      sizeBytes: 134_217_728,
    },
    root: {
      inode: 2,
      type: 'directory',
      uid: RUNTIME_UID,
      gid: RUNTIME_GID,
      mode: 0o700,
    },
    initialization: {
      filesystemState: 'clean',
      fullReadOnlyCheck: 'clean',
      completionMarkerXattr: 'trusted.wharfie.profile',
    },
  });
}

/** @param {Readonly<AnyRecord>} desiredValue @param {'blank'|'exact-profile'} classification @param {number} [minor] @returns {Readonly<AnyRecord>} */
function createProof(desiredValue, classification, minor = 1) {
  const base = {
    desired: desiredValue,
    device: proofDevice(desiredValue, minor),
    mountNamespace: 'mnt:[4026531841]',
  };
  return classification === 'blank'
    ? createAwsSingleNodeHostRetainedStorageBlankFormatProof(base)
    : createAwsSingleNodeHostRetainedStorageExactProfileFormatProof({
        ...base,
        profile: exactProfile(desiredValue),
      });
}

/** @param {unknown} value @returns {number} */
function encodedJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** @param {Readonly<AnyRecord>} journal @param {string} nextIntentId @returns {AnyRecord} */
function replaceJournalIntent(journal, nextIntentId) {
  const candidate = mutableClone(journal);
  candidate.attempt.intentId = nextIntentId;
  const payload = { ...candidate };
  delete payload.journalId;
  candidate.journalId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX,
    value: payload,
    valuePath: 'test retained-storage format journal',
  });
  return candidate;
}

/** @param {Readonly<AnyRecord>} desiredValue @param {Readonly<AnyRecord>} blankProof @param {number} [attemptGeneration] @returns {Readonly<AnyRecord>} */
function createPrepared(desiredValue, blankProof, attemptGeneration = 0) {
  return createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
    desired: desiredValue,
    intentId,
    attemptGeneration,
    blankProof,
  });
}

beforeAll(async () => {
  const fixture = makeFixture();
  request = createAwsSingleNodeHostActivationRequest(fixture.requestContext);
  const reconcileRequest = createAwsSingleNodeHostActivationRequest(
    makeReconcileFixture(fixture).requestContext,
  );
  desired = await captureDesired(request);
  reconcileDesired = await captureDesired(reconcileRequest);
  intentId = getAwsSingleNodeHostActivationIntentId(
    request,
    'application-storage',
  );
  reconcileIntentId = getAwsSingleNodeHostActivationIntentId(
    reconcileRequest,
    'application-storage',
  );
  controlIntentId = getAwsSingleNodeHostActivationIntentId(
    request,
    'control-storage',
  );
});

describe('AWS single-node retained-storage format journal', () => {
  it('derives one stable physical-media target across volatile request, node, attachment, and mount state', () => {
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
    const reconciled =
      getAwsSingleNodeHostRetainedStorageFormatTarget(reconcileDesired);

    expect(reconciled).toEqual(target);
    expect(target).toMatchObject({
      schemaVersion: 1,
      kind: 'awsSingleNodeHostRetainedStorageFormatTarget',
      targetId: expect.stringMatching(
        new RegExp(
          `^${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_PREFIX}_`,
          'u',
        ),
      ),
      providerScopeId: desired.providerScopeId,
      deploymentInstanceId: desired.deploymentInstanceId,
      incarnationId: desired.incarnationId,
      appId: desired.appId,
      capabilityKind: 'application-state',
      volumeProviderResourceId: desired.volumeProviderResourceId,
      sizeBytes: desired.sizeBytes,
      createdWithoutSnapshot: true,
      filesystem: desired.filesystem,
    });
    for (const excluded of [
      'requestId',
      'nodeProviderResourceId',
      'volumeBindingId',
      'attachmentBindingId',
      'attachmentProviderResourceId',
      'mount',
      'directory',
      'bootWiring',
    ]) {
      expect(target).not.toHaveProperty(excluded);
    }
    const independentlyValidated =
      validateAwsSingleNodeHostRetainedStorageFormatTarget(target);
    expect(independentlyValidated).toEqual(target);
    expect(independentlyValidated).not.toBe(target);
    expectDeepFrozen(target);

    const changedSize = mutableClone(desired);
    changedSize.sizeBytes += 1;
    expect(
      getAwsSingleNodeHostRetainedStorageFormatTarget(changedSize).targetId,
    ).not.toBe(target.targetId);

    const changedHostIds = mutableClone(desired);
    changedHostIds.nodeProviderResourceId = 'i-0123456789abcdef0';
    expect(
      getAwsSingleNodeHostRetainedStorageFormatTarget(changedHostIds),
    ).toEqual(target);

    const changedRuntimeIds = mutableClone(desired);
    changedRuntimeIds.directory.uid += 1;
    expect(() =>
      getAwsSingleNodeHostRetainedStorageFormatTarget(changedRuntimeIds),
    ).toThrow(
      /pinned runtime UID and GID|exact fixed wharfie-runtime account/iu,
    );
  });

  it('normalizes distinct blank and exact-profile integrity proofs without raw tool output', () => {
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
    const blank = createProof(desired, 'blank');
    const profile = createProof(desired, 'exact-profile');

    expect(blank).toEqual({
      schemaVersion: 1,
      kind: 'awsSingleNodeHostRetainedStorageBlankFormatProof',
      proofId: expect.stringMatching(
        new RegExp(
          `^${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX}_`,
          'u',
        ),
      ),
      targetId: target.targetId,
      classification: 'blank',
      device: {
        path: '/dev/nvme1n1',
        major: 259,
        minor: 1,
        nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
        nvmeSerialVolumeId: desired.volumeProviderResourceId,
        byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
          desired.volumeProviderResourceId,
        ),
        byIdTarget: '../../nvme1n1',
      },
      safety: {
        stableObservationCount: 2,
        partitionCount: 0,
        holderCount: 0,
        mounted: false,
        bootEnabled: false,
        mountNamespace: 'mnt:[4026531841]',
      },
      profile: null,
    });
    expect(profile).toMatchObject({
      kind: 'awsSingleNodeHostRetainedStorageExactProfileFormatProof',
      proofId: expect.stringMatching(
        new RegExp(
          `^${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX}_`,
          'u',
        ),
      ),
      targetId: target.targetId,
      classification: 'exact-profile',
      profile: {
        profileId: 'wharfie-ext4-v1',
        markerId: getAwsSingleNodeHostRetainedStorageProfileMarkerId(target),
        filesystem: {
          label: 'wharfie-v1',
          blockSizeBytes: 4096,
          features: EXPECTED_PROFILE_FEATURES,
        },
        journal: {
          kind: 'internal',
          inode: 8,
          sizeBytes: 134_217_728,
        },
        root: {
          uid: RUNTIME_UID,
          gid: RUNTIME_GID,
          mode: 0o700,
        },
        initialization: {
          filesystemState: 'clean',
          fullReadOnlyCheck: 'clean',
          completionMarkerXattr: 'trusted.wharfie.profile',
        },
      },
    });
    expect(AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES).toEqual([
      '64bit',
      'dir_index',
      'dir_nlink',
      'ext_attr',
      'extent',
      'extra_isize',
      'filetype',
      'flex_bg',
      'has_journal',
      'huge_file',
      'large_file',
      'metadata_csum',
      'sparse_super',
    ]);
    expect(profile.proofId).not.toBe(blank.proofId);
    expect(JSON.stringify(blank)).not.toMatch(
      /stdout|stderr|command|timestamp/iu,
    );
    const validated = validateAwsSingleNodeHostRetainedStorageBlankFormatProof(
      blank,
      target,
    );
    expect(validated).toEqual(blank);
    expect(validated).not.toBe(blank);
    expect(
      validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof(
        profile,
        target,
      ),
    ).toEqual(profile);
    expectDeepFrozen(blank);
    expectDeepFrozen(profile);
  });

  it('projects exact canonical completion-marker xattr text and UTF-8 bytes without a terminator', () => {
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
    const text = getAwsSingleNodeHostRetainedStorageProfileMarkerText(target);
    const bytes = getAwsSingleNodeHostRetainedStorageProfileMarkerBytes(target);

    expect(text).toBe(
      `{"filesystemProfileId":"wharfie-ext4-v1","filesystemUuid":"${target.filesystem.uuid}","formatTargetId":"${target.targetId}","kind":"awsSingleNodeHostRetainedStorageProfileMarker","runtimeGid":60706,"runtimeUid":60706,"schemaVersion":1}`,
    );
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString('utf8')).toBe(text);
    expect(bytes.byteLength).toBe(Buffer.byteLength(text, 'utf8'));
    expect(text.endsWith('\n')).toBe(false);
    expect(text.includes('\0')).toBe(false);
    expect(bytes.includes(0x00)).toBe(false);
    expect(bytes.at(-1)).not.toBe(0x0a);
  });

  it('creates the exact prepared and formatted-from-blank history without changing its destructive attempt', () => {
    const blank = createProof(desired, 'blank');
    const profile = createProof(desired, 'exact-profile');
    const prepared = createPrepared(desired, blank);
    const formatted = advanceAwsSingleNodeHostRetainedStorageFormatJournal({
      journal: prepared,
      profileProof: profile,
    });

    expect(prepared).toMatchObject({
      schemaVersion: 1,
      kind: 'awsSingleNodeHostRetainedStorageFormatJournal',
      journalId: expect.stringMatching(
        new RegExp(
          `^${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX}_`,
          'u',
        ),
      ),
      recordVersion: 1,
      previousJournalId: null,
      phase: 'prepared',
      origin: 'blank-format',
      attempt: {
        requestId: request.requestId,
        intentId,
        attemptGeneration: 0,
      },
      blankProof: blank,
      profileProof: null,
    });
    expect(formatted).toMatchObject({
      recordVersion: 2,
      previousJournalId: prepared.journalId,
      phase: 'formatted',
      origin: 'blank-format',
      target: prepared.target,
      attempt: prepared.attempt,
      blankProof: prepared.blankProof,
      profileProof: profile,
    });
    expect(formatted.journalId).not.toBe(prepared.journalId);
    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournal(prepared),
    ).toEqual(prepared);
    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournal(formatted),
    ).toEqual(formatted);
    expectDeepFrozen(prepared);
    expectDeepFrozen(formatted);
  });

  it('binds each attempt intent to its exact request and retained-storage role', () => {
    const blank = createProof(desired, 'blank');
    const profile = createProof(desired, 'exact-profile');
    const prepared = createPrepared(desired, blank);
    const adversaries = [
      ['another valid request', reconcileIntentId],
      ['the valid control-storage role', controlIntentId],
    ];

    for (const [, wrongIntentId] of adversaries) {
      expect(wrongIntentId).toMatch(
        new RegExp(`^${intentId.slice(0, intentId.indexOf('_'))}_`, 'u'),
      );
      expect(wrongIntentId).not.toBe(intentId);
      expect(() =>
        createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
          desired,
          intentId: wrongIntentId,
          attemptGeneration: 0,
          blankProof: blank,
        }),
      ).toThrow(/exact request and retained-storage role/iu);
      expect(() =>
        createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
          desired,
          intentId: wrongIntentId,
          attemptGeneration: 0,
          profileProof: profile,
        }),
      ).toThrow(/exact request and retained-storage role/iu);

      const persisted = replaceJournalIntent(prepared, wrongIntentId);
      expect(() =>
        validateAwsSingleNodeHostRetainedStorageFormatJournal(persisted),
      ).toThrow(/exact request and retained-storage role/iu);
    }
  });

  it('allows direct recordVersion-1 adoption only from complete exact-profile proof', () => {
    const profile = createProof(desired, 'exact-profile');
    const adopted = createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
      desired,
      intentId,
      attemptGeneration: 0,
      profileProof: profile,
    });

    expect(adopted).toMatchObject({
      recordVersion: 1,
      previousJournalId: null,
      phase: 'formatted',
      origin: 'adopted-profile',
      blankProof: null,
      profileProof: profile,
    });
    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournal(adopted),
    ).toEqual(adopted);
    expect(() =>
      createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
        desired,
        intentId,
        attemptGeneration: 0,
        profileProof: createProof(desired, 'blank'),
      }),
    ).toThrow(/exact-profile proof/iu);
    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
        desired,
        intentId,
        attemptGeneration: 0,
        blankProof: profile,
      }),
    ).toThrow(/blank-media proof/iu);
  });

  it('accepts only initial v1 publication or the exact prepared-to-formatted successor', () => {
    const blank = createProof(desired, 'blank');
    const profile = createProof(desired, 'exact-profile');
    const prepared = createPrepared(desired, blank);
    const formatted = advanceAwsSingleNodeHostRetainedStorageFormatJournal({
      journal: prepared,
      profileProof: profile,
    });
    const adopted = createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
      desired,
      intentId,
      attemptGeneration: 0,
      profileProof: profile,
    });

    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        null,
        prepared,
      ),
    ).toEqual(prepared);
    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        null,
        adopted,
      ),
    ).toEqual(adopted);
    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        prepared,
        formatted,
      ),
    ).toEqual(formatted);
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        prepared,
        prepared,
      ),
    ).toThrow(/exact formatted successor/iu);
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        prepared,
        adopted,
      ),
    ).toThrow(/exact formatted successor/iu);
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        formatted,
        formatted,
      ),
    ).toThrow(/has no successor/iu);

    const otherBlank = createProof(desired, 'blank', 2);
    const rewrittenPrepared = createPrepared(desired, otherBlank);
    const rewrittenFormatted =
      advanceAwsSingleNodeHostRetainedStorageFormatJournal({
        journal: rewrittenPrepared,
        profileProof: createProof(desired, 'exact-profile', 2),
      });
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        prepared,
        rewrittenFormatted,
      ),
    ).toThrow(/exact formatted successor/iu);

    const laterAttempt = createPrepared(desired, blank, 2);
    const laterAttemptFormatted =
      advanceAwsSingleNodeHostRetainedStorageFormatJournal({
        journal: laterAttempt,
        profileProof: profile,
      });
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
        prepared,
        laterAttemptFormatted,
      ),
    ).toThrow(/exact formatted successor/iu);
  });

  it('rebinds history across request churn but fails closed on a changed stable media target', () => {
    const prepared = createPrepared(desired, createProof(desired, 'blank'));

    expect(
      validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired(
        prepared,
        reconcileDesired,
      ),
    ).toEqual(prepared);

    const changedSize = mutableClone(reconcileDesired);
    changedSize.sizeBytes += 1;
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired(
        prepared,
        changedSize,
      ),
    ).toThrow(/does not match the desired media target/iu);
  });

  it('rejects forged IDs, cross-target proofs, impossible record shapes, and non-data schemas', () => {
    const blank = createProof(desired, 'blank');
    const profile = createProof(desired, 'exact-profile');
    const prepared = createPrepared(desired, blank);
    const adopted = createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
      desired,
      intentId,
      attemptGeneration: 1,
      profileProof: profile,
    });

    const forgedTarget = mutableClone(prepared.target);
    const changedSize = mutableClone(desired);
    changedSize.sizeBytes += 1;
    forgedTarget.targetId =
      getAwsSingleNodeHostRetainedStorageFormatTarget(changedSize).targetId;
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatTarget(forgedTarget),
    ).toThrow(/does not match its exact target/iu);

    const forgedProof = mutableClone(blank);
    const otherBlank = createProof(desired, 'blank', 2);
    forgedProof.proofId = otherBlank.proofId;
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageBlankFormatProof(
        forgedProof,
        prepared.target,
      ),
    ).toThrow(/does not match its exact proof/iu);

    const wrongUuidTarget = mutableClone(prepared.target);
    wrongUuidTarget.filesystem.uuid = '00000000-0000-8000-8000-000000000000';
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatTarget(wrongUuidTarget),
    ).toThrow(/does not match its stable media authority/iu);

    const crossTargetProof = createProof(changedSize, 'blank');
    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
        desired,
        intentId,
        attemptGeneration: 0,
        blankProof: crossTargetProof,
      }),
    ).toThrow(/does not match its format target/iu);

    const forgedJournal = mutableClone(prepared);
    forgedJournal.journalId = adopted.journalId;
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournal(forgedJournal),
    ).toThrow(/does not match its exact journal/iu);

    const invalidShapes = [
      { phase: 'formatted' },
      { recordVersion: 2 },
      { origin: 'adopted-profile' },
      { blankProof: null },
      { profileProof: profile },
    ];
    for (const changes of invalidShapes) {
      expect(() =>
        validateAwsSingleNodeHostRetainedStorageFormatJournal({
          ...clone(prepared),
          ...changes,
        }),
      ).toThrow(/not one allowed journal state/iu);
    }

    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournal({
        ...clone(prepared),
        apiToken: 'not-a-real-secret',
      }),
    ).toThrow(/only its exact fields/iu);

    const accessor = clone(prepared);
    Object.defineProperty(accessor, 'phase', {
      enumerable: true,
      get() {
        throw new Error('journal accessor must not execute');
      },
    });
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournal(accessor),
    ).toThrow(/plain JSON property/iu);

    const symbol = mutableClone(prepared);
    Object.defineProperty(symbol, Symbol('hidden'), {
      enumerable: true,
      value: 'unsupported',
    });
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageFormatJournal(symbol),
    ).toThrow(/non-JSON symbol property/iu);
  });

  it('keeps factory documents within their byte caps and rejects oversized or aliased Linux identities', () => {
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
    const blank = createProof(desired, 'blank');
    const profile = createProof(desired, 'exact-profile');
    const prepared = createPrepared(desired, blank);
    const formatted = advanceAwsSingleNodeHostRetainedStorageFormatJournal({
      journal: prepared,
      profileProof: profile,
    });

    expect(encodedJsonBytes(target)).toBeLessThanOrEqual(
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_MAX_BYTES,
    );
    for (const proof of [blank, profile]) {
      expect(encodedJsonBytes(proof)).toBeLessThanOrEqual(
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
      );
    }
    for (const journal of [prepared, formatted]) {
      expect(encodedJsonBytes(journal)).toBeLessThanOrEqual(
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_MAX_BYTES,
      );
      expect(
        validateAwsSingleNodeHostRetainedStorageFormatJournal(journal),
      ).toEqual(journal);
    }

    for (const mountNamespace of [
      'mnt:[01]',
      'mnt:[18446744073709551616]',
      `mnt:[${'9'.repeat(10_000)}]`,
    ]) {
      expect(() =>
        createAwsSingleNodeHostRetainedStorageBlankFormatProof({
          desired,
          device: proofDevice(desired, 1),
          mountNamespace,
        }),
      ).toThrow(/mountNamespace is invalid/iu);
    }

    for (const devicePath of [
      '/dev/nvme01n1',
      '/dev/nvme1n0',
      `/dev/nvme${'9'.repeat(11)}n1`,
      '/dev/nvme4294967296n1',
      '/dev/nvme1n4294967296',
    ]) {
      const device = mutableClone(proofDevice(desired, 1));
      device.path = devicePath;
      expect(() =>
        createAwsSingleNodeHostRetainedStorageBlankFormatProof({
          desired,
          device,
          mountNamespace: 'mnt:[4026531841]',
        }),
      ).toThrow(/canonical NVMe device/iu);
    }

    const oversizedDevice = mutableClone(proofDevice(desired, 1));
    oversizedDevice.byIdTarget = `${'../'.repeat(6_000)}dev/nvme1n1`;
    expect(encodedJsonBytes(oversizedDevice)).toBeGreaterThan(
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
    );
    expect(() =>
      createAwsSingleNodeHostRetainedStorageBlankFormatProof({
        desired,
        device: oversizedDevice,
        mountNamespace: 'mnt:[4026531841]',
      }),
    ).toThrow(/encoded JSON must not exceed 16384 bytes/iu);

    const oversizedBlank = mutableClone(blank);
    oversizedBlank.safety.mountNamespace = `mnt:[${'9'.repeat(
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
    )}]`;
    expect(encodedJsonBytes(oversizedBlank)).toBeGreaterThan(
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
    );
    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
        desired,
        intentId,
        attemptGeneration: 0,
        blankProof: oversizedBlank,
      }),
    ).toThrow(/encoded JSON must not exceed 16384 bytes/iu);
  });

  it('rejects unsafe or unstable proof claims and exact factory input extras', () => {
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
    const blank = createProof(desired, 'blank');
    const unsafeClaims = /** @type {Array<[string, unknown]>} */ ([
      ['stableObservationCount', 1],
      ['partitionCount', 1],
      ['holderCount', 1],
      ['mounted', true],
      ['bootEnabled', true],
      ['mountNamespace', 'mnt:[0]'],
    ]);
    for (const [field, value] of unsafeClaims) {
      const candidate = mutableClone(blank);
      candidate.safety[field] = value;
      expect(() =>
        validateAwsSingleNodeHostRetainedStorageBlankFormatProof(
          candidate,
          target,
        ),
      ).toThrow(
        /two stable, offline, unwired observations|mountNamespace is invalid/iu,
      );
    }

    expect(() =>
      createAwsSingleNodeHostRetainedStorageBlankFormatProof({
        desired,
        device: {
          path: '/dev/nvme1n1',
          major: 259,
          minor: 1,
          nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
          nvmeSerialVolumeId: desired.volumeProviderResourceId,
          byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
            desired.volumeProviderResourceId,
          ),
          byIdTarget: '../../nvme1n1',
        },
        mountNamespace: 'mnt:[4026531841]',
        extra: true,
      }),
    ).toThrow(/only its exact fields/iu);

    expect(() =>
      createAwsSingleNodeHostRetainedStorageBlankFormatProof({
        desired,
        device: {
          path: '/dev/nvme1n1',
          major: 259,
          minor: 1,
          nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
          nvmeSerialVolumeId: desired.volumeProviderResourceId,
          byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
            desired.volumeProviderResourceId,
          ),
          byIdTarget: '../../../etc/passwd',
        },
        mountNamespace: 'mnt:[4026531841]',
      }),
    ).toThrow(/exact canonical readlink target/iu);

    const redundantTraversal = mutableClone(proofDevice(desired, 1));
    redundantTraversal.byIdTarget = '../../../dev/nvme1n1';
    expect(() =>
      createAwsSingleNodeHostRetainedStorageBlankFormatProof({
        desired,
        device: redundantTraversal,
        mountNamespace: 'mnt:[4026531841]',
      }),
    ).toThrow(/exact canonical readlink target/iu);
  });
});
