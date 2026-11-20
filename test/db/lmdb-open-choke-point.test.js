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
const SCRIPTS = join(REPO_ROOT, 'scripts');

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(c|m)?js$/.test(entry.name) ? [path] : [];
  });
}

/** @param {RegExp} pattern @param {string} [root] @returns {Record<string, number>} */
function countBySourceFile(pattern, root = SRC) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const file of sourceFiles(root)) {
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
      /const route =\s+\(readOnly \|\| options\.routeWrites === true\) &&\s+!hasOpenLmdbEnvironment\(controlPath\)\s+\? async \(\) => \{\s+const \{ connectLocalStoreHost \} =\s+await import\('\.\.\/\.\.\/runtime\/local-store-host\.js'\);\s+return await connectLocalStoreHost\(\{\s+storePath: controlPath,[\s\S]*?const hosted = await route\?\.\(\);\s+if \(hosted\) return hosted;\s+return await openHeldLmdb\(/,
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
    // Writing through another process's host is for commands that must change
    // a store while it is held; everything else that writes is refused beside
    // a holder.
    expect(countBySourceFile(/\brouteWrites: true\b/g)).toEqual({
      'src/core/runtime/operator/coordinator-authority-command.js': 1,
      // Service activation, while a resident runs before its stop or after
      // its successor's start.
      'src/core/runtime/services/systemd-user-service-manager.js': 1,
    });
  });

  test('only the lock module touches the holder lock file', () => {
    // POSIX drops every fcntl lock a process holds on a file when that
    // process closes any descriptor of it. Reading, copying or opening the
    // lock file anywhere else in a holder would silently release its lock.
    const pattern = /wharfie-holder\.lock|\bLMDB_HOLDER_LOCK_FILE\b/g;
    expect({
      ...countBySourceFile(pattern),
      ...countBySourceFile(pattern, SCRIPTS),
    }).toEqual({
      'src/core/lib/db/lmdb-holder-lock.js': expect.any(Number),
    });
  });

  test('control-store open sites are the reviewed set', () => {
    // Each site, and whether a resident can be writing at the time:
    // - execution-ledger-store withExecutionLedger: read-only opens route
    //   through the host; writable opens refuse while another process hosts,
    //   unless the caller hosts itself (hostReads).
    // - execution-ledger-store host facades (read-only and writable): in the
    //   hosting process only, sharing its environment.
    // - coordinator-authority-command: inspect routes through the host; the
    //   takeover writes through a live holder (routeWrites), and opens
    //   natively only under the exclusive holder lock when none is live.
    // - systemd-user-service-manager: activation snapshot and purge scan are
    //   read-only and route; withLockedActivation resolves the store per call
    //   (through a live resident, writes included, or natively under the
    //   exclusive lock between stop and start) and drops it before every
    //   systemctl stop and start.
    // - systemd-user-service-manager readRuntimeState: read-only, routes.
    expect(
      countBySourceFile(
        /\b(?:createControlDBClient|createControlDB|createDB)\((?!\s*\))/g,
      ),
    ).toEqual({
      // The definition, plus the reroute after a lost host (read-only).
      'src/core/lib/config/db.js': 2,
      'src/core/runtime/operator/coordinator-authority-command.js': 1,
      'src/core/runtime/operator/execution-ledger-store.js': 3,
      'src/core/runtime/services/systemd-user-service-manager.js': 4,
    });
  });

  test('only long-lived resident writers host their store', () => {
    expect(countBySourceFile(/\bhostReads: true\b/g)).toEqual({
      'src/core/runtime/durable-activity-host.js': 1,
      'src/core/runtime/services/resident-activity-worker.js': 1,
    });
    // Only the service manager's resident waits for another holder to leave;
    // every other would-be holder is refused at once.
    expect(countBySourceFile(/\bonStoreHeld: 'wait'/g)).toEqual({
      'src/core/runtime/services/ledger-service-command.js': 1,
    });
  });

  test('verifier scripts open installed stores only at the reviewed sites', () => {
    // Scripts load the installed package's LMDB adapter directly, outside
    // db.js, so each site is reviewed against the one-holder rule here.
    expect(
      countBySourceFile(/adapters\/lmdb\.js'|'adapters', 'lmdb\.js'/g, SCRIPTS),
    ).toEqual({
      'scripts/application-state-readiness-proof.js': 1,
      'scripts/verify-package-sea.js': 2,
      'scripts/verify-systemd-user-service-linux.js': 1,
    });
    // Every `.default(` call in scripts/, whatever the binding is called: a
    // direct open through an installed adapter is such a call, so a new one
    // anywhere changes these counts and must be reviewed here.
    expect(countBySourceFile(/\.default\(/g, SCRIPTS)).toEqual({
      // Live READY proof: the control store is read through its host
      // (createControlDBClient); the application-state store has no read
      // host, so it is opened here beside the live resident, reported
      // through onUnhostedRead and counted. Remove it by hosting that store.
      'scripts/application-state-readiness-proof.js': 1,
      // The package verifier's only native opens: under the holder lock;
      // without it only beside the holder this verifier holds paused (that
      // holder, not any paused process), or for the application-state store
      // beside a live holder (counted and printed).
      'scripts/installed-store-open.js': 3,
      // Linux systemd verifier: the same READY proof for a running service;
      // its control store is read through the host, its application-state
      // store here.
      'scripts/verify-systemd-user-service-linux.js': 1,
    });
    expect(countBySourceFile(/\bholderLock: true\b/g, SCRIPTS)).toEqual({
      'scripts/installed-store-open.js': 1,
    });
    const readinessProof = readFileSync(
      join(SCRIPTS, 'application-state-readiness-proof.js'),
      'utf8',
    );
    expect(readinessProof).toMatch(
      /if \(input\.path === scope\.controlPath\) \{\s+return await dbConfig\.createControlDBClient\('lmdb', \{/,
    );
    // The generated test app's own LMDB data, not a Wharfie store.
    expect(
      countBySourceFile(
        /from 'lmdb'|require\('lmdb'\)|import\('lmdb'\)/g,
        SCRIPTS,
      ),
    ).toEqual({ 'scripts/verify-package-sea.js': 1 });
  });
});
