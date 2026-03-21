/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../../../lambdas/lib/actor/resources/builds/function.js';
import { loadApp } from '../../../cli/app/load-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const examplesDir = path.join(repoRoot, 'scratch', 'examples');

describe('Function + ActorSystem demos', () => {
  it('runs the echo-event demo through the Function API', async () => {
    const fn = new Function({
      name: 'echo-event',
      entrypoint: {
        path: path.join(examplesDir, 'functions', 'echo-event.js'),
        export: 'echoEvent',
      },
    });

    await expect(
      fn.fn({ who: 'jest', message: 'demo' }, { requestId: 'req-123' }),
    ).resolves.toEqual({
      ok: true,
      who: 'jest',
      message: 'demo',
      requestId: 'req-123',
    });
  });

  it('loads the hello-world ActorSystem demo and invokes its functions', async () => {
    const dir = path.join(examplesDir, 'actor-systems', 'hello-world');
    const { appExport, manifest } = await loadApp({ dir });

    expect(manifest.app.name).toBe('hello-world-demo');
    expect(Array.isArray(manifest.targets)).toBe(true);
    expect(manifest.capabilities?.db).toBeDefined();
    expect(manifest.capabilities?.queue).toBeDefined();
    expect(manifest.capabilities?.objectStorage).toBeDefined();

    try {
      await expect(
        appExport.invoke('echo-event', { who: 'demo-user' }),
      ).resolves.toEqual({
        ok: true,
        who: 'demo-user',
        message: 'hello demo-user',
        requestId: null,
      });

      await expect(
        appExport.invoke('hello-resources', { who: 'demo-user' }),
      ).resolves.toMatchObject({
        who: 'demo-user',
        dbRecord: {
          id: 'greeting',
          who: 'demo-user',
          message: 'hello demo-user',
        },
        queueBody: JSON.stringify({ hello: 'demo-user' }),
        objectBody: 'hello demo-user',
      });
    } finally {
      await appExport.closeRuntimeResources();
    }
  });

  it('loads the kitchen-sink ActorSystem fixture and preserves the scratch/test.js shape', async () => {
    const dir = path.join(examplesDir, 'actor-systems', 'kitchen-sink');
    const { appExport, manifest } = await loadApp({ dir });

    expect(manifest.app.name).toBe('kitchen-sink-demo');
    expect(manifest.targets).toEqual([
      {
        nodeVersion: '24',
        platform: 'darwin',
        architecture: 'arm64',
      },
      {
        nodeVersion: '24',
        platform: 'linux',
        architecture: 'x64',
      },
    ]);
    expect(manifest.capabilities?.db).toBeDefined();
    expect(manifest.capabilities?.queue).toBeDefined();
    expect(manifest.capabilities?.objectStorage).toBeDefined();

    const [startFunction] = appExport.functions;
    expect(startFunction.name).toBe('start');
    expect(startFunction.entrypoint).toEqual({
      path: path.join(repoRoot, 'scratch', 'functions', 'start.js'),
      export: 'start',
    });
    expect(startFunction.properties.external).toEqual([
      expect.objectContaining({ name: 'lmdb', version: expect.any(String) }),
      { name: 'sharp', version: '0.34.4' },
      { name: 'sodium-native', version: '5.0.9' },
      expect.objectContaining({
        name: '@duckdb/node-api',
        version: expect.any(String),
      }),
      { name: 'usb', version: '2.13.0' },
    ]);
    expect(startFunction.properties.resources).toMatchObject({
      db: { adapter: 'vanilla', options: expect.any(Object) },
      queue: { adapter: 'vanilla', options: expect.any(Object) },
      objectStorage: { adapter: 'vanilla', options: expect.any(Object) },
    });

    const systemResources = await appExport.getRuntimeResources();
    const functionResources = await startFunction.getRuntimeResources();
    expect(systemResources.db).toBeDefined();
    expect(systemResources.queue).toBeDefined();
    expect(systemResources.objectStorage).toBeDefined();
    expect(functionResources.db).toBeDefined();
    expect(functionResources.queue).toBeDefined();
    expect(functionResources.objectStorage).toBeDefined();
    expect(functionResources.db).not.toBe(systemResources.db);
    expect(functionResources.queue).not.toBe(systemResources.queue);
    expect(functionResources.objectStorage).not.toBe(
      systemResources.objectStorage,
    );

    try {
      const result = await appExport.invoke('start', {
        who: 'demo-user',
        iterations: 32,
      });
      expect(result).toMatchObject({
        ok: true,
        who: 'demo-user',
        resourceKinds: ['db', 'objectStorage', 'queue'],
        resources: {
          dbRecord: {
            id: expect.stringContaining('greeting-'),
            who: 'demo-user',
            message: 'hello demo-user',
            runId: expect.any(String),
          },
          objectBody: 'hello demo-user',
        },
        native: {
          lmdbRecord: {
            who: 'demo-user',
            message: 'hello demo-user',
            runId: expect.any(String),
          },
          duckdb: {
            version: expect.any(String),
            rangeSum: 10,
          },
        },
        benchmark: {
          iterations: 32,
          accumulator: expect.any(Number),
        },
      });
      expect(JSON.parse(result.resources.queueBody)).toMatchObject({
        hello: 'demo-user',
        runId: result.runId,
      });
    } finally {
      await appExport.closeRuntimeResources();
    }
  });

  it('loads the context-override ActorSystem demo and shows resource merging', async () => {
    const dir = path.join(examplesDir, 'actor-systems', 'context-override');
    const { appExport, manifest } = await loadApp({ dir });

    expect(manifest.app.name).toBe('context-override-demo');
    expect(Array.isArray(manifest.targets)).toBe(true);
    expect(manifest.capabilities?.db).toBeDefined();

    try {
      await expect(
        appExport.invoke(
          'inspect-context',
          {},
          {
            requestId: 'req-456',
            resources: {
              queue: { adapter: 'injected-queue' },
              extra: { note: 'user-provided' },
            },
          },
        ),
      ).resolves.toEqual({
        requestId: 'req-456',
        resourceKeys: ['db', 'extra', 'queue'],
        dbPresent: true,
        queueAdapter: 'injected-queue',
        extraNote: 'user-provided',
      });
    } finally {
      await appExport.closeRuntimeResources();
    }
  });
});
