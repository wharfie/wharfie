/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const docsToCheck = [
  'docs/src/assets/markdown/home.md',
  'docs/src/assets/markdown/quickstart.md',
  'docs/src/assets/markdown/installation.md',
  'docs/src/assets/markdown/project-structure.md',
  'contributing/FAQ.md',
  'contributing/project.md',
];

const staleCommands = [
  'wharfie deployment create',
  'wharfie project init',
  'wharfie project plan',
  'wharfie project apply',
  'wharfie project cost',
  'wharfie project dev',
  'wharfie config',
  'wharfie list',
  'wharfie init',
  'wharfie build-self',
  'wharfie ops list',
  'wharfie ops cancel',
  'wharfie ops run --recover',
  '--operation-id',
];

describe('docs command surface', () => {
  it('does not advertise unsupported command groups in public docs', async () => {
    const contents = await Promise.all(
      docsToCheck.map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const content of contents) {
      for (const staleCommand of staleCommands) {
        expect(content).not.toContain(staleCommand);
      }
    }
  });

  it('documents the honest source-only installation path', async () => {
    const installationDoc = await fsp.readFile(
      path.join(repoRoot, 'docs/src/assets/markdown/installation.md'),
      'utf8',
    );

    expect(installationDoc).toContain('npm ci');
    expect(installationDoc).toContain('node ./bin/wharfie --help');
    expect(installationDoc).toContain('standalone builder binary');
    expect(installationDoc).toContain('release-ready binary installer');
    expect(installationDoc).not.toContain('releases/latest');
    expect(installationDoc).not.toContain('install.sh');
    expect(installationDoc).not.toContain('install.ps1');

    await expect(
      fsp.access(path.join(repoRoot, 'install.sh')),
    ).rejects.toThrow();
    await expect(
      fsp.access(path.join(repoRoot, 'install.ps1')),
    ).rejects.toThrow();
  });

  it('narrows the published npm surface to supported CLI modules', async () => {
    const packageJson = JSON.parse(
      await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    );

    expect(packageJson.files).toContain('src/core/**');
    expect(packageJson.files).toContain('src/cli/**');
    expect(packageJson.files).not.toContain('apps/wharfie-cli/**');
    expect(packageJson.files).not.toContain('src/');
    expect(
      packageJson.files.some((/** @type {string} */ entry) =>
        entry.startsWith('!'),
      ),
    ).toBe(false);
  });

  it('documents working onboarding commands in the quickstart', async () => {
    const quickstart = await fsp.readFile(
      path.join(repoRoot, 'docs/src/assets/markdown/quickstart.md'),
      'utf8',
    );

    expect(quickstart).toContain('wharfie.app.js');
    expect(quickstart).toContain('wharfie app manifest ./path/to/app');
    expect(quickstart).toContain(
      `wharfie app run <activity-id> --dir ./path/to/app --input '{\"who\":\"cli-user\"}'`,
    );
    expect(quickstart).toContain(
      'wharfie ops run --activity <activity-id> --dir ./path/to/app',
    );
    expect(quickstart).toContain('--idempotency-key <stable-key>');
    expect(quickstart).not.toContain('--operation-id');
    expect(quickstart).toContain('append-only run → invocation → attempt');
    expect(quickstart).toContain('wharfie ops inspect --run-id <run-id>');
    expect(quickstart).toContain(
      'wharfie ops recover --run-id <run-id> --confirm-runner-stopped',
    );
    expect(quickstart).not.toContain('wharfie ops list');
    expect(quickstart).not.toContain('wharfie ops cancel');
  });
});
