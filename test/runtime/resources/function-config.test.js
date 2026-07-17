/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../../../src/core/resources/builds/function.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';

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

  it('supports function-scoped resources and rejects ambient external invocation', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-config-'),
    );
    const actorPath = fileURLToPath(
      new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
    );

    const externalFn = new Function({
      name: 'hello-resources',
      entrypoint: { path: actorPath, export: 'helloResources' },
      properties: {
        external: [
          'lmdb@3.4.4',
          { name: '@paralleldrive/cuid2', version: '2.2.2' },
        ],
      },
    });

    expect(externalFn.properties.external).toEqual([
      {
        name: '@paralleldrive/cuid2',
        version: '2.2.2',
      },
      {
        name: 'lmdb',
        version: '3.4.4',
      },
    ]);
    await expect(externalFn.fn({ who: 'function-scope' })).rejects.toThrow(
      /prepared application revision/i,
    );

    const fn = new Function({
      name: 'hello-resources',
      entrypoint: { path: actorPath, export: 'helloResources' },
      properties: {
        resources: {
          db: { adapter: 'vanilla', options: { path: tmp } },
          queue: { adapter: 'vanilla', options: { path: tmp } },
          objectStorage: { adapter: 'vanilla', options: { path: tmp } },
        },
      },
    });

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

  it('requires exact external dependencies for FunctionResource builds too', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-resource-config-'),
    );
    const entryPath = path.join(tmp, 'handler.js');

    await fsp.writeFile(
      entryPath,
      ['export function handler() {', "  return 'ok';", '}'].join('\n'),
      'utf8',
    );

    expect(
      () =>
        new FunctionResource({
          name: 'ambient-resource-config',
          properties: {
            functionName: 'ambient-resource-config',
            entrypoint: { path: entryPath, export: 'handler' },
            buildTarget: {
              nodeVersion: process.versions.node,
              platform: process.platform,
              architecture: process.arch,
            },
            external: ['lmdb'],
          },
        }),
    ).toThrow(/must include an exact version/i);

    const resource = new FunctionResource({
      name: 'resource-config',
      properties: {
        functionName: 'resource-config',
        entrypoint: { path: entryPath, export: 'handler' },
        buildTarget: {
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
          ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
        },
        external: [
          'lmdb@3.4.4',
          { name: '@paralleldrive/cuid2', version: '2.2.2' },
        ],
      },
    });

    expect(resource.get('external')).toEqual([
      {
        name: '@paralleldrive/cuid2',
        version: '2.2.2',
      },
      {
        name: 'lmdb',
        version: '3.4.4',
      },
    ]);

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('bundles the running Wharfie app API instead of an app-local copy', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-runtime-alias-'),
    );
    const localWharfie = path.join(tmp, 'node_modules', '@wharfie', 'wharfie');
    const entryPath = path.join(tmp, 'handler.js');

    try {
      await fsp.mkdir(localWharfie, { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(localWharfie, 'package.json'),
          JSON.stringify({
            name: '@wharfie/wharfie',
            version: '0.0.0-poisoned',
            type: 'module',
            exports: { './app': './app.js' },
          }),
        ),
        fsp.writeFile(
          path.join(localWharfie, 'app.js'),
          "export const defineApp = () => ({ source: 'poisoned-app-local-runtime' });\n",
        ),
        fsp.writeFile(
          entryPath,
          [
            "import { defineApp } from '@wharfie/wharfie/app';",
            "export function handler() { return defineApp({ source: 'revision-runtime' }); }",
          ].join('\n'),
        ),
      ]);

      const resource = new FunctionResource({
        name: 'runtime-alias',
        properties: {
          functionName: 'runtime-alias',
          entrypoint: { path: entryPath, export: 'handler' },
          buildTarget: {
            nodeVersion: process.versions.node,
            platform: process.platform,
            architecture: process.arch,
            ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
          },
        },
      });

      const code = await resource.esbuild();
      expect(code).toContain('revision-runtime');
      expect(code).not.toContain('poisoned-app-local-runtime');
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects noncanonical activity identities before building code', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-entry-code-'),
    );
    const entryPath = path.join(tmp, 'handler.js');
    const functionName = "activity'); globalThis.__wharfieInjected = true; //";

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

      await expect(resource.esbuild()).rejects.toThrow(/canonical logical ID/i);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
