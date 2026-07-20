/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import paths from '../../../src/core/lib/paths.js';

describe('Wharfie path creation', () => {
  test('creates a missing config hierarchy privately under a permissive umask', async () => {
    const temporaryRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-paths-'),
    );
    const originalConfigDir = process.env.CONFIG_DIR;
    const originalUmask = process.umask(0o002);
    const configRoot = path.join(temporaryRoot, '.config');
    process.env.CONFIG_DIR = path.join(configRoot, 'wharfie-nodejs');

    try {
      await paths.createWharfiePaths();

      expect((await fsp.stat(configRoot)).mode & 0o777).toBe(0o700);
      expect((await fsp.stat(process.env.CONFIG_DIR)).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(originalUmask);
      if (originalConfigDir === undefined) {
        delete process.env.CONFIG_DIR;
      } else {
        process.env.CONFIG_DIR = originalConfigDir;
      }
      await fsp.rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
