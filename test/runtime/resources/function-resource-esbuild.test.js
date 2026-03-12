/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import FunctionResource from '../../../lambdas/lib/actor/resources/builds/function-resource.js';
import sandboxWorker from '../../../lambdas/lib/code-execution/worker.js';

describe('FunctionResource esbuild', () => {
  it('bundles import.meta.url and import.meta.dirname without empty-import-meta warnings', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-resource-esbuild-'),
    );
    const functionName = `function-resource-meta-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const entryPath = path.join(tmp, 'handler.js');

    await fsp.writeFile(
      entryPath,
      [
        "import { createRequire } from 'node:module';",
        'const require = createRequire(import.meta.url);',
        '',
        'export function handler() {',
        "  const path = require('node:path');",
        '  const base = path.basename(import.meta.dirname);',
        "  if (!base) throw new Error('Expected dirname basename');",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const resource = new FunctionResource({
        name: functionName,
        properties: {
          functionName,
          entrypoint: { path: entryPath, export: 'handler' },
          buildTarget: {
            nodeVersion: process.versions.node.split('.')[0],
            platform: process.platform,
            architecture: process.arch,
          },
        },
      });

      const codeString = await resource.esbuild();

      expect(codeString.length).toBeGreaterThan(0);
      expect(warnSpy).not.toHaveBeenCalled();

      await sandboxWorker.runInSandbox(functionName, codeString, []);
    } finally {
      warnSpy.mockRestore();
      await fsp.rm(tmp, { recursive: true, force: true });
      await sandboxWorker._destroyWorker();
      sandboxWorker._clearSandboxCache();
    }
  });
});
