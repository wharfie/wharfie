/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadApp } from '../../../src/cli/app/load-app.js';

const helloResourcesPath = fileURLToPath(
  new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
);
const actorSystemPath = fileURLToPath(
  new URL(
    '../../../src/core/resources/builds/actor-system.js',
    import.meta.url,
  ),
);
const actorSystemUrl = pathToFileURL(actorSystemPath).href;
const functionPath = fileURLToPath(
  new URL('../../../src/core/resources/builds/function.js', import.meta.url),
);
const functionUrl = pathToFileURL(functionPath).href;

describe('Wharfie app loader', () => {
  it('loads a plain object export and compiles a JSON-safe manifest with functions and workflows', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-'));

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        const runtimeObjectStorage = {
          close() {},
          putObject() {},
        };

        export default {
          name: 'plain-object-app',
          properties: {
            targets: [
              {
                nodeVersion: '24',
                platform: 'linux',
                architecture: 'x64',
                ignored: () => 'ignored',
              },
            ],
            resources: {
              db: {
                adapter: 'vanilla',
                helper: () => 'ignored',
                options: { beta: 2, alpha: 1 },
              },
              queue: { adapter: 'vanilla', options: { path: '.queue' } },
              objectStorage: runtimeObjectStorage,
            },
            workflows: {
              helloPipeline: {
                actions: [
                  { id: 'start', type: 'START' },
                  {
                    id: 'invoke-hello',
                    type: 'INVOKE_FUNCTION',
                    functionName: 'hello-resources',
                    inputs: { who: 'workflow-user' },
                    placement: { mode: 'local' },
                    retry: { max_attempts: 2 },
                    prerequisites: ['start'],
                  },
                  {
                    id: 'finish',
                    type: 'FINISH',
                    dependencies: ['invoke-hello'],
                  },
                ],
              },
            },
            scheduler: {
              triggers: [
                { actor: 'hello-resources', cron: '* * * * *' },
                { functionName: 'hello-resources', cron: '*/5 * * * *' },
              ],
            },
          },
          functions: [
            {
              name: 'hello-resources',
              entrypoint: {
                path: ${JSON.stringify(helloResourcesPath)},
                export: 'helloResources',
                debug: () => 'ignored',
              },
              properties: {
                external: ['lmdb', '@duckdb/node-api'],
                environmentVariables: {
                  BETA: '2',
                  ALPHA: '1',
                  OMIT: 1,
                },
                resources: {
                  db: {
                    adapter: 'vanilla',
                    options: { zed: 1, alpha: 2 },
                  },
                  objectStorage: runtimeObjectStorage,
                },
              },
            },
          ],
        };
      `,
    );

    const { manifest } = await loadApp({ dir });
    expect(manifest).toEqual({
      app: { name: 'plain-object-app' },
      targets: [
        {
          nodeVersion: '24',
          platform: 'linux',
          architecture: 'x64',
        },
      ],
      capabilities: {
        db: {
          adapter: 'vanilla',
          options: { alpha: 1, beta: 2 },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: '.queue' },
        },
      },
      resources: {
        db: {
          adapter: 'vanilla',
          options: { alpha: 1, beta: 2 },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: '.queue' },
        },
      },
      functions: [
        {
          name: 'hello-resources',
          entrypoint: {
            path: helloResourcesPath,
            export: 'helloResources',
          },
          external: [
            { name: 'lmdb', version: expect.any(String) },
            { name: '@duckdb/node-api', version: expect.any(String) },
          ],
          environmentVariables: {
            ALPHA: '1',
            BETA: '2',
            OMIT: '1',
          },
          resources: {
            db: {
              adapter: 'vanilla',
              options: { alpha: 2, zed: 1 },
            },
          },
        },
      ],
      workflows: [
        {
          name: 'helloPipeline',
          type: 'PIPELINE',
          actions: [
            {
              id: 'start',
              type: 'START',
            },
            {
              id: 'invoke-hello',
              type: 'INVOKE_FUNCTION',
              functionName: 'hello-resources',
              inputs: { who: 'workflow-user' },
              placement: { mode: 'local' },
              retry: { max_attempts: 2 },
              dependsOn: ['start'],
            },
            {
              id: 'finish',
              type: 'FINISH',
              dependsOn: ['invoke-hello'],
            },
          ],
        },
      ],
      scheduler: {
        triggers: [
          { actor: 'hello-resources', cron: '* * * * *' },
          { actor: 'hello-resources', cron: '*/5 * * * *' },
        ],
      },
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    if (
      !manifest.capabilities?.db ||
      !manifest.functions?.[0]?.environmentVariables
    ) {
      throw new Error(
        'Expected manifest capabilities/functions to be defined.',
      );
    }
    expect(Object.keys(manifest.capabilities.db.options)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(Object.keys(manifest.functions[0].environmentVariables)).toEqual([
      'ALPHA',
      'BETA',
      'OMIT',
    ]);
  });

  it('loads an ActorSystem export and preserves function/workflow definitions in the manifest', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-'));

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        import ActorSystem from ${JSON.stringify(actorSystemUrl)};
        import Function from ${JSON.stringify(functionUrl)};

        const runtimeQueue = {
          sendMessage() {},
        };

        export default new ActorSystem({
          name: 'actor-system-app',
          functions: [
            new Function({
              name: 'hello-resources',
              entrypoint: {
                path: ${JSON.stringify(helloResourcesPath)},
                export: 'helloResources',
              },
              properties: {
                external: ['lmdb'],
                environmentVariables: {
                  MODE: 'test',
                },
                resources: {
                  db: {
                    adapter: 'vanilla',
                    options: { beta: 2, alpha: 1, path: '.fn-db' },
                  },
                  queue: runtimeQueue,
                },
              },
            }),
          ],
          properties: {
            targets: [
              {
                nodeVersion: () => '24',
                platform: () => 'linux',
                architecture: () => 'x64',
              },
            ],
            resources: {
              db: {
                adapter: 'vanilla',
                options: { beta: 2, alpha: 1, path: '.wharfie' },
              },
              queue: runtimeQueue,
            },
            workflows: [
              {
                name: 'actorPipeline',
                type: 'pipeline',
                actions: [
                  { id: 'workflow-start', type: 'START' },
                  {
                    id: 'invoke-actor',
                    type: 'INVOKE_FUNCTION',
                    function_name: 'hello-resources',
                    placement: { mode: 'local' },
                    retry: { maxAttempts: 3 },
                    dependsOn: ['workflow-start'],
                  },
                  {
                    id: 'workflow-finish',
                    type: 'FINISH',
                    dependsOn: ['invoke-actor'],
                  },
                ],
              },
            ],
            scheduler: {
              triggers: [{ actor: 'hello-resources', cron: '0 * * * *' }],
            },
          },
        });
      `,
    );

    const { manifest } = await loadApp({ dir });
    expect(manifest).toEqual({
      app: { name: 'actor-system-app' },
      targets: [
        {
          nodeVersion: '24',
          platform: 'linux',
          architecture: 'x64',
        },
      ],
      capabilities: {
        db: {
          adapter: 'vanilla',
          options: { alpha: 1, beta: 2, path: '.wharfie' },
        },
      },
      resources: {
        db: {
          adapter: 'vanilla',
          options: { alpha: 1, beta: 2, path: '.wharfie' },
        },
      },
      functions: [
        {
          name: 'hello-resources',
          entrypoint: {
            path: helloResourcesPath,
            export: 'helloResources',
          },
          external: [{ name: 'lmdb', version: expect.any(String) }],
          environmentVariables: {
            MODE: 'test',
          },
          resources: {
            db: {
              adapter: 'vanilla',
              options: { alpha: 1, beta: 2, path: '.fn-db' },
            },
          },
        },
      ],
      workflows: [
        {
          name: 'actorPipeline',
          type: 'PIPELINE',
          actions: [
            {
              id: 'workflow-start',
              type: 'START',
            },
            {
              id: 'invoke-actor',
              type: 'INVOKE_FUNCTION',
              functionName: 'hello-resources',
              placement: { mode: 'local' },
              retry: { maxAttempts: 3 },
              dependsOn: ['workflow-start'],
            },
            {
              id: 'workflow-finish',
              type: 'FINISH',
              dependsOn: ['invoke-actor'],
            },
          ],
        },
      ],
      scheduler: {
        triggers: [{ actor: 'hello-resources', cron: '0 * * * *' }],
      },
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('re-loads ActorSystem exports with requestedTargetSelectors before manifest compilation', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-'));

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        import ActorSystem from ${JSON.stringify(actorSystemUrl)};

        export default new ActorSystem({
          name: 'target-filter-app',
          properties: {
            targets: [
              {
                nodeVersion: '24',
                platform: 'linux',
                architecture: 'x64',
              },
              {
                nodeVersion: '24',
                platform: 'linux',
                architecture: 'arm64',
              },
            ],
            resources: {},
          },
        });
      `,
    );

    const filtered = await loadApp({
      dir,
      requestedTargetSelectors: ['node24-linux-arm64'],
    });

    expect(filtered.manifest.targets).toEqual([
      {
        nodeVersion: '24',
        platform: 'linux',
        architecture: 'arm64',
      },
    ]);
    expect(filtered.appExport.get('targets')).toEqual([
      {
        nodeVersion: '24',
        platform: 'linux',
        architecture: 'arm64',
      },
    ]);
  });
});
