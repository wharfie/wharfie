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
  'docs/src/assets/markdown/project-structure.md',
  'docs/src/assets/markdown/legacy-v1.md',
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

  it('keeps the installation guide pointed at the current AWS CLI docs', async () => {
    const installationDoc = await fsp.readFile(
      path.join(repoRoot, 'docs/src/assets/markdown/installation.md'),
      'utf8',
    );

    expect(installationDoc).toContain(
      'https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html',
    );
    expect(installationDoc).not.toContain(
      'https://docs.aws.amazon.com/src/cli/v1/userguide/cli-chap-configure.html',
    );
  });

  it('keeps the self-hosted Wharfie CLI template asset path under src/cli', async () => {
    const wharfieApp = await fsp.readFile(
      path.join(repoRoot, 'apps', 'wharfie-cli', 'wharfie.app.js'),
      'utf8',
    );

    expect(wharfieApp).toMatch(
      /path\.join\(\s*repoRoot,\s*'src',\s*'cli',\s*'project',\s*'project_structure_examples',\s*\)/m,
    );
    expect(wharfieApp).not.toMatch(
      /path\.join\(\s*repoRoot,\s*'cli',\s*'project',\s*'project_structure_examples',\s*\)/m,
    );
  });

  it('narrows the published npm surface to supported CLI modules', async () => {
    const packageJson = JSON.parse(
      await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    );

    expect(packageJson.files).toContain('apps/wharfie-cli/wharfie.app.js');
    expect(packageJson.files).not.toContain('apps/wharfie-v1/wharfie.app.js');
    expect(packageJson.files).toContain('src/core/**');
    expect(packageJson.files).toContain(
      'src/cli/project/project_structure_examples/**',
    );
    expect(packageJson.files).not.toContain('src/');
    expect(packageJson.files).not.toContain('src/cli/project/**');
    expect(packageJson.files).not.toContain('src/cli/cmds/project_cmds/**');
    expect(packageJson.files).not.toContain('!src/cli/cmds/project_cmds/**');
  });

  it('documents working onboarding commands in the quickstart', async () => {
    const quickstart = await fsp.readFile(
      path.join(repoRoot, 'docs/src/assets/markdown/quickstart.md'),
      'utf8',
    );

    expect(quickstart).not.toContain('wharfie config');
    expect(quickstart).toContain('wharfie init my_app');
    expect(quickstart).toContain('wharfie app manifest ./my_app');
    expect(quickstart).toContain(
      `wharfie app run hello --dir ./my_app --event '{"who":"cli-user"}'`,
    );
    expect(quickstart).toContain('wharfie app package ./my_app');
    expect(quickstart).toContain(
      `wharfie ops run --activity hello --dir ./my_app --event '{"who":"cli-user"}'`,
    );
  });
});
