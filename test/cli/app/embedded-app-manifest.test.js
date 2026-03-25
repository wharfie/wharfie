/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
        path: '/artifact/functions/start.js',
        export: 'start',
      },
    },
  ],
};

describe('embedded app manifest asset helpers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reads the embedded manifest from SEA assets', async () => {
    jest.unstable_mockModule('node:sea', () => ({
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

  it('prints the embedded manifest through ctl manifest', async () => {
    jest.unstable_mockModule('node:sea', () => ({
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
});
