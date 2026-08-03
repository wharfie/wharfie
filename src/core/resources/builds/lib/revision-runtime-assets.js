import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getAsset as nodeGetAsset,
  isSea as nodeIsSea,
} from '../../../lib/node-sea.js';
import {
  assertApplicationRevisionId,
  validateApplicationRevision,
} from '../../../runtime/application-revision.js';
import { validateBuildTarget } from '../../../runtime/build-target.js';
import { sortCanonicalJsonValue } from '../../../runtime/canonical-order.js';
import { cloneJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';

export const APPLICATION_REVISION_ASSET_NAME = '<WHARFIE_APP>/revision.json';
export const ARTIFACT_RUNTIME_ASSET_NAME = '<WHARFIE_APP>/runtime.json';
export const ARTIFACT_RUNTIME_SCHEMA_VERSION = 1;
export const ARTIFACT_RUNTIME_KIND = 'artifactRuntime';

const ARTIFACT_RUNTIME_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'revisionId',
  'target',
]);

/**
 * @typedef ArtifactRuntime
 * @property {1} schemaVersion - Runtime metadata schema version.
 * @property {'artifactRuntime'} kind - Runtime metadata document kind.
 * @property {string} appId - Owning application logical ID.
 * @property {string} revisionId - Embedded immutable application revision.
 * @property {import('../../../runtime/build-target.js').BuildTarget} target - Exact executable target.
 */

/**
 * @typedef EmbeddedRevisionRuntimePair
 * @property {Readonly<import('../../../runtime/application-revision.js').ApplicationRevision>} revision - Validated embedded revision.
 * @property {Readonly<ArtifactRuntime>} runtime - Validated target runtime metadata.
 */

/**
 * @typedef EmbeddedRevisionRuntimeAssetProvider
 * @property {() => boolean} [isSea] - Whether the process is a SEA.
 * @property {(name: string, encoding?: string) => any} getAsset - Read a SEA asset.
 */

/**
 * @typedef EmbeddedRevisionRuntimeAssets
 * @property {string} revisionPath - Private temporary revision path.
 * @property {string} runtimePath - Private temporary runtime path.
 * @property {Readonly<Record<string, string>>} assets - SEA asset name-to-path mapping.
 * @property {() => Promise<void>} cleanup - Idempotently remove both temporary files and their directory.
 */

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
}

/**
 * Deeply freeze one independently validated JSON snapshot.
 * @param {any} value - JSON value.
 * @returns {any} - The same deeply frozen value.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * Validate strict target-specific metadata embedded before final artifact
 * hashing. The final artifact ID is intentionally not part of this document.
 * @param {unknown} value - Candidate runtime metadata.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<ArtifactRuntime>} - Validated immutable runtime metadata.
 */
export function validateArtifactRuntime(value, valuePath = 'runtime') {
  const runtime = cloneJsonObject(value, valuePath);
  assertExactKeys(runtime, ARTIFACT_RUNTIME_KEYS, valuePath);

  if (runtime.schemaVersion !== ARTIFACT_RUNTIME_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${ARTIFACT_RUNTIME_SCHEMA_VERSION}.`,
    );
  }
  if (runtime.kind !== ARTIFACT_RUNTIME_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${ARTIFACT_RUNTIME_KIND}'.`,
    );
  }
  assertLogicalId(runtime.appId, `${valuePath}.appId`);
  assertApplicationRevisionId(runtime.revisionId, `${valuePath}.revisionId`);

  return /** @type {Readonly<ArtifactRuntime>} */ (
    freezeJsonSnapshot({
      schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
      kind: ARTIFACT_RUNTIME_KIND,
      appId: runtime.appId,
      revisionId: runtime.revisionId,
      target: validateBuildTarget(runtime.target, `${valuePath}.target`),
    })
  );
}

/**
 * Validate the two embedded metadata documents and fence the target runtime to
 * the application and immutable revision named by the full revision contract.
 * @param {unknown} revisionValue - Candidate ApplicationRevisionV1.
 * @param {unknown} runtimeValue - Candidate ArtifactRuntimeV1.
 * @param {string} [valuePath] - Human-readable pair path.
 * @returns {EmbeddedRevisionRuntimePair} - Cross-checked independent pair.
 */
