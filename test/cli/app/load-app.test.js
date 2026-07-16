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
  it('loads a plain object export and compiles internal and public manifests', async () => {
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
          cli: {
            entrypoint: './workflow-handler.js',
            export: 'launch',
          },
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
                  activity: 'hello-resources',
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
              { activity: 'hello-resources', cron: '* * * * *' },
              { activity: 'hello-resources', cron: '*/5 * * * *' },
            ],
          },
          activities: {
            'hello-resources': {
              entrypoint: {
                path: ${JSON.stringify(helloResourcesPath)},
                export: 'helloResources',
                debug: () => 'ignored',
              },
              external: ['lmdb', '@paralleldrive/cuid2'],
              resources: {
                db: {
                  adapter: 'vanilla',
                  options: { zed: 1, alpha: 2 },
                },
                objectStorage: runtimeObjectStorage,
              },
            },
          },
        };
      `,
    );

    const { manifest, publicManifest } = await loadApp({ dir });
    expect(manifest).toEqual({
      app: { name: 'plain-object-app' },
      cli: {
        entrypoint: path.join(dir, 'workflow-handler.js'),
        export: 'launch',
      },
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
            { name: '@paralleldrive/cuid2', version: expect.any(String) },
          ],
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
    expect(publicManifest).toEqual({
      app: { name: 'plain-object-app' },
      cli: {
        entrypoint: path.join(dir, 'workflow-handler.js'),
        export: 'launch',
      },
      targets: [
        {
          nodeVersion: '24',
          platform: 'linux',
          architecture: 'x64',
        },
      ],
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
      activities: {
        'hello-resources': {
          entrypoint: {
            path: helloResourcesPath,
            export: 'helloResources',
          },
          external: [
            { name: 'lmdb', version: expect.any(String) },
            { name: '@paralleldrive/cuid2', version: expect.any(String) },
          ],
          resources: {
            db: {
              adapter: 'vanilla',
              options: { alpha: 2, zed: 1 },
            },
          },
        },
      },
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
              activity: 'hello-resources',
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
          { activity: 'hello-resources', cron: '* * * * *' },
          { activity: 'hello-resources', cron: '*/5 * * * *' },
        ],
      },
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(JSON.parse(JSON.stringify(publicManifest))).toEqual(publicManifest);
    if (
      !manifest.capabilities?.db ||
      !manifest.functions?.[0] ||
      !publicManifest.activities?.['hello-resources']
    ) {
      throw new Error(
        'Expected manifest capabilities/functions and public manifest activities to be defined.',
      );
    }
    expect(Object.keys(manifest.capabilities.db.options)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('rejects legacy plain-object functions authoring fields', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-app-legacy-'),
    );

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        export default {
          name: 'legacy-plain-object-app',
          functions: [
            {
              name: 'hello-resources',
              entrypoint: {
                path: ${JSON.stringify(helloResourcesPath)},
                export: 'helloResources',
              },
            },
          ],
        };
      `,
    );

    await expect(loadApp({ dir })).rejects.toThrow(
      /activities instead of functions/i,
    );
  });

  it('rejects activity-level environment variables without exposing values', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-env-'));
    const secret = 'activity-environment-secret-sentinel';

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        export default {
          name: 'unsupported-environment-app',
          activities: {
            hello: {
              entrypoint: { path: ${JSON.stringify(helloResourcesPath)} },
              environmentVariables: { API_TOKEN: '${secret}' },
            },
          },
        };
      `,
    );

    const result = loadApp({ dir });
    await expect(result).rejects.toThrow(
      /activity 'hello'.*environmentVariables.*not supported/i,
    );
    await expect(result).rejects.not.toThrow(secret);
  });

  it('uses trimmed activity names and rejects normalization collisions', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-activity-name-normalization-'),
    );
    const collisionDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-activity-name-collision-'),
    );

    try {
      await fsp.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      await fsp.writeFile(
        path.join(collisionDir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      await fsp.writeFile(
        path.join(dir, 'wharfie.app.js'),
        `export default {
  name: 'activity-name-normalization',
  activities: {
    ' hello ': { entrypoint: { path: ${JSON.stringify(helloResourcesPath)} } },
  },
};
`,
      );

      const loaded = await loadApp({ dir });
      expect(Object.keys(loaded.publicManifest.activities || {})).toEqual([
        'hello',
      ]);

      await fsp.writeFile(
        path.join(collisionDir, 'wharfie.app.js'),
        `export default {
  name: 'activity-name-collision',
  activities: {
    hello: { entrypoint: { path: ${JSON.stringify(helloResourcesPath)} } },
    ' hello ': { entrypoint: { path: ${JSON.stringify(helloResourcesPath)} } },
  },
};
`,
      );

      await expect(loadApp({ dir: collisionDir })).rejects.toThrow(
        /activity names must be unique after trimming/i,
      );
    } finally {
      await Promise.all([
        fsp.rm(dir, { recursive: true, force: true }),
        fsp.rm(collisionDir, { recursive: true, force: true }),
      ]);
    }
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
            cli: {
              entrypoint: './workflow-handler.js',
              export: 'launchActorSystem',
            },
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
      cli: {
        entrypoint: path.join(dir, 'workflow-handler.js'),
        export: 'launchActorSystem',
      },
      targets: [
        {
          nodeVersion: '24',
          platform: 'linux',
          architecture: 'x64',
          libc: 'glibc',
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
      requestedTargetSelectors: ['node24-linux-arm64-glibc'],
    });

    expect(filtered.manifest.targets).toEqual([
      {
        nodeVersion: '24',
        platform: 'linux',
        architecture: 'arm64',
        libc: 'glibc',
      },
    ]);
    expect(filtered.appExport.get('targets')).toEqual([
      {
        nodeVersion: '24',
        platform: 'linux',
        architecture: 'arm64',
        libc: 'glibc',
      },
    ]);
  });
});
