/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('src migration smoke tests', () => {
  it('keeps the docs deploy script pointed at the aws s3 wrapper', async () => {
    const deployScript = await fsp.readFile(
      path.join(repoRoot, 'docs', 'scripts', 'deploy.js'),
      'utf8',
    );

    expect(deployScript).toContain("import('../../src/core/lib/aws/s3.js')");
    expect(deployScript).not.toContain("import('../../src/core/lib/s3.js')");
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
});
