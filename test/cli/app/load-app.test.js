/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadApp } from '../../../cli/app/load-app.js';

const helloResourcesPath = fileURLToPath(
  new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
);
const actorSystemPath = fileURLToPath(
  new URL(
    '../../../lambdas/lib/actor/resources/builds/actor-system.js',
    import.meta.url,
  ),
);
const actorSystemUrl = pathToFileURL(actorSystemPath).href;
const functionPath = fileURLToPath(
  new URL(
    '../../../lambdas/lib/actor/resources/builds/function.js',
    import.meta.url,
  ),
);
const functionUrl = pathToFileURL(functionPath).href;

describe('Wharfie app loader', () => {
  it('loads a plain object export and compiles a JSON-safe manifest with functions', async () => {
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
          },
          resources: {
            db: {
              adapter: 'vanilla',
              options: { alpha: 2, zed: 1 },
            },
          },
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(Object.keys(manifest.capabilities.db.options)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(Object.keys(manifest.functions[0].environmentVariables)).toEqual([
      'ALPHA',
      'BETA',
    ]);
  });

  it('loads an ActorSystem export and preserves function definitions in the manifest', async () => {
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
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});
