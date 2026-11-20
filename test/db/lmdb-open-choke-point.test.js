/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

// A native LMDB open from a process other than the store's resident, followed
// by its close, can lose the resident's writes (lmdb-js #370). Every native
// open therefore goes through src/core/lib/config/db.js, whose control-store
// branch reads through a live resident host instead. This guard fails when a
// new open site appears, so it is reviewed against that rule before it lands.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(REPO_ROOT, 'src');

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(c|m)?js$/.test(entry.name) ? [path] : [];
  });
}

/** @param {RegExp} pattern @returns {Record<string, number>} */
function countBySourceFile(pattern) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const file of sourceFiles(SRC)) {
    const matches = readFileSync(file, 'utf8').match(pattern);
    if (matches) counts[relative(REPO_ROOT, file)] = matches.length;
  }
  return counts;
}

describe('LMDB open choke point', () => {
  test('only the DB config module loads the LMDB adapter factory', () => {
    expect(countBySourceFile(/['"][./a-z]*\/adapters\/lmdb\.js['"]/g)).toEqual({
      'src/core/lib/config/db.js': 4,
      // Named import of the read-only not-found error class only.
      'src/core/runtime/local-store-host.js': 1,
    });
    expect(
      readFileSync(join(SRC, 'core/runtime/local-store-host.js'), 'utf8'),
    ).toMatch(
      /import \{ LMDBReadOnlyStoreNotFoundError \} from '\.\.\/lib\/db\/adapters\/lmdb\.js';/,
    );
    expect(countBySourceFile(/\bcreateLMDB\(/g)).toEqual({
      'src/core/lib/config/db.js': 4,
      'src/core/lib/db/adapters/lmdb.js': 1,
    });
  });

  test('the control-store LMDB branch consults the resident host before opening', () => {
    const source = readFileSync(join(SRC, 'core/lib/config/db.js'), 'utf8');
    const branch = source.slice(
      source.indexOf('export async function createControlDBClient('),
      source.indexOf('export async function createApplicationStateDBClient('),
    );
    expect(branch).toMatch(
      /if \(options\.readOnly === true && !hasOpenLmdbEnvironment\(controlPath\)\) \{\s+const \{ connectLocalStoreHost \} =\s+await import\('\.\.\/\.\.\/runtime\/local-store-host\.js'\);\s+const hosted = await connectLocalStoreHost\(\{ storePath: controlPath \}\);\s+if \(hosted\) return hosted;\s+\}\s+return createLMDB\(/,
    );
  });

  test('control-store open sites are the reviewed set', () => {
    // Each site, and whether a resident can be writing at the time:
    // - execution-ledger-store withExecutionLedger: read-only opens route
    //   through the host; writable opens refuse while another process hosts,
    //   unless the caller hosts itself (hostReads).
    // - execution-ledger-store host facade: in the hosting process only.
    // - coordinator-authority-command: inspect routes through the host; the
    //   explicit replacement fence opens writable (reviewed residual risk).
    // - systemd-user-service-manager: activation snapshot and purge scan are
    //   read-only and route; withLockedActivation holds a writable env across
    //   the resident's stop and start (reviewed residual risk).
    // - systemd-user-service-manager readRuntimeState: read-only, routes.
    expect(
      countBySourceFile(
        /\b(?:createControlDBClient|createControlDB|createDB)\((?!\s*\))/g,
      ),
    ).toEqual({
      'src/core/lib/config/db.js': 1,
      'src/core/runtime/operator/coordinator-authority-command.js': 1,
      'src/core/runtime/operator/execution-ledger-store.js': 2,
      'src/core/runtime/services/systemd-user-service-manager.js': 4,
    });
  });

  test('only long-lived resident writers host their store', () => {
    expect(countBySourceFile(/\bhostReads: true\b/g)).toEqual({
      'src/core/runtime/durable-activity-host.js': 1,
      'src/core/runtime/services/resident-activity-worker.js': 1,
    });
  });
});