export function validateEmbeddedRevisionRuntimePair(
  revisionValue,
  runtimeValue,
  valuePath = 'embedded metadata',
) {
  const revision = validateApplicationRevision(
    revisionValue,
    `${valuePath}.revision`,
  );
  const runtime = validateArtifactRuntime(runtimeValue, `${valuePath}.runtime`);

  if (runtime.appId !== revision.contract.app.id) {
    throw new Error(
      `${valuePath}.runtime.appId does not match ${valuePath}.revision.contract.app.id.`,
    );
  }
  if (runtime.revisionId !== revision.revisionId) {
    throw new Error(
      `${valuePath}.runtime.revisionId does not match ${valuePath}.revision.revisionId.`,
    );
  }

  return /** @type {EmbeddedRevisionRuntimePair} */ (
    freezeJsonSnapshot({ revision, runtime })
  );
}

/**
 * @param {unknown} value - Validated JSON document input.
 * @param {(value: unknown, valuePath: string) => any} validate - Document validator.
 * @param {{ pretty?: boolean, valuePath?: string }} options - Serialization options.
 * @returns {string} - Deterministically ordered JSON.
 */
function stringifyValidatedDocument(value, validate, options) {
  const validated = validate(value, options.valuePath || 'embedded metadata');
  const ordered = sortCanonicalJsonValue(validated);
  return options.pretty === false
    ? JSON.stringify(ordered)
    : JSON.stringify(ordered, null, 2);
}

/**
 * Serialize a complete validated ApplicationRevisionV1 for SEA embedding.
 * @param {unknown} revision - Candidate application revision.
 * @param {{ pretty?: boolean, valuePath?: string }} [options] - Serialization options.
 * @returns {string} - Deterministically ordered revision JSON.
 */
export function stringifyEmbeddedApplicationRevision(revision, options = {}) {
  return stringifyValidatedDocument(
    revision,
    validateApplicationRevision,
    options,
  );
}

/**
 * Serialize strict target runtime metadata for SEA embedding.
 * @param {unknown} runtime - Candidate runtime metadata.
 * @param {{ pretty?: boolean, valuePath?: string }} [options] - Serialization options.
 * @returns {string} - Deterministically ordered runtime JSON.
 */
export function stringifyEmbeddedArtifactRuntime(runtime, options = {}) {
  return stringifyValidatedDocument(runtime, validateArtifactRuntime, options);
}

/**
 * Remove a temporary asset directory without masking the original creation
 * failure when cleanup itself also fails.
 * @param {string} assetDir - Temporary directory.
 * @param {unknown} error - Original creation error.
 * @returns {Promise<never>} - Always rejects.
 */
