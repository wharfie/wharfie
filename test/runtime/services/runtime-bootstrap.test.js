/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { afterEach, describe, expect, it } from '@jest/globals';

import { loadRuntimeBootstrap } from '../../../src/core/resources/builds/actor-system-cli/lib/runtime-bootstrap.js';
import { SHARED_RESOURCE_REGISTRY_FILE_NAME } from '../../../src/core/runtime/shared-resource-registry.js';

const ORIGINAL_ENV = process.env;

const manifest = {
  schemaVersion: 2,
  app: { id: 'runtime-bootstrap-demo' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: 'cli.js',
      export: 'default',
    },
  },
  resources: {
    db: {
      adapter: 'vanilla',
      options: { path: '.wharfie/db' },
    },
    queue: {
      adapter: 'vanilla',
      options: { path: '.wharfie/queue' },
    },
    objectStorage: {
      adapter: 'vanilla',
      options: { path: '.wharfie/object-storage' },
    },
  },
  activities: {
    start: {
      entrypoint: {
        kind: 'node',
        path: 'functions/start.js',
        export: 'start',
      },
    },
  },
};

const invalidEnvironmentManifest = {
  ...manifest,
  app: { id: 'unsupported-environment-manifest' },
  activities: {
    start: {
      entrypoint: {
        kind: 'node',
        path: 'functions/start.js',
        export: 'start',
      },
      environmentVariables: {},
    },
  },
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
  delete process.env.CONFIG_DIR;
  delete process.env.WHARFIE_RESOURCES;
  delete process.env.WHARFIE_APP_MANIFEST;
});

describe('runtime bootstrap helpers', () => {
  it('rejects removed activity environment fields in provided manifests', async () => {
    const secret = 'runtime-manifest-environment-secret-sentinel';
    const result = loadRuntimeBootstrap({
      manifest: JSON.stringify({
        ...invalidEnvironmentManifest,
        activities: {
          ...invalidEnvironmentManifest.activities,
          start: {
            ...invalidEnvironmentManifest.activities.start,
            environmentVariables: { API_TOKEN: secret },
          },
        },
      }),
    });

    await expect(result).rejects.toThrow(
      /activities\.start\.environmentVariables.*not supported/i,
    );
    await expect(result).rejects.not.toThrow(secret);
  });

  it('derives portable resources and services from a canonical manifest', async () => {
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
    expect(bootstrap.pollQueueUrls).toEqual([]);
    expect(bootstrap.servicePlan).toEqual({
      db: true,
      queue: true,
      objectStorage: true,
      lambda: true,
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
    });
  });

  it('resolves shared resource refs from the Wharfie config dir before planning services', async () => {
    const configDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-bootstrap-config-'),
    );
    process.env.CONFIG_DIR = configDir;

    const sharedRegistry = {
      db: {
        appdb: {
          adapter: 'vanilla',
          options: { path: '.shared/db' },
        },
      },
      queue: {
        jobs: {
          adapter: 'vanilla',
          options: {
            path: '.shared/queue',
            queueUrls: ['queue://shared-jobs'],
          },
        },
      },
      objectStorage: {
        blobs: {
          adapter: 'vanilla',
          options: { path: '.shared/object-storage' },
        },
      },
    };

    await fsp.writeFile(
      path.join(configDir, SHARED_RESOURCE_REGISTRY_FILE_NAME),
      JSON.stringify(sharedRegistry, null, 2),
      'utf8',
    );

    const bootstrap = await loadRuntimeBootstrap({
      manifest: JSON.stringify(manifest),
      resources: JSON.stringify({
        db: { ref: 'appdb' },
        queue: { ref: 'jobs' },
        objectStorage: { ref: 'blobs' },
      }),
    });

    expect(bootstrap.resourcesSpec).toEqual({
      db: sharedRegistry.db.appdb,
      queue: sharedRegistry.queue.jobs,
      objectStorage: sharedRegistry.objectStorage.blobs,
    });
    expect(bootstrap.pollQueueUrls).toEqual(['queue://shared-jobs']);
    expect(bootstrap.servicePlan).toEqual({
      db: true,
      queue: true,
      objectStorage: true,
      lambda: true,
    });
  });
});
