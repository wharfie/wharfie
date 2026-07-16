/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../../../src/core/resources/builds/function.js';
import { loadApp } from '../../../src/cli/app/load-app.js';
import { invokeActivity } from '../../../src/app.js';

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

  it('runs the scratch native smoke function with required externals', async () => {
    const lmdbPath = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-scratch-start-'),
    );
    const fn = new Function({
      name: 'start',
      entrypoint: {
        path: path.join(repoRoot, 'scratch', 'functions', 'start.js'),
        export: 'start',
      },
    });

    try {
      const result = await fn.fn(
        { lmdbPath },
        { requestId: 'scratch-smoke-request' },
      );

      expect(result).toMatchObject({
        dependency: 'dependency',
        requestId: 'scratch-smoke-request',
        lmdb: {
          ok: true,
          value: 'Hello, World!',
          path: lmdbPath,
        },
      });
      expect(['ok', 'skipped']).toContain(result.sharp.status);
      expect(['ok', 'skipped']).toContain(result.sodiumNative.status);
      expect(['ok', 'skipped']).toContain(result.usb.status);
    } finally {
      await fsp.rm(lmdbPath, { recursive: true, force: true });
    }
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

  it('invokes a named source activity through the public app API', async () => {
    const dir = path.join(examplesDir, 'actor-systems', 'hello-world');

    await expect(
      invokeActivity('echo-event', {
        dir,
        event: { who: 'public-api' },
        context: { requestId: 'req-public-api' },
      }),
    ).resolves.toEqual({
      ok: true,
      who: 'public-api',
      message: 'hello public-api',
      requestId: 'req-public-api',
    });
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
