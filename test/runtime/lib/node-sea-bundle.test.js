/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { build } from '../../../src/core/lib/esbuild.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const CLI_BUNDLE_TEST_TIMEOUT_MS = 20_000;

describe('src/core/lib/node-sea.js', () => {
  it('bundles into CommonJS output without top-level-await errors', async () => {
    const result = await build({
      stdin: {
        contents: [
          "import { getAsset, isSea } from './src/core/lib/node-sea.js';",
          'void getAsset;',
          'console.log(typeof isSea);',
        ].join('\n'),
        resolveDir: repoRoot,
        sourcefile: 'index.js',
      },
      write: false,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      target: `node${process.versions.node}`,
    });

    if (!result.outputFiles) {
      throw new Error('Expected esbuild outputFiles to be present');
    }

    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0].text).toMatch(/getBuiltinModule/);
  });

  it(
    'boots the bundled CLI entry with SEA-style CommonJS import.meta replacements',
    async () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wharfie-sea-cli-'));
      const outfile = path.join(tmpDir, 'bundle.cjs');

      try {
        await build({
          stdin: {
            contents: [
              "import { main } from './src/cli/entry.js';",
              'main(process.argv).catch((err) => {',
              '  console.error(err);',
              '  process.exitCode = 1;',
              '});',
            ].join('\n'),
            resolveDir: repoRoot,
            sourcefile: 'index.js',
          },
          loader: {
            '.worker.js': 'text',
          },
          outfile,
          bundle: true,
          platform: 'node',
          minify: true,
          keepNames: false,
          sourcemap: false,
          target: `node${process.versions.node}`,
          logLevel: 'silent',
          external: ['esbuild', 'node-gyp/bin/node-gyp.js', 'lmdb'],
          define: {
            __WILLEM_BUILD_RECONCILE_TERMINATOR: '1',
            'import.meta.url': '__filename',
            'import.meta.dirname': '__dirname',
          },
        });

        const result = spawnSync(process.execPath, [outfile, '--help'], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            WHARFIE_DISABLE_UPDATE_CHECK: '1',
          },
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('Usage: wharfie');
        expect(result.stdout).toContain('app');
        expect(result.stdout).toContain('ops');
        expect(result.stdout).not.toContain('build-self');
        expect(result.stdout).not.toContain('init');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    CLI_BUNDLE_TEST_TIMEOUT_MS,
  );
});
