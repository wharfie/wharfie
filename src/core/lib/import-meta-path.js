import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve an `import.meta.url`-style value to a filesystem path.
 * Normal ESM execution provides a `file:` URL string. Wharfie's SEA/CommonJS
 * bundles replace `import.meta.url` with `__filename`, which is already a
 * filesystem path.
 * @param {string} moduleUrlOrPath - `import.meta.url` or a bundle-injected path.
 * @returns {string} - Filesystem path.
 */
export function filePathFromImportMetaUrl(moduleUrlOrPath) {
  const value = String(moduleUrlOrPath);
  return value.startsWith('file:') ? fileURLToPath(value) : value;
}

/**
 * @param {string} moduleUrlOrPath - `import.meta.url` or a bundle-injected path.
 * @returns {string} - Directory containing the current module.
 */
export function dirPathFromImportMetaUrl(moduleUrlOrPath) {
  return path.dirname(filePathFromImportMetaUrl(moduleUrlOrPath));
}
