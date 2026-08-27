/* eslint-env jest */

import { afterEach, describe, expect, test } from '@jest/globals';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SYSTEMD_PROOF_ROOT,
  SYSTEMD_PROOF_ROOT_LEAF,
  SYSTEMD_PROOF_ROOT_MARKER,
  assertOwnedSystemdProofRoot,
  initializeOwnedSystemdProofRoot,
  resetOwnedSystemdProofRoot,
  resolveSystemdProofRoot,
} from '../../scripts/systemd-proof-root.js';

const REPOSITORY_ROOT = realpathSync(
  fileURLToPath(new URL('../..', import.meta.url)),
);
/** @type {string[]} */
const ownedSandboxes = [];

afterEach(() => {
  while (ownedSandboxes.length) {
    const sandbox = ownedSandboxes.pop();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  }
});

function createFixture() {
  const workspace = realpathSync(
    process.env.WHARFIE_TEST_WORKSPACE || tmpdir(),
  );
  const sandbox = mkdtempSync(path.join(workspace, 'systemd-proof-root-'));
  ownedSandboxes.push(sandbox);
  const approvedParent = path.join(sandbox, 'approved-parent');
  mkdirSync(approvedParent, { mode: 0o700 });
  const proofRoot = path.join(approvedParent, SYSTEMD_PROOF_ROOT_LEAF);
  return {
    sandbox,
    approvedParent,
    proofRoot,
    options: { approvedParent, proofRoot },
  };
}

describe('systemd proof-root production boundary', () => {
  test('uses one fixed root and rejects every environment override', () => {
    const fixture = createFixture();
    mkdirSync(fixture.proofRoot, { mode: 0o700 });
    const sentinel = path.join(fixture.proofRoot, 'sentinel.txt');
    writeFileSync(sentinel, 'preserve me\n');

    expect(resolveSystemdProofRoot({})).toBe(SYSTEMD_PROOF_ROOT);
    expect(() =>
      resolveSystemdProofRoot({ WHARFIE_SYSTEMD_PROOF_ROOT: '' }),
    ).toThrow(/overrides are forbidden/);
    expect(() =>
      resolveSystemdProofRoot({
        WHARFIE_SYSTEMD_PROOF_ROOT: fixture.proofRoot,
      }),
    ).toThrow(/overrides are forbidden/);
    expect(readFileSync(sentinel, 'utf8')).toBe('preserve me\n');
  });
});

