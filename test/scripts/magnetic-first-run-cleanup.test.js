import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupMagneticFirstRun,
  MAGNETIC_PROOF_PREFIX,
} from '../../scripts/magnetic-first-run-cleanup.js';

/** @type {string[]} */
const proofRoots = [];
/** @type {string[]} */
const outsideRoots = [];

function proofRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), MAGNETIC_PROOF_PREFIX));
  proofRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of proofRoots.splice(0)) cleanupMagneticFirstRun({ root });
  for (const root of outsideRoots.splice(0)) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('magnetic proof cleanup', () => {
  it('repairs readonly owned directories while preserving file and outside symlink-target permissions', () => {
    const root = proofRoot();
    const directory = path.join(root, 'readonly');
    mkdirSync(directory);
    const file = path.join(directory, 'payload');
    writeFileSync(file, 'owned', { mode: 0o400 });
    chmodSync(directory, 0o500);
    const outside = mkdtempSync(path.join(os.tmpdir(), 'unrelated-proof-'));
    outsideRoots.push(outside);
    writeFileSync(path.join(outside, 'keep'), 'untouched');
    chmodSync(outside, 0o500);
    symlinkSync(outside, path.join(root, 'outside'));
    const cleanupPackage = jest.fn();
    let attempts = 0;
    cleanupMagneticFirstRun(
      { root, cleanupPackage },
      {
        remove: (selected, options) => {
          if (++attempts === 1) {
            throw Object.assign(new Error('readonly snapshot'), {
              code: 'EACCES',
            });
          }
          expect(lstatSync(directory).mode & 0o700).toBe(0o700);
          expect(lstatSync(file).mode & 0o777).toBe(0o400);
          expect(lstatSync(outside).mode & 0o777).toBe(0o500);
          rmSync(selected, options);
        },
      },
    );
    expect(attempts).toBe(2);
    expect(cleanupPackage).toHaveBeenCalledTimes(1);
    expect(existsSync(root)).toBe(false);
    expect(readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('untouched');
    expect(lstatSync(outside).mode & 0o777).toBe(0o500);
  });

  it('rejects an unrelated root before removal or permission changes', () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'unrelated-proof-'));
    outsideRoots.push(outside);
    chmodSync(outside, 0o500);
    const remove = jest.fn();
    expect(() =>
      cleanupMagneticFirstRun({ root: outside }, { remove }),
    ).toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(lstatSync(outside).mode & 0o777).toBe(0o500);
  });

  it('attempts both cleanups and preserves the primary failure when both fail', () => {
    const root = proofRoot();
    const primary = new Error('package command timed out');
    const packageFailure = new Error('package cleanup failed');
    const removalFailure = Object.assign(new Error('filesystem unavailable'), {
      code: 'EIO',
    });
    const remove = jest.fn(() => {
      throw removalFailure;
    });
    let actual;
    try {
      cleanupMagneticFirstRun(
        {
          root,
          failure: { error: primary },
          cleanupPackage: () => {
            throw packageFailure;
          },
        },
        { remove },
      );
    } catch (error) {
      actual = error;
    }
    expect(remove).toHaveBeenCalledTimes(1);
    expect(actual).toBeInstanceOf(AggregateError);
    expect(actual).toMatchObject({
      cause: primary,
      errors: [primary, packageFailure, removalFailure],
    });
  });

  it('still removes the proof tree when package cleanup fails', () => {
    const root = proofRoot();
    const failure = new Error('package cleanup failed');
    expect(() =>
      cleanupMagneticFirstRun({
        root,
        cleanupPackage: () => {
          throw failure;
        },
      }),
    ).toThrow(failure);
    expect(existsSync(root)).toBe(false);
  });

  it('leaves the original proof failure intact when cleanup succeeds', () => {
    const root = proofRoot();
    const primary = new Error('package command timed out');
    const run = () => {
      try {
        throw primary;
      } finally {
        cleanupMagneticFirstRun({ root, failure: { error: primary } });
      }
    };
    expect(run).toThrow(primary);
    expect(existsSync(root)).toBe(false);
  });
});
