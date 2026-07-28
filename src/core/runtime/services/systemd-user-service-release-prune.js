/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc parser. */

import { assertApplicationRevisionId } from '../application-revision.js';
import { assertArtifactId } from '../artifact-record.js';
import { assertLogicalId } from '../logical-id.js';

export const SYSTEMD_USER_SERVICE_RELEASE_PRUNE_SCHEMA_VERSION = 1;
export const SYSTEMD_USER_SERVICE_RELEASE_PRUNE_KIND =
  'wharfie.service.release-prune';
export const SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES = 128;
export const SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES =
  64 * 1024 * 1024 * 1024;

const TOMBSTONE_PREFIX = '.wharfie-release-prune-v1.';
const RECEIPT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'action',
  'requestStatus',
  'appId',
  'outcome',
  'installationState',
  'selected',
  'rollback',
  'scannedReleaseCount',
  'retainedReleaseCount',
  'remainingReleaseCount',
  'removed',
  'removedCount',
  'removedArtifactBytes',
  'resumedPruneCount',
  'recoveredStagingCount',
]);
const REFERENCE_KEYS = new Set(['artifactId', 'revisionId']);
const REMOVED_RELEASE_KEYS = new Set([
  'artifactId',
  'revisionId',
  'artifactBytes',
]);

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expected - Exact supported fields.
 * @param {string} label - Boundary label.
 * @returns {void} - Returns after exact-key validation.
 */
function assertExactKeys(value, expected, label) {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
}

/**
 * @param {unknown} value - Candidate JSON object.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Plain object.
 */
function requireObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value - Candidate count or byte length.
 * @param {string} label - Boundary label.
 * @param {number} maximum - Inclusive upper bound.
 * @returns {number} - Validated integer.
 */
function boundedNonnegativeInteger(value, label, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw new TypeError(
      `${label} must be a nonnegative safe integer no greater than ${maximum}.`,
    );
  }
  return Number(value);
}

/**
 * @param {unknown} value - Release-reference candidate.
 * @param {string} label - Boundary label.
 * @returns {Readonly<{artifactId: string, revisionId: string}>} - Exact reference.
 */
function validateReleaseReference(value, label) {
  const reference = requireObject(value, label);
  assertExactKeys(reference, REFERENCE_KEYS, label);
  assertArtifactId(reference.artifactId, `${label}.artifactId`);
  assertApplicationRevisionId(reference.revisionId, `${label}.revisionId`);
  return Object.freeze({
    artifactId: reference.artifactId,
    revisionId: reference.revisionId,
  });
}

/**
 * @param {unknown} value - Candidate prune receipt.
 * @param {string} [label] - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical recursively frozen receipt.
 */
