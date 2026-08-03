const EXACT_NODE_VERSION_PATTERN =
  /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

/**
 * Normalize an exact Node.js version while rejecting ranges and release-line
 * prefixes. Node's optional leading `v` is not part of `process.versions.node`.
 * @param {unknown} version - Node.js version to normalize.
 * @param {string} [label] - Human-readable value label.
 * @returns {string} - Exact version in process.versions.node form.
 */
export function normalizeExactNodeVersion(version, label = 'Node version') {
  const candidate = typeof version === 'string' ? version.trim() : '';
  const match = EXACT_NODE_VERSION_PATTERN.exec(candidate);

  if (!match) {
    throw new Error(
      `${label} must be an exact Node.js version in x.y.z form (for example, ${process.versions.node}); received ${JSON.stringify(version)}.`,
    );
  }

  return match[1];
}

/**
 * Node.js requires the process that generates a SEA blob and the target Node
 * binary receiving that blob to have exactly the same version.
 * @param {unknown} targetVersion - Target Node.js binary version.
 * @param {unknown} [builderVersion] - SEA blob-generator Node.js version.
 * @returns {string} - Normalized exact target version.
 */
export function assertSeaNodeVersionCompatible(
  targetVersion,
  builderVersion = process.versions.node,
) {
  const target = normalizeExactNodeVersion(
    targetVersion,
    'SEA target Node version',
  );
  const builder = normalizeExactNodeVersion(
    builderVersion,
    'SEA builder Node version',
  );

  if (target !== builder) {
    throw new Error(
      `Cannot build a Node SEA targeting Node ${target} while running Node ${builder}. Node.js requires the SEA blob generator and target binary to use the same exact Node version. Run Wharfie with Node ${target}, or configure the SEA target as ${builder}.`,
    );
  }

  return target;
}
