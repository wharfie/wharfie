/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { invokeActivity } from '../../../src/app.js';
import { runLocalApp } from '../../../src/cli/app/local-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const examplesDir = path.join(repoRoot, 'scratch', 'examples');

describe('schemaVersion 2 app demos', () => {
  it('loads the canonical hello-world manifest and runs an activity', async () => {
    const dir = path.join(examplesDir, 'apps', 'hello-world');
    const { manifest, result } = await runLocalApp({
      dir,
      activityName: 'echo-event',
      eventInput: JSON.stringify({ who: 'jest', message: 'demo' }),
      contextInput: JSON.stringify({ requestId: 'req-123' }),
    });

    expect(manifest).toEqual({
      schemaVersion: 2,
      app: { id: 'hello-world-demo' },
      cli: {
        entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
      },
      targets: [
        {
          nodeVersion: '24.13.1',
          platform: 'darwin',
          architecture: 'arm64',
        },
        {
          nodeVersion: '24.13.1',
          platform: 'linux',
          architecture: 'x64',
          libc: 'glibc',
        },
      ],
      resources: {
        db: {
          adapter: 'vanilla',
          options: { path: 'tmp/wharfie-examples/hello-world' },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: 'tmp/wharfie-examples/hello-world' },
        },
        objectStorage: {
          adapter: 'vanilla',
          options: { path: 'tmp/wharfie-examples/hello-world' },
        },
      },
      activities: {
        'echo-event': {
          entrypoint: {
            kind: 'node',
            path: 'activities.js',
            export: 'echoEvent',
          },
        },
        'hello-resources': {
          entrypoint: {
            kind: 'node',
            path: 'activities.js',
            export: 'helloResources',
          },
        },
      },
    });
    expect(result).toEqual({
      ok: true,
      who: 'jest',
      message: 'demo',
      requestId: 'req-123',
    });
  });

  it('runs the resource-backed hello-world activity through the local runner', async () => {
    const dir = path.join(examplesDir, 'apps', 'hello-world');
    const { result } = await runLocalApp({
      dir,
      activityName: 'hello-resources',
      eventInput: JSON.stringify({ who: 'demo-user' }),
    });

    expect(result).toMatchObject({
      who: 'demo-user',
      dbRecord: {
        id: 'greeting',
        who: 'demo-user',
        message: 'hello demo-user',
      },
      queueBody: JSON.stringify({ hello: 'demo-user' }),
      objectBody: 'hello demo-user',
    });
  });

  it('invokes a named source activity through the public app API', async () => {
    const dir = path.join(examplesDir, 'apps', 'hello-world');

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

  it('merges caller context over canonical app resources', async () => {
    const dir = path.join(examplesDir, 'apps', 'context-override');
    const { manifest, result } = await runLocalApp({
      dir,
      activityName: 'inspect-context',
      contextInput: JSON.stringify({
        requestId: 'req-456',
        resources: {
          queue: { adapter: 'injected-queue' },
          extra: { note: 'user-provided' },
        },
      }),
    });

    expect(manifest.app).toEqual({ id: 'context-override-demo' });
    expect(manifest.resources).toEqual({
      db: {
        adapter: 'vanilla',
        options: { path: 'tmp/wharfie-examples/context-override' },
      },
    });
    expect(result).toEqual({
      requestId: 'req-456',
      resourceKeys: ['db', 'extra', 'queue'],
      dbPresent: true,
      queueAdapter: 'injected-queue',
      extraNote: 'user-provided',
    });
  });
});
