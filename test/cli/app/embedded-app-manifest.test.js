/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';
const EMBEDDED_ACTIVITY_TIMEOUT_MS = 15_000;

const embeddedManifest = {
  app: { name: 'embedded-demo' },
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
    },
  ],
  functions: [
    {
      name: 'start',
      entrypoint: {
        path: 'wharfie:embedded/activity/start',
        export: 'start',
      },
    },
  ],
};

const embeddedRunnableManifest = {
  app: { name: 'embedded-runnable-demo' },
  activities: {
    start: {
      entrypoint: {
        path: 'wharfie:embedded/activity/start',
        export: 'start',
      },
    },
  },
};

describe('embedded app manifest asset helpers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('reads the embedded manifest from SEA assets', async () => {
    jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
      isSea: () => true,
      getAsset: async (/** @type {string} */ name) => {
        expect(name).toBe('<WHARFIE_APP>/manifest.json');
        return Buffer.from(JSON.stringify(embeddedManifest), 'utf8');
      },
    }));

    const mod =
      await import('../../../src/core/resources/builds/lib/app-manifest-asset.js');

    await expect(mod.readEmbeddedAppManifest()).resolves.toEqual(
      embeddedManifest,
    );
  });

  it('uses private temporary manifest files with explicit cleanup', async () => {
    const mod =
      await import('../../../src/core/resources/builds/lib/app-manifest-asset.js');
    const asset = await mod.createEmbeddedAppManifestAsset(embeddedManifest);

    expect((await fsp.stat(path.dirname(asset.path))).mode & 0o777).toBe(0o700);
    expect((await fsp.stat(asset.path)).mode & 0o777).toBe(0o600);
    await expect(fsp.readFile(asset.path, 'utf8')).resolves.toContain(
      'embedded-demo',
    );

    await asset.cleanup();
    await expect(fsp.stat(asset.path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('prints a provided manifest without requiring SEA assets', async () => {
    /** @type {string[]} */
    const writes = [];
    const mod =
      await import('../../../src/core/resources/builds/actor-system-cli/control_cmds/manifest.js');

    await mod.printEmbeddedManifest(
      { pretty: false, manifest: JSON.stringify(embeddedManifest) },
      {
        write: (text) => {
          writes.push(text);
        },
      },
    );

    expect(JSON.parse(writes.join(''))).toEqual(embeddedManifest);
  });

  it('prints the embedded manifest through the operator manifest command', async () => {
    jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
      isSea: () => true,
      getAsset: async () =>
        Buffer.from(JSON.stringify(embeddedManifest), 'utf8'),
    }));

    /** @type {string[]} */
    const writes = [];
    const mod =
      await import('../../../src/core/resources/builds/actor-system-cli/control_cmds/manifest.js');

    await mod.printEmbeddedManifest(
      { pretty: false },
      {
        write: (text) => {
          writes.push(text);
        },
      },
    );

    expect(JSON.parse(writes.join(''))).toEqual(embeddedManifest);
  });

  it(
    'runs an embedded app activity without wharfie.app.js on disk',
    async () => {
      /** @type {Map<string, any>} */
      const seaAssets = new Map();
      const functionSource = `
        global[Symbol.for('start')] = async (event, context) => ({
          ok: true,
          who: event?.who || 'world',
          requestId: context?.requestId || null,
        });
      `;

      seaAssets.set(
        '<WHARFIE_APP>/manifest.json',
        JSON.stringify(embeddedRunnableManifest),
      );
      seaAssets.set(
        'start',
        JSON.stringify({
          codeBundle: brotliCompressSync(
            Buffer.from(functionSource, 'utf8'),
          ).toString('base64'),
          externalsTar: '',
          resourceSpecs: {},
        }),
      );

      jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
        isSea: () => true,
        getAsset: async (/** @type {string} */ name) => {
          if (!seaAssets.has(name)) {
            throw new Error(`Unexpected asset request: ${name}`);
          }
          return Buffer.from(seaAssets.get(name), 'utf8');
        },
      }));

      const tmpDir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-embedded-app-run-'),
      );
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      const { runLocalApp } = await import('../../../src/cli/app/local-app.js');
      const { invokeActivity } = await import('../../../src/app.js');
      const { default: sandboxWorker } =
        await import('../../../src/core/lib/code-execution/worker.js');

      try {
        const { manifest, result } = await runLocalApp({
          activityName: 'start',
          eventInput: '{"who":"embedded"}',
          contextInput: '{"requestId":"req-1"}',
          allowEmbedded: true,
        });

        expect(manifest).toEqual(embeddedRunnableManifest);
        expect(result).toEqual({
          ok: true,
          who: 'embedded',
          requestId: 'req-1',
        });

        await expect(
          invokeActivity('start', {
            dir: tmpDir,
            event: { who: 'immutable-embedded-revision' },
            context: { requestId: 'req-2' },
          }),
        ).resolves.toEqual({
          ok: true,
          who: 'immutable-embedded-revision',
          requestId: 'req-2',
        });
      } finally {
        process.chdir(previousCwd);
        await sandboxWorker._destroyWorker();
        sandboxWorker._clearSandboxCache();
        await fsp.rm(tmpDir, { recursive: true, force: true });
      }
    },
    EMBEDDED_ACTIVITY_TIMEOUT_MS,
  );
});
