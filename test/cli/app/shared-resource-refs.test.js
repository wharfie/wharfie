/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from '@jest/globals';

import { runLocalApp } from '../../../src/cli/app/local-app.js';
import { SHARED_RESOURCE_REGISTRY_FILE_NAME } from '../../../src/core/runtime/shared-resource-registry.js';

const helloResourcesPath = fileURLToPath(
  new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
);
const actorSystemUrl = pathToFileURL(
  fileURLToPath(
    new URL(
      '../../../src/core/resources/builds/actor-system.js',
      import.meta.url,
    ),
  ),
).href;
const functionUrl = pathToFileURL(
  fileURLToPath(
    new URL('../../../src/core/resources/builds/function.js', import.meta.url),
  ),
).href;

afterEach(() => {
  delete process.env.CONFIG_DIR;
});

describe('shared resource refs during local app runs', () => {
  it('runLocalApp resolves shared refs from the Wharfie config dir', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-local-run-shared-'),
    );
    const configDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-local-run-config-'),
    );
    process.env.CONFIG_DIR = configDir;

    await fsp.writeFile(
      path.join(configDir, SHARED_RESOURCE_REGISTRY_FILE_NAME),
      JSON.stringify(
        {
          db: {
            appdb: {
              adapter: 'vanilla',
              options: { path: path.join(configDir, 'db') },
            },
          },
          queue: {
            jobs: {
              adapter: 'vanilla',
              options: { path: path.join(configDir, 'queue') },
            },
          },
          objectStorage: {
            blobs: {
              adapter: 'vanilla',
              options: { path: path.join(configDir, 'object-storage') },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
      'utf8',
    );
    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        import ActorSystem from ${JSON.stringify(actorSystemUrl)};
        import Function from ${JSON.stringify(functionUrl)};

        export default new ActorSystem({
          name: 'local-run-shared-resources',
          functions: [
            new Function({
              name: 'hello-resources',
              entrypoint: {
                path: ${JSON.stringify(helloResourcesPath)},
                export: 'helloResources',
              },
            }),
          ],
          properties: {
            targets: [],
            resources: {
              db: { ref: 'appdb' },
              queue: { ref: 'jobs' },
              objectStorage: { ref: 'blobs' },
            },
          },
        });
      `,
      'utf8',
    );

    const { result } = await runLocalApp({
      dir,
      functionName: 'hello-resources',
      eventInput: JSON.stringify({ who: 'shared-local' }),
    });

    expect(result).toMatchObject({
      who: 'shared-local',
      dbRecord: {
        id: 'greeting',
        message: 'hello shared-local',
      },
      queueBody: JSON.stringify({ hello: 'shared-local' }),
      objectBody: 'hello shared-local',
    });
  });
});
