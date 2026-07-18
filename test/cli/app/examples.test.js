/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
      inputInput: JSON.stringify({ who: 'jest', message: 'demo' }),
      callerMetadataInput: JSON.stringify({ requestId: 'req-123' }),
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
      activities: {
        'echo-event': {
          entrypoint: {
            kind: 'node',
            path: 'activities.js',
            export: 'echoEvent',
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

  it('rejects the removed resources field at the app boundary', async () => {
    const dir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-resource-rejection-example-'),
    );
    try {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }),
      );
      writeFileSync(
        path.join(dir, 'cli.js'),
        'export async function main() {}\n',
      );
      writeFileSync(
        path.join(dir, 'activity.js'),
        'export async function inspect() { return { ok: true }; }\n',
      );
      writeFileSync(
        path.join(dir, 'wharfie.app.js'),
        `export default {
  schemaVersion: 2,
  app: { id: 'resource-rejection-example' },
  cli: { entrypoint: { kind: 'node', path: './cli.js', export: 'main' } },
  resources: { db: { adapter: 'vanilla' } },
  activities: {
    inspect: {
      entrypoint: { kind: 'node', path: './activity.js', export: 'inspect' },
    },
  },
};\n`,
      );

      await expect(
        runLocalApp({
          dir,
          activityName: 'inspect',
          inputInput: JSON.stringify({ who: 'demo-user' }),
        }),
      ).rejects.toThrow(/app\.resources is not supported by schemaVersion 2/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invokes a named source activity through the public app API', async () => {
    const dir = path.join(examplesDir, 'apps', 'hello-world');

    await expect(
      invokeActivity('echo-event', {
        dir,
        input: { who: 'public-api' },
        callerMetadata: { requestId: 'req-public-api' },
      }),
    ).resolves.toEqual({
      ok: true,
      who: 'public-api',
      message: 'hello public-api',
      requestId: 'req-public-api',
    });
  });

  it('rejects the obsolete event/context public invocation fields', async () => {
    const dir = path.join(examplesDir, 'apps', 'hello-world');

    await expect(
      invokeActivity(
        'echo-event',
        /** @type {any} */ ({ dir, event: { who: 'legacy' } }),
      ),
    ).rejects.toThrow('invokeActivity.event is not supported');
  });

  it('treats a resources key in caller metadata as ordinary inert JSON', async () => {
    const dir = path.join(examplesDir, 'apps', 'hello-world');

    await expect(
      runLocalApp({
        dir,
        activityName: 'echo-event',
        callerMetadataInput: JSON.stringify({
          requestId: 'req-456',
          resources: {
            queue: { adapter: 'injected-queue' },
            extra: { note: 'user-provided' },
          },
        }),
      }),
    ).resolves.toMatchObject({
      result: {
        ok: true,
        who: 'world',
        message: 'hello world',
        requestId: 'req-456',
      },
    });
  });
});