export function validateSystemdUserServiceReleasePruneReceipt(
  value,
  label = 'systemd user service release-prune receipt',
) {
  const receipt = requireObject(value, label);
  assertExactKeys(receipt, RECEIPT_KEYS, label);
  if (
    receipt.schemaVersion !==
      SYSTEMD_USER_SERVICE_RELEASE_PRUNE_SCHEMA_VERSION ||
    receipt.kind !== SYSTEMD_USER_SERVICE_RELEASE_PRUNE_KIND ||
    receipt.action !== 'prune' ||
    receipt.requestStatus !== 'fulfilled'
  ) {
    throw new TypeError(`${label} has an unsupported protocol identity.`);
  }
  assertLogicalId(receipt.appId, `${label}.appId`);
  if (receipt.outcome !== 'pruned' && receipt.outcome !== 'nothing-to-prune') {
    throw new TypeError(`${label}.outcome is unsupported.`);
  }
  if (
    receipt.installationState !== 'installed' &&
    receipt.installationState !== 'uninstalled'
  ) {
    throw new TypeError(`${label}.installationState is unsupported.`);
  }
  const selected = validateReleaseReference(
    receipt.selected,
    `${label}.selected`,
  );
  const rollback =
    receipt.rollback === null
      ? null
      : validateReleaseReference(receipt.rollback, `${label}.rollback`);
  const protectedArtifactIds = new Set([selected.artifactId]);
  if (rollback) {
    if (protectedArtifactIds.has(rollback.artifactId)) {
      throw new TypeError(
        `${label}.rollback artifactId must differ from selected.`,
      );
    }
    protectedArtifactIds.add(rollback.artifactId);
  }

  const scannedReleaseCount = boundedNonnegativeInteger(
    receipt.scannedReleaseCount,
    `${label}.scannedReleaseCount`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  );
  const retainedReleaseCount = boundedNonnegativeInteger(
    receipt.retainedReleaseCount,
    `${label}.retainedReleaseCount`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  );
  const remainingReleaseCount = boundedNonnegativeInteger(
    receipt.remainingReleaseCount,
    `${label}.remainingReleaseCount`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  );
  const removedCount = boundedNonnegativeInteger(
    receipt.removedCount,
    `${label}.removedCount`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  );
  const resumedPruneCount = boundedNonnegativeInteger(
    receipt.resumedPruneCount,
    `${label}.resumedPruneCount`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  );
  const recoveredStagingCount = boundedNonnegativeInteger(
    receipt.recoveredStagingCount,
    `${label}.recoveredStagingCount`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  );
  if (
    scannedReleaseCount + resumedPruneCount + recoveredStagingCount >
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES
  ) {
    throw new TypeError(`${label} exceeds the bounded release namespace.`);
  }
  const expectedRetainedCount = rollback === null ? 1 : 2;
  if (
    retainedReleaseCount !== expectedRetainedCount ||
    remainingReleaseCount !== retainedReleaseCount ||
    scannedReleaseCount !== retainedReleaseCount + removedCount
  ) {
    throw new TypeError(`${label} release counts are inconsistent.`);
  }
  if (
    !Array.isArray(receipt.removed) ||
    receipt.removed.length !== removedCount
  ) {
    throw new TypeError(`${label}.removed does not match removedCount.`);
  }

  /** @type {Array<Readonly<{artifactId: string, revisionId: string, artifactBytes: number}>>} */
  const removed = [];
  let removedArtifactBytes = 0;
  let previousArtifactId = null;
  const removedArtifactIds = new Set();
  for (let index = 0; index < receipt.removed.length; index += 1) {
    const entryLabel = `${label}.removed[${index}]`;
    const entry = requireObject(receipt.removed[index], entryLabel);
    assertExactKeys(entry, REMOVED_RELEASE_KEYS, entryLabel);
    const reference = validateReleaseReference(
      {
        artifactId: entry.artifactId,
        revisionId: entry.revisionId,
      },
      entryLabel,
    );
    if (protectedArtifactIds.has(reference.artifactId)) {
      throw new TypeError(`${entryLabel} is a protected release.`);
    }
    if (removedArtifactIds.has(reference.artifactId)) {
      throw new TypeError(
        `${entryLabel}.artifactId duplicates another removed release.`,
      );
    }
    const artifactBytes = boundedNonnegativeInteger(
      entry.artifactBytes,
      `${entryLabel}.artifactBytes`,
      SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
    );
    removedArtifactBytes += artifactBytes;
    if (
      !Number.isSafeInteger(removedArtifactBytes) ||
      removedArtifactBytes >
        SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES
    ) {
      throw new TypeError(`${label}.removed exceeds the artifact-byte limit.`);
    }
    if (
      previousArtifactId !== null &&
      reference.artifactId <= previousArtifactId
    ) {
      throw new TypeError(
        `${label}.removed must be uniquely sorted by artifactId.`,
      );
    }
    previousArtifactId = reference.artifactId;
    removedArtifactIds.add(reference.artifactId);
    removed.push(
      Object.freeze({
        artifactId: reference.artifactId,
        revisionId: reference.revisionId,
        artifactBytes,
      }),
    );
  }
  const declaredRemovedBytes = boundedNonnegativeInteger(
    receipt.removedArtifactBytes,
    `${label}.removedArtifactBytes`,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
  );
  if (declaredRemovedBytes !== removedArtifactBytes) {
    throw new TypeError(
      `${label}.removedArtifactBytes does not match removed releases.`,
    );
  }
  const changed =
    removedCount !== 0 ||
    resumedPruneCount !== 0 ||
    recoveredStagingCount !== 0;
  if (
    (changed && receipt.outcome !== 'pruned') ||
    (!changed && receipt.outcome !== 'nothing-to-prune')
  ) {
    throw new TypeError(`${label}.outcome does not match completed pruning.`);
  }

  return Object.freeze({
    schemaVersion: SYSTEMD_USER_SERVICE_RELEASE_PRUNE_SCHEMA_VERSION,
    kind: SYSTEMD_USER_SERVICE_RELEASE_PRUNE_KIND,
    action: 'prune',
    requestStatus: 'fulfilled',
    appId: receipt.appId,
    outcome: receipt.outcome,
    installationState: receipt.installationState,
    selected,
    rollback,
    scannedReleaseCount,
    retainedReleaseCount,
    remainingReleaseCount,
    removed: Object.freeze(removed),
    removedCount,
    removedArtifactBytes: declaredRemovedBytes,
    resumedPruneCount,
    recoveredStagingCount,
  });
}

