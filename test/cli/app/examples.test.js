/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../../../lambdas/lib/actor/resources/builds/function.js';
import { loadApp } from '../../../cli/app/load-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const examplesDir = path.join(repoRoot, 'scratch', 'examples');

describe('function + ActorSystem demos', () => {
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
