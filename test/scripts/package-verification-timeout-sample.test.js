/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from '@jest/globals';

import { runCommand } from '../../scripts/package-verification.js';
import { getCommandFailure } from '../../scripts/validation-failure.js';

const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;

/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describeOnUnix('a bounded command that times out', () => {
  test('is sampled before it is killed, and the sample is kept', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wharfie-timeout-sample-'));
    roots.push(root);
    const samples = path.join(root, 'validation-failures', 'samples');
    let failure;
    try {
      runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeoutMs: 12_000,
        killSignal: 'SIGKILL',
        capture: true,
        sampleDirectory: samples,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'ETIMEDOUT' });
    const sample = getCommandFailure(failure)?.sample;
    expect(sample).toMatch(/^command-sample-[0-9a-f-]{36}\.txt$/);
    const text = readFileSync(path.join(samples, String(sample)), 'utf8');
    // The stuck child was recorded while it was still alive.
    expect(text).toMatch(/=== pid \d+\n\s*\d+\s+\d+\s+\S+/);
    expect(text).toMatch(
      process.platform === 'linux' ? /-- task \d+/ : /=== sample of pid \d+/,
    );
  }, 60_000);

  test('a command that finishes in time leaves no sample', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wharfie-timeout-sample-'));
    roots.push(root);
    const samples = path.join(root, 'validation-failures', 'samples');
    runCommand(process.execPath, ['-e', ''], {
      timeoutMs: 12_000,
      killSignal: 'SIGKILL',
      sampleDirectory: samples,
    });
    expect(existsSync(samples)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  }, 30_000);
});