/**
 * @param {Record<string, any>} input - Receipt fields.
 * @returns {Readonly<Record<string, any>>} - Canonical prune receipt.
 */
export function createSystemdUserServiceReleasePruneReceipt(input) {
  return validateSystemdUserServiceReleasePruneReceipt({
    schemaVersion: SYSTEMD_USER_SERVICE_RELEASE_PRUNE_SCHEMA_VERSION,
    kind: SYSTEMD_USER_SERVICE_RELEASE_PRUNE_KIND,
    action: 'prune',
    requestStatus: 'fulfilled',
    ...input,
  });
}

/**
 * Create the deterministic same-directory crash-recovery name for one exact
 * release. The name contains only already-validated portable identifiers and
 * the logical artifact byte length; it is not a caller-controlled path.
 * @param {Readonly<Record<string, any>>} release - Exact release record.
 * @returns {string} - Deterministic tombstone basename.
 */
export function createSystemdUserServiceReleasePruneTombstoneName(release) {
  const reference = validateReleaseReference(
    {
      artifactId: release?.artifactId,
      revisionId: release?.revisionId,
    },
    'systemd user service release-prune tombstone release',
  );
  const artifactBytes = boundedNonnegativeInteger(
    release.size,
    'systemd user service release-prune tombstone release.size',
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
  );
  return `${TOMBSTONE_PREFIX}${reference.artifactId}.${reference.revisionId}.${artifactBytes}`;
}

/**
 * Parse only the deterministic V1 prune tombstone namespace.
 * @param {string} name - Directory basename.
 * @returns {Readonly<{artifactId: string, revisionId: string, artifactBytes: number}> | null} - Parsed identity or null.
 */
export function parseSystemdUserServiceReleasePruneTombstoneName(name) {
  if (typeof name !== 'string' || !name.startsWith(TOMBSTONE_PREFIX)) {
    return null;
  }
  const parts = name.slice(TOMBSTONE_PREFIX.length).split('.');
  if (
    parts.length !== 3 ||
    !/^(0|[1-9][0-9]*)$/.test(parts[2]) ||
    parts[2].length > 16
  ) {
    return null;
  }
  try {
    const reference = validateReleaseReference(
      {
        artifactId: parts[0],
        revisionId: parts[1],
      },
      'systemd user service release-prune tombstone',
    );
    const artifactBytes = boundedNonnegativeInteger(
      Number(parts[2]),
      'systemd user service release-prune tombstone.artifactBytes',
      SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
    );
    return Object.freeze({
      artifactId: reference.artifactId,
      revisionId: reference.revisionId,
      artifactBytes,
    });
  } catch {
    return null;
  }
}

export default createSystemdUserServiceReleasePruneReceipt;
