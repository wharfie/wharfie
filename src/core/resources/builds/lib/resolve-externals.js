import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * @typedef ExternalDependencyInputObject
 * @property {string} name - name.
 * @property {string} [version] - version.
 */

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - name.
 * @property {string} version - version.
 */

/**
 * @param {string | ExternalDependencyInputObject} external - external.
 * @returns {ExternalDependencyInputObject} - Result.
 */
function normalizeExternalInput(external) {
  if (typeof external === 'string') {
    const trimmed = external.trim();
    if (!trimmed) {
      throw new TypeError('External dependency spec must not be empty');
    }

    const versionSeparator = trimmed.lastIndexOf('@');
    if (versionSeparator > 0) {
      const name = trimmed.slice(0, versionSeparator).trim();
      const version = trimmed.slice(versionSeparator + 1).trim();
      if (name && version) {
        return { name, version };
      }
    }

    return { name: trimmed };
  }

  if (external && typeof external === 'object') {
    const name = typeof external.name === 'string' ? external.name.trim() : '';
    const version =
      typeof external.version === 'string' ? external.version.trim() : '';

    if (!name) {
      throw new TypeError('External dependency objects require a name');
    }

    return version ? { name, version } : { name };
  }

  throw new TypeError(
    'External dependencies must be package names or { name, version? } objects',
  );
}

/**
 * @param {string | undefined} basePath - basePath.
 * @returns {any[]} - Result.
 */
function createResolvers(basePath) {
  const candidates = [
    basePath ? path.resolve(basePath) : null,
    path.join(process.cwd(), 'package.json'),
  ];

  /** @type {string[]} */
  const resolvedCandidates = [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) {
      resolvedCandidates.push(candidate);
    }
  }

  return Array.from(new Set(resolvedCandidates)).map((candidate) =>
    createRequire(candidate),
  );
}

/**
 * @param {string} packageName - packageName.
 * @param {any[]} resolvers - resolvers.
 * @returns {ExternalDependencyDescription} - Result.
 */
function resolveInstalledExternal(packageName, resolvers) {
  /** @type {string[]} */
  const errors = [];

  for (const resolver of resolvers) {
    try {
      const packageJsonPath = resolver.resolve(`${packageName}/package.json`);
      /** @type {{ version?: string, name?: string }} */
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (typeof manifest.version === 'string' && manifest.version) {
        return { name: packageName, version: manifest.version };
      }
    } catch {
      // Fall back to resolving the package entrypoint and walking upward.
    }

    let resolvedEntry;
    try {
      resolvedEntry = resolver.resolve(packageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      continue;
    }

    let currentDir = path.dirname(resolvedEntry);
    while (true) {
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        /** @type {{ version?: string, name?: string }} */
        const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (
          manifest?.name === packageName &&
          typeof manifest.version === 'string' &&
          manifest.version
        ) {
          return { name: packageName, version: manifest.version };
        }
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  throw new Error(
    `Could not resolve installed external dependency '${packageName}': ${errors.join(' | ')}`,
  );
}

/**
 * Normalize user-authored external dependency specs into exact `{ name, version }`
 * descriptors.
 *
 * Supported input forms:
 * - 'lmdb'
 * - 'sharp@0.34.4'
 * - { name: 'lmdb' }
 * - { name: 'sharp', version: '0.34.4' }
 *
 * Bare package names are resolved against the installed dependency tree closest to
 * the function entrypoint, with a fallback to the current Wharfie working tree.
 * @param {(string | ExternalDependencyInputObject)[] | undefined} externals - externals.
 * @param {string | undefined} entrypointPath - entrypointPath.
 * @returns {ExternalDependencyDescription[] | undefined} - Result.
 */
export function normalizeExternalDependencies(externals, entrypointPath) {
  if (!Array.isArray(externals) || externals.length === 0) {
    return undefined;
  }

  const resolvers = createResolvers(entrypointPath);
  return externals.map((external) => {
    const normalized = normalizeExternalInput(external);
    if (normalized.version) {
      return {
        name: normalized.name,
        version: normalized.version,
      };
    }
    return resolveInstalledExternal(normalized.name, resolvers);
  });
}

export default {
  normalizeExternalDependencies,
};
