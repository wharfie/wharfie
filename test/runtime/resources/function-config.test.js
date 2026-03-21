/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../../../lambdas/lib/actor/resources/builds/function.js';
import FunctionResource from '../../../lambdas/lib/actor/resources/builds/function-resource.js';

const require = createRequire(import.meta.url);

/**
 * @param {string} packageName - packageName.
 * @returns {string} - Result.
 */
function readInstalledVersion(packageName) {
  const entryPath = require.resolve(packageName);
  let currentDir = path.dirname(entryPath);

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (manifest?.name === packageName && manifest?.version) {
        return manifest.version;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(`Could not resolve installed version for ${packageName}`);
}

describe('Function configuration hard edges', () => {
  it('supports function-scoped resources and auto-resolves bare externals', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-config-'),
    );
    const actorPath = fileURLToPath(
      new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
    );

    const fn = new Function({
      name: 'hello-resources',
      entrypoint: { path: actorPath, export: 'helloResources' },
      properties: {
        external: ['lmdb', { name: '@duckdb/node-api' }],
        resources: {
          db: { adapter: 'vanilla', options: { path: tmp } },
          queue: { adapter: 'vanilla', options: { path: tmp } },
          objectStorage: { adapter: 'vanilla', options: { path: tmp } },
        },
      },
    });

    expect(fn.properties.external).toEqual([
      {
        name: 'lmdb',
        version: readInstalledVersion('lmdb'),
      },
      {
        name: '@duckdb/node-api',
        version: readInstalledVersion('@duckdb/node-api'),
      },
    ]);

    const result = await fn.fn({ who: 'function-scope' });

    expect(result.who).toBe('function-scope');
    expect(result.dbRecord?.message).toBe('hello function-scope');
    expect(result.queueBody).toBe(JSON.stringify({ hello: 'function-scope' }));
    expect(result.objectBody).toBe('hello function-scope');

    const r1 = await fn.getRuntimeResources();
    const r2 = await fn.getRuntimeResources();

    expect(r1.db).toBe(r2.db);
    expect(r1.queue).toBe(r2.queue);
    expect(r1.objectStorage).toBe(r2.objectStorage);

    await fn.closeRuntimeResources();
  });

  it('normalizes bare external dependencies for FunctionResource builds too', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-resource-config-'),
    );
    const entryPath = path.join(tmp, 'handler.js');

    await fsp.writeFile(
      entryPath,
      ['export function handler() {', "  return 'ok';", '}'].join('\n'),
      'utf8',
    );

    const resource = new FunctionResource({
      name: 'resource-config',
      properties: {
        functionName: 'resource-config',
        entrypoint: { path: entryPath, export: 'handler' },
        buildTarget: {
          nodeVersion: process.versions.node.split('.')[0],
          platform: process.platform,
          architecture: process.arch,
        },
        external: ['lmdb', '@duckdb/node-api'],
      },
    });

    expect(resource.get('external')).toEqual([
      {
        name: 'lmdb',
        version: readInstalledVersion('lmdb'),
      },
      {
        name: '@duckdb/node-api',
        version: readInstalledVersion('@duckdb/node-api'),
      },
    ]);

    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
