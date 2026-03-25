/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { fileURLToPath } from 'node:url';

import { build } from '../../../src/core/lib/esbuild.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

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
});
