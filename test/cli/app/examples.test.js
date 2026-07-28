/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { invokeActivity } from '../../../src/app.js';
import { runLocalApp } from '../../../src/cli/app/local-app.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../../helpers/isolated-authored-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const examplesDir = path.join(repoRoot, 'scratch', 'examples');
const authoredHelloWorldDir = path.join(examplesDir, 'apps', 'hello-world');
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

afterEach(() => {
  cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
});

/** @returns {string} - Fresh copy of the tracked authored application. */
function createHelloWorldDirectory() {
  const fixture = createIsolatedAuthoredAppFixture(authoredHelloWorldDir, {
    prefix: 'wharfie-examples-app-',
  });
  authoredAppFixtures.push(fixture);
  return fixture.appDir;
}

describe('schemaVersion 4 app demos', () => {
  it('loads the canonical hello-world manifest and runs an activity', async () => {
    const dir = createHelloWorldDirectory();
    const { manifest, result } = await runLocalApp({
      dir,
      activityName: 'echo-event',
      inputInput: JSON.stringify({ who: 'jest', message: 'demo' }),
      callerMetadataInput: JSON.stringify({ requestId: 'req-123' }),
    });

    expect(manifest).toEqual({
      schemaVersion: 4,
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
      workflows: {
        'echo-twice': {
          steps: [
            {
              id: 'echo-first',
              kind: 'activity',
              activity: 'echo-event',
              input: { kind: 'workflow-input' },
            },
            {
              id: 'echo-second',
              kind: 'activity',
              activity: 'echo-event',
              input: { kind: 'step-output', step: 'echo-first' },
            },
          ],
        },
      },
      schedules: {
        'echo-hourly': {
          cron: '0 * * * *',
          workflow: 'echo-twice',
          input: { message: 'hello from the resident schedule' },
          missed: 'latest',
          overlap: 'allow',
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
  schemaVersion: 4,
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
      ).rejects.toThrow(/app\.resources is not supported by schemaVersion 4/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invokes a named source activity through the public app API', async () => {
    const dir = createHelloWorldDirectory();

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

  it('fails a public ephemeral invocation when an activity requests application state', async () => {
    const dir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ephemeral-effect-example-'),
    );
    const stateParent = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ephemeral-effect-state-'),
    );
    const applicationStatePath = path.join(stateParent, 'application-state');
    const previousApplicationStatePath =
      process.env.WHARFIE_APPLICATION_STATE_PATH;

    try {
      process.env.WHARFIE_APPLICATION_STATE_PATH = applicationStatePath;
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
        `export async function persist(_input, runtime) {
  return runtime.effects.request({
    effectId: 'persist-value',
    capability: 'application-state',
    operation: 'put-if-absent',
    input: { key: 'greeting', value: { message: 'hello' } },
    requestedReplayProperties: ['idempotent', 'transactional'],
  });
}\n`,
      );
      writeFileSync(
        path.join(dir, 'wharfie.app.js'),
        `export default {
  schemaVersion: 4,
  app: { id: 'ephemeral-effect-example' },
  cli: { entrypoint: { kind: 'node', path: './cli.js', export: 'main' } },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  activities: {
    persist: {
      entrypoint: { kind: 'node', path: './activity.js', export: 'persist' },
    },
  },
};\n`,
      );

      await expect(
        invokeActivity('persist', { dir, input: {} }),
      ).rejects.toMatchObject({
        name: 'ActivityEffectUnavailableError',
        code: 'effect-handler-unavailable',
        terminalType: 'failed',
        evidence: {
          terminal: {
            type: 'failed',
            error: {
              name: 'ActivityEffectUnavailableError',
              code: 'effect-handler-unavailable',
            },
          },
        },
      });
      expect(existsSync(applicationStatePath)).toBe(false);
    } finally {
      if (previousApplicationStatePath === undefined) {
        delete process.env.WHARFIE_APPLICATION_STATE_PATH;
      } else {
        process.env.WHARFIE_APPLICATION_STATE_PATH =
          previousApplicationStatePath;
      }
      rmSync(dir, { recursive: true, force: true });
      rmSync(stateParent, { recursive: true, force: true });
    }
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
    const dir = createHelloWorldDirectory();

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