describe('systemd proof-root destructive guard', () => {
  test('rejects the home directory without changing it', () => {
    const home = realpathSync(homedir());
    const before = lstatSync(home);

    expect(() =>
      resetOwnedSystemdProofRoot({
        approvedParent: path.dirname(home),
        proofRoot: home,
      }),
    ).toThrow(/exact approved direct leaf/);

    const after = lstatSync(home);
    expect({ dev: after.dev, ino: after.ino, mode: after.mode }).toEqual({
      dev: before.dev,
      ino: before.ino,
      mode: before.mode,
    });
  });

  test('rejects the repository root and preserves its sentinel', () => {
    const sentinel = path.join(REPOSITORY_ROOT, 'package.json');
    const before = readFileSync(sentinel);

    expect(() =>
      resetOwnedSystemdProofRoot({
        approvedParent: path.dirname(REPOSITORY_ROOT),
        proofRoot: REPOSITORY_ROOT,
      }),
    ).toThrow(/exact approved direct leaf/);

    expect(readFileSync(sentinel)).toEqual(before);
  });

  test('rejects the approved parent itself and preserves its sentinel', () => {
    const fixture = createFixture();
    const sentinel = path.join(fixture.approvedParent, 'sentinel.txt');
    writeFileSync(sentinel, 'parent sentinel\n');

    expect(() =>
      resetOwnedSystemdProofRoot({
        approvedParent: fixture.approvedParent,
        proofRoot: fixture.approvedParent,
      }),
    ).toThrow(/exact approved direct leaf/);

    expect(readFileSync(sentinel, 'utf8')).toBe('parent sentinel\n');
  });

  test('rejects a proof-root symlink and preserves its target', () => {
    const fixture = createFixture();
    const target = path.join(fixture.sandbox, 'symlink-target');
    mkdirSync(target, { mode: 0o700 });
    const sentinel = path.join(target, 'sentinel.txt');
    writeFileSync(sentinel, 'symlink sentinel\n');
    symlinkSync(target, fixture.proofRoot, 'dir');

    expect(() => resetOwnedSystemdProofRoot(fixture.options)).toThrow(
      /must not be a symbolic link/,
    );
    expect(readFileSync(sentinel, 'utf8')).toBe('symlink sentinel\n');
  });

  test('rejects a symlink component and preserves the resolved leaf', () => {
    const fixture = createFixture();
    const realParent = path.join(fixture.sandbox, 'real-parent');
    const linkedParent = path.join(fixture.sandbox, 'linked-parent');
    mkdirSync(realParent, { mode: 0o700 });
    const realRoot = path.join(realParent, SYSTEMD_PROOF_ROOT_LEAF);
    mkdirSync(realRoot, { mode: 0o700 });
    const sentinel = path.join(realRoot, 'sentinel.txt');
    writeFileSync(sentinel, 'component sentinel\n');
    symlinkSync(realParent, linkedParent, 'dir');

    expect(() =>
      resetOwnedSystemdProofRoot({
        approvedParent: linkedParent,
        proofRoot: path.join(linkedParent, SYSTEMD_PROOF_ROOT_LEAF),
      }),
    ).toThrow(/must not be a symbolic link/);
    expect(readFileSync(sentinel, 'utf8')).toBe('component sentinel\n');
  });

  test('never deletes an existing unmarked direct leaf', () => {
    const fixture = createFixture();
    mkdirSync(fixture.proofRoot, { mode: 0o700 });
    chmodSync(fixture.proofRoot, 0o700);
    const sentinel = path.join(fixture.proofRoot, 'sentinel.txt');
    writeFileSync(sentinel, 'unmarked sentinel\n');

    expect(() => resetOwnedSystemdProofRoot(fixture.options)).toThrow();
    expect(readFileSync(sentinel, 'utf8')).toBe('unmarked sentinel\n');
  });

  test('validates marker contents before deleting owned-looking state', () => {
    const fixture = createFixture();
    initializeOwnedSystemdProofRoot(fixture.options);
    const sentinel = path.join(fixture.proofRoot, 'sentinel.txt');
    writeFileSync(sentinel, 'invalid marker sentinel\n');
    const markerPath = path.join(fixture.proofRoot, SYSTEMD_PROOF_ROOT_MARKER);
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    marker.canonicalRoot = `${fixture.proofRoot}-other`;
    writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    chmodSync(markerPath, 0o600);

    expect(() => resetOwnedSystemdProofRoot(fixture.options)).toThrow(
      /does not attest this canonical root and UID/,
    );
    expect(readFileSync(sentinel, 'utf8')).toBe('invalid marker sentinel\n');
  });

  test('resets a correctly marked temp leaf and recreates its marker', () => {
    const fixture = createFixture();
    const initial = initializeOwnedSystemdProofRoot(fixture.options);
    const sentinel = path.join(fixture.proofRoot, 'sentinel.txt');
    writeFileSync(sentinel, 'owned sentinel\n');

    const reset = resetOwnedSystemdProofRoot(fixture.options);

    expect(existsSync(sentinel)).toBe(false);
    expect(reset).toEqual(initial);
    expect(assertOwnedSystemdProofRoot(fixture.options)).toEqual(initial);
    expect(statSync(fixture.proofRoot).mode & 0o777).toBe(0o700);
    const markerPath = path.join(fixture.proofRoot, SYSTEMD_PROOF_ROOT_MARKER);
    expect(statSync(markerPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toEqual(initial);
  });
});
