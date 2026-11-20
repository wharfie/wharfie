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
    // Only lazily, from the DB config module: a static import elsewhere would
    // load the native module resolver in every process, including SEAs.
    expect(countBySourceFile(/['"][./a-z]*\/adapters\/lmdb\.js['"]/g)).toEqual({
      'src/core/lib/config/db.js': 4,
    });
    expect(countBySourceFile(/\bcreateLMDB\(/g)).toEqual({
      // General DB, state DB, and openHeldLmdb (control and app-state).
      'src/core/lib/config/db.js': 3,
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
      /const routeRead =\s+options\.readOnly === true && !hasOpenLmdbEnvironment\(controlPath\)\s+\? async \(\) => \{\s+const \{ connectLocalStoreHost \} =\s+await import\('\.\.\/\.\.\/runtime\/local-store-host\.js'\);\s+return await connectLocalStoreHost\(\{\s+storePath: controlPath,[\s\S]*?const hosted = await routeRead\?\.\(\);\s+if \(hosted\) return hosted;\s+return await openHeldLmdb\(/,
    );
  });

  test('resident stores open natively only under the holder lock', () => {
    // lmdb-holder-lock.js: shared for a read-only native environment,
    // exclusive for a writable one, held from before open until after close.
    const source = readFileSync(join(SRC, 'core/lib/config/db.js'), 'utf8');
    const section = (/** @type {string} */ from, /** @type {string} */ to) =>
      source.slice(source.indexOf(from), source.indexOf(to));
    expect(
      section(
        'async function openHeldLmdb(',
        '/**\n * Create the dedicated durable control-store DB client.',
      ),
    ).toMatch(/return createLMDB\(\{ \.\.\.options, holderLock: true \}\);/);
    for (const branch of [
      section(
        'export async function createControlDBClient(',
        'export async function createApplicationStateDBClient(',
      ),
      section(
        'export async function createApplicationStateDBClient(',
        'export async function createStateDBClient(',
      ),
    ]) {
      expect(branch).not.toMatch(/\bcreateLMDB\(/);
      expect(branch).toMatch(/return await openHeldLmdb\(\s+createLMDB,/);
    }
    expect(countBySourceFile(/\bholderLock: true\b/g)).toEqual({
      'src/core/lib/config/db.js': 1,
    });
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
      // The definition, plus the reroute after a lost host (read-only).
      'src/core/lib/config/db.js': 2,
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
