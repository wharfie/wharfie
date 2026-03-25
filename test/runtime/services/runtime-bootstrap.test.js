/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';

import { loadRuntimeBootstrap } from '../../../src/core/resources/builds/actor-system-cli/lib/runtime-bootstrap.js';

const ORIGINAL_ENV = process.env;

const manifest = {
  app: { name: 'runtime-bootstrap-demo' },
  resources: {
    db: {
      adapter: 'vanilla',
      options: { path: '.wharfie/db' },
    },
    queue: {
      adapter: 'vanilla',
      options: {
        path: '.wharfie/queue',
        pollQueueUrls: ['queue://runtime-bootstrap'],
      },
    },
    objectStorage: {
      adapter: 'vanilla',
      options: { path: '.wharfie/object-storage' },
    },
  },
  functions: [
    {
      name: 'start',
      entrypoint: {
        path: '/artifact/functions/start.js',
        export: 'start',
      },
    },
  ],
  scheduler: {
    triggers: [{ actor: 'start', cron: '* * * * *' }],
  },
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
  delete process.env.WHARFIE_RESOURCES;
  delete process.env.WHARFIE_APP_MANIFEST;
});

describe('runtime bootstrap helpers', () => {
  it('derives resources, queue polling, services, and scheduler triggers from a manifest', async () => {
    const bootstrap = await loadRuntimeBootstrap(
      {
        manifest: JSON.stringify(manifest),
      },
      {
        assetProvider: {
          getAsset: async () => Buffer.from(JSON.stringify(manifest), 'utf8'),
        },
      },
    );

    expect(bootstrap.manifest).toEqual(manifest);
    expect(bootstrap.resourcesSpec).toEqual(manifest.resources);
    expect(bootstrap.pollQueueUrls).toEqual(['queue://runtime-bootstrap']);
    expect(bootstrap.schedulerTriggers).toEqual([
      { actor: 'start', cron: '* * * * *' },
    ]);
    expect(bootstrap.servicePlan).toEqual({
      db: true,
      queue: true,
      objectStorage: true,
      lambda: true,
      scheduler: true,
    });
  });

  it('lets explicit resources and queue flags override the manifest bootstrap', async () => {
    const bootstrap = await loadRuntimeBootstrap({
      manifest: JSON.stringify(manifest),
      resources: JSON.stringify({
        queue: {
          adapter: 'memory',
          options: { queueUrls: ['queue://override'] },
        },
      }),
      pollQueueUrl: ['queue://cli-override'],
    });

    expect(bootstrap.resourcesSpec).toEqual({
      queue: {
        adapter: 'memory',
        options: { queueUrls: ['queue://override'] },
      },
    });
    expect(bootstrap.pollQueueUrls).toEqual(['queue://cli-override']);
    expect(bootstrap.servicePlan).toEqual({
      db: false,
      queue: true,
      objectStorage: false,
      lambda: true,
      scheduler: true,
    });
  });
});
