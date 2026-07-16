/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import Function from '../../../src/core/resources/builds/function.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';

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
  it('rejects activity environment declarations at authoring and build boundaries', () => {
    const secret = 'function-environment-secret-sentinel';
    const entrypoint = { path: fileURLToPath(import.meta.url) };

    for (const create of [
      () =>
        new Function({
          name: 'unsupported-environment',
          entrypoint,
          properties: /** @type {any} */ ({
            environmentVariables: { API_TOKEN: secret },
          }),
        }),
      () =>
        new FunctionResource({
          name: 'unsupported-environment-resource',
          properties: /** @type {any} */ ({
            functionName: 'unsupported-environment',
            entrypoint,
            buildTarget: {
              nodeVersion: process.versions.node,
              platform: process.platform,
              architecture: process.arch,
            },
            environmentVariables: { API_TOKEN: secret },
          }),
        }),
    ]) {
      let thrown;
      try {
        create();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toEqual(expect.any(Error));
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      expect(message).toMatch(
        /activity 'unsupported-environment'.*environmentVariables.*not supported/i,
      );
      expect(message).not.toContain(secret);
    }

    const fn = new Function({
      name: 'empty-environment',
      entrypoint,
      properties: /** @type {any} */ ({ environmentVariables: {} }),
    });
    expect(fn.properties).not.toHaveProperty('environmentVariables');
  });

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
        external: ['lmdb', { name: '@paralleldrive/cuid2' }],
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
        name: '@paralleldrive/cuid2',
        version: readInstalledVersion('@paralleldrive/cuid2'),
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
        external: ['lmdb', '@paralleldrive/cuid2'],
      },
    });

    expect(resource.get('external')).toEqual([
      {
        name: 'lmdb',
        version: readInstalledVersion('lmdb'),
      },
      {
        name: '@paralleldrive/cuid2',
        version: readInstalledVersion('@paralleldrive/cuid2'),
      },
    ]);

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('quotes activity names and resolves non-identifier exports safely', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-entry-code-'),
    );
    const entryPath = path.join(tmp, 'handler.js');
    const functionName = "activity'); globalThis.__wharfieInjected = true; //";
    const runtimeGlobal = /** @type {any} */ ({ Symbol });

    try {
      await fsp.writeFile(
        entryPath,
        [
          "const handler = () => 'safe-result';",
          "export { handler as 'handler-name' };",
        ].join('\n'),
        'utf8',
      );

      const resource = new FunctionResource({
        name: 'safe-entry-code',
        properties: {
          functionName,
          entrypoint: { path: entryPath, export: 'handler-name' },
          buildTarget: {
            nodeVersion: process.versions.node,
            platform: process.platform,
            architecture: process.arch,
          },
        },
      });

      const code = await resource.esbuild();
      const runtimeContext = createContext(runtimeGlobal);
      runInContext(code, runtimeContext);
      const registeredActivity = runInContext(
        `globalThis[Symbol.for(${JSON.stringify(functionName)})]`,
        runtimeContext,
      );

      expect(runtimeGlobal.__wharfieInjected).toBeUndefined();
      expect(registeredActivity()).toBe('safe-result');
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
