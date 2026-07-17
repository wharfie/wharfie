import { createRequire } from 'node:module';

import { requirePackagedCoreRuntimeDependency } from '../runtime/core-runtime-dependencies.js';
import { isSea } from './node-sea.js';

const sourceRequire = createRequire(import.meta.url);

/**
 * Resolve LMDB from the only valid boundary for this process.
 *
 * Source execution uses the installed development package. A SEA must have
 * completed core-runtime bootstrap first, which makes this resolve only from
 * the verified extracted target closure rather than an ambient module path.
 * @returns {{open: Function}} - LMDB module exports.
 */
export function getLmdbModule() {
  const lmdb = isSea()
    ? requirePackagedCoreRuntimeDependency('lmdb')
    : sourceRequire('lmdb');
  if (!lmdb || typeof lmdb.open !== 'function') {
    throw new Error('LMDB module does not expose open().');
  }
  return lmdb;
}

export default getLmdbModule;