async function cleanupAfterCreationFailure(assetDir, error) {
  try {
    await fsp.rm(assetDir, { force: true, recursive: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Preparing embedded revision metadata failed and temporary asset cleanup was incomplete.',
    );
  }
  throw error;
}

/**
 * Materialize a cross-checked revision/runtime pair only for the lifetime of a
 * SEA build. Validation and serialization happen before creating the private
 * directory so invalid metadata leaves no temporary files behind.
 * @param {{ revision: unknown, runtime: unknown }} value - Embedded metadata pair.
 * @returns {Promise<EmbeddedRevisionRuntimeAssets>} - Temporary asset handle.
 */
export async function createEmbeddedRevisionRuntimeAssets(value) {
  const pair = validateEmbeddedRevisionRuntimePair(
    value?.revision,
    value?.runtime,
  );
  const revisionJson = `${stringifyEmbeddedApplicationRevision(pair.revision, {
    pretty: true,
  })}\n`;
  const runtimeJson = `${stringifyEmbeddedArtifactRuntime(pair.runtime, {
    pretty: true,
  })}\n`;

  const assetDir = await fsp.mkdtemp(
    path.join(tmpdir(), 'wharfie-revision-runtime-'),
  );

  const revisionPath = path.join(assetDir, 'revision.json');
  const runtimePath = path.join(assetDir, 'runtime.json');
  try {
    await fsp.chmod(assetDir, 0o700);
    await fsp.writeFile(revisionPath, revisionJson, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await fsp.chmod(revisionPath, 0o600);
    await fsp.writeFile(runtimePath, runtimeJson, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await fsp.chmod(runtimePath, 0o600);
  } catch (error) {
    return await cleanupAfterCreationFailure(assetDir, error);
  }

  const assets = Object.freeze({
    [APPLICATION_REVISION_ASSET_NAME]: revisionPath,
    [ARTIFACT_RUNTIME_ASSET_NAME]: runtimePath,
  });
  return {
    revisionPath,
    runtimePath,
    assets,
    cleanup: async () => {
      await fsp.rm(assetDir, { force: true, recursive: true });
    },
  };
}

/**
 * @param {{ assetProvider?: EmbeddedRevisionRuntimeAssetProvider }} options - Reader options.
 * @returns {EmbeddedRevisionRuntimeAssetProvider} - Available asset provider.
 */
function resolveAssetProvider(options) {
  const assetProvider =
    options.assetProvider ||
    /** @type {EmbeddedRevisionRuntimeAssetProvider} */ ({
      isSea: nodeIsSea,
      getAsset: nodeGetAsset,
    });

  if (typeof assetProvider.getAsset !== 'function') {
    throw new Error('Embedded revision asset provider is unavailable.');
  }
  return assetProvider;
}

/**
 * @param {any} rawAsset - Raw SEA asset bytes.
 * @param {string} assetName - Reserved asset name.
 * @param {string} label - Human-readable document label.
 * @returns {unknown} - Parsed JSON.
 */
function parseEmbeddedJsonAsset(rawAsset, assetName, label) {
  if (rawAsset == null) {
    throw new Error(`Embedded ${label} asset '${assetName}' was not found.`);
  }

  try {
    return JSON.parse(Buffer.from(rawAsset).toString('utf8'));
  } catch {
    throw new Error(`Embedded ${label} is not valid JSON.`);
  }
}

/**
 * Read and cross-check the complete immutable revision and target runtime
 * metadata embedded in a SEA. An explicit provider supports tests and other
 * controlled asset sources without claiming that the current process is SEA.
 * @param {{ assetProvider?: EmbeddedRevisionRuntimeAssetProvider }} [options] - Reader options.
 * @returns {Promise<EmbeddedRevisionRuntimePair>} - Validated embedded pair.
 */
export async function readEmbeddedRevisionRuntimePair(options = {}) {
  const assetProvider = resolveAssetProvider(options);
  if (
    !options.assetProvider &&
    typeof assetProvider.isSea === 'function' &&
    !assetProvider.isSea()
  ) {
    throw new Error(
      'Embedded revision metadata is only available inside a packaged SEA artifact.',
    );
  }

  const [revisionAsset, runtimeAsset] = await Promise.all([
    assetProvider.getAsset(APPLICATION_REVISION_ASSET_NAME),
    assetProvider.getAsset(ARTIFACT_RUNTIME_ASSET_NAME),
  ]);
  const revision = parseEmbeddedJsonAsset(
    revisionAsset,
    APPLICATION_REVISION_ASSET_NAME,
    'application revision',
  );
  const runtime = parseEmbeddedJsonAsset(
    runtimeAsset,
    ARTIFACT_RUNTIME_ASSET_NAME,
    'artifact runtime metadata',
  );
  return validateEmbeddedRevisionRuntimePair(revision, runtime);
}

export default {
  APPLICATION_REVISION_ASSET_NAME,
  ARTIFACT_RUNTIME_ASSET_NAME,
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
  createEmbeddedRevisionRuntimeAssets,
  readEmbeddedRevisionRuntimePair,
  stringifyEmbeddedApplicationRevision,
  stringifyEmbeddedArtifactRuntime,
  validateArtifactRuntime,
  validateEmbeddedRevisionRuntimePair,
};
