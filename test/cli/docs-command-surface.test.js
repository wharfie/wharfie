/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { existsSync, promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const docsToCheck = [
  'docs/src/assets/markdown/home.md',
  'docs/src/assets/markdown/quickstart.md',
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
];

const removedCliPaths = [
  'src/cli/cmds/deployment.js',
  'src/cli/cmds/deployment_cmds',
  'src/cli/cmds/project.js',
  'src/cli/cmds/project_cmds',
  'src/cli/cmds/utils.js',
  'src/cli/cmds/utils_cmds',
  'src/cli/output/deployment',
  'src/cli/output/project',
  'src/cli/output/error.js',
  'src/cli/output/escapes.js',
  'src/cli/project/index.js',
  'src/cli/project/load.js',
  'src/cli/project/template-actor.js',
];

const preservedCliPaths = [
  'src/cli/project/project_structure_examples/models/abo-aggregated.sql',
  'src/cli/project/project_structure_examples/sources/noaa-global-surface-summary.yaml',
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

  it('keeps only the supported CLI implementation on disk', async () => {
    for (const relativePath of removedCliPaths) {
      expect(existsSync(path.join(repoRoot, relativePath))).toBe(false);
    }

    for (const relativePath of preservedCliPaths) {
      expect(existsSync(path.join(repoRoot, relativePath))).toBe(true);
    }

    const packageJson = JSON.parse(
      await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    );

    expect(packageJson.files).toEqual([
      'README.md',
      'bin/',
      'apps/wharfie-v1/wharfie.app.js',
      'src/',
    ]);
  });

  it('documents working onboarding commands in the quickstart', async () => {
    const quickstart = await fsp.readFile(
      path.join(repoRoot, 'docs/src/assets/markdown/quickstart.md'),
      'utf8',
    );

    expect(quickstart).toContain('wharfie config');
    expect(quickstart).toContain('wharfie init my_project');
    expect(quickstart).toContain(
      'wharfie app manifest ./path/to/wharfie.app.js',
    );
    expect(quickstart).toContain(
      `wharfie app run <function_name> --dir ./path/to/app --event '{"who":"cli-user"}'`,
    );
  });
});
