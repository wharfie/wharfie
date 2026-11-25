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

/**
 * Every module the lock module may import, and the exact bindings it may take
 * from each. Any other specifier (including 'fs', 'fs/promises' or
 * 'node:module'), form (namespace, default) or binding fails the guard.
 */
const LOCK_MODULE_IMPORTS = {
  'node:crypto': ['randomBytes'],
  'node:fs': [
    'closeSync',
    'constants as fsConstants',
    'fstatSync',
    'lstatSync',
    'openSync',
    'readSync',
    'renameSync',
    'statSync',
    'unlinkSync',
    'writeSync',
  ],
  'node:path': ['basename', 'dirname', 'join'],
  'node:url': ['pathToFileURL'],
};

/**
 * Remove comments and the text of string and template literals (keeping
 * the code inside `${...}`), so a check sees only code.
 * @param {string} source
 * @returns {string}
 */
function codeOnly(source) {
  let out = '';
  /** @type {number[]} template nesting: brace depth at each `${` */
  const templates = [];
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const inTemplateText =
      templates.length > 0 && templates[templates.length - 1] === -1;
    if (inTemplateText) {
      if (char === '\\') index += 1;
      else if (char === '`') templates.pop();
      else if (char === '$' && next === '{') {
        templates[templates.length - 1] = depth;
        depth += 1;
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index = source.indexOf('*/', index + 2) + 1;
      continue;
    }
    if (char === "'" || char === '"') {
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === '\\') index += 1;
        else if (source[index] === char) break;
      }
      out += '""';
      continue;
    }
    if (char === '`') {
      templates.push(-1);
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        templates[templates.length - 1] = -1;
        continue;
      }
    }
    out += char;
  }
  return out;
}

/**
 * Ways the lock module could change a file's owner, found lexically.
 * @param {string} source
 * @returns {string[]}
 */
function ownershipChangeViolations(source) {
  /** @type {string[]} */
  const violations = [];
  const code = codeOnly(source);
  for (const match of code.matchAll(/\b[fl]?chown(?:Sync)?\b/g)) {
    violations.push(`identifier ${match[0]}`);
  }
  // Static imports and re-exports: an allowed specifier, once, as one named
  // list of allowed bindings.
  /** @type {Set<string>} */
  const seen = new Set();
  for (const [, clause = '', specifier] of [
    ...source.matchAll(
      /(?:^|\n)\s*import\s+(?:([^;'"]*?)\s+from\s+)?['"]([^'"]+)['"]/g,
    ),
    ...source.matchAll(
      /(?:^|\n)\s*export\s+([^;'"]*?)\s+from\s+['"]([^'"]+)['"]/g,
    ),
  ]) {
    const allowed = Object.hasOwn(LOCK_MODULE_IMPORTS, specifier)
      ? LOCK_MODULE_IMPORTS[
          /** @type {keyof typeof LOCK_MODULE_IMPORTS} */ (specifier)
        ]
      : undefined;
    if (!allowed) {
      violations.push(`import of ${specifier}`);
      continue;
    }
    if (seen.has(specifier)) violations.push(`second import of ${specifier}`);
    seen.add(specifier);
    const names = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (!names) {
      violations.push(`${specifier} import form: ${clause.trim() || '(bare)'}`);
      continue;
    }
    for (const name of names[1]
      .split(',')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean)) {
      if (!allowed.includes(name))
        violations.push(`${specifier} import ${name}`);
    }
  }
  // The one built-in loaded at run time is SQLite, by a literal name.
  const builtinCalls = code.match(/\bgetBuiltinModule\b/g)?.length ?? 0;
  const sqliteCalls =
    source.match(/\bprocess\.getBuiltinModule\(\s*'node:sqlite'\s*\)/g)
      ?.length ?? 0;
  if (builtinCalls !== sqliteCalls) {
    violations.push('getBuiltinModule of something other than node:sqlite');
  }
  for (const [pattern, what] of /** @type {Array<[RegExp, string]>} */ ([
    [/\bimport\s*\(/, 'dynamic import'],
    [/\brequire\b/, 'require'],
    [/\bcreateRequire\b/, 'createRequire'],
    [/\bprocess\s*(?:\?\.)?\s*\[/, 'computed access on process'],
    [/\bglobalThis\b/, 'globalThis'],
  ])) {
    if (pattern.test(code)) violations.push(what);
  }
  return violations;
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

  test('the lock module never changes the owner of anything', () => {
    // A store is opened only by its owner (lmdb-holder-lock.js refuses any
    // other user before touching or creating it), so nothing there needs an
    // ownership change, and none may come back. This is a lexical tripwire
    // against accidents, not a proof: no chown-family identifier in code
    // (strings and comments may still advise `chown`); every import pinned,
    // specifier and bindings; no dynamic import, require or createRequire; no
    // computed access on process or globalThis; getBuiltinModule only for
    // node:sqlite. It cannot see a chown done by another module this one
    // calls, or a name assembled through some route not listed here.
    const source = readFileSync(
      join(SRC, 'core/lib/db/lmdb-holder-lock.js'),
      'utf8',
    );
    expect(ownershipChangeViolations(source)).toEqual([]);
    // Every bypass reviewer B listed, added to the real module, is caught.
    for (const bypass of [
      "import { fchown as giveAway } from 'node:fs';\ngiveAway(fd, 0, 0);",
      "import * as nodeFs from 'node:fs';\nnodeFs['ch' + 'own'](p, 0, 0);",
      "const { fchownSync: g } = process.getBuiltinModule('node:fs');",
      "const fs = await import('node:fs');",
      "import * as f from 'fs';\nf['ch' + 'own'](p, 0, 0);",
      "import * as fp from 'fs/promises';\nfp['ch' + 'own'](p, 0, 0);",
      "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('fs')['ch' + 'own'](p, 0, 0);",
      "process['getBuiltin' + 'Module']('node:fs')['ch' + 'own'](p, 0, 0);",
    ]) {
      expect({
        bypass,
        caught: ownershipChangeViolations(`${bypass}\n${source}`).length > 0,
      }).toEqual({ bypass, caught: true });
    }
    // ...and text is not code.
    expect(
      ownershipChangeViolations(
        `${source}\n// chown it\nconst advice = 'Fix its owner (chown)';\n`,
      ),
    ).toEqual([]);
  });

  test('a store is created only after the creation owner check', () => {
    const adapter = readFileSync(
      join(SRC, 'core/lib/db/adapters/lmdb.js'),
      'utf8',
    );
    expect(adapter).toMatch(
      /if \(options\.holderLock === true\) assertMayCreateLocalStore\(dbRoot\);\s+mkdirSync\(dbRoot, /,
    );
    const host = readFileSync(
      join(SRC, 'core/runtime/local-store-host.js'),
      'utf8',
    );
    expect(host).toMatch(
      /assertMayCreateLocalStore\(join\(options\.storePath, 'lmdb'\)\);\s+await fsp\.mkdir\(options\.storePath, /,
    );
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
    // The call count above sees `x.default(`. A file that loads the adapter
    // must not take its default under another name either, by destructuring
    // or indexing, which would make a direct open invisible to that count.
    for (const file of [
      'application-state-readiness-proof.js',
      'installed-store-open.js',
      'verify-package-sea.js',
      'verify-systemd-user-service-linux.js',
    ]) {
      const source = readFileSync(join(SCRIPTS, file), 'utf8');
      expect({
        file,
        renamed: source.match(
          /\{\s*default\s*:\s*[A-Za-z_$]|\[\s*['"]default['"]\s*\]/g,
        ),
      }).toEqual({ file, renamed: null });
    }
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
