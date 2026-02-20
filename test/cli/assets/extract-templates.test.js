/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

// Ensure tests never rely on a real SEA environment.
jest.unstable_mockModule('node:sea', () => ({
  isSea: () => false,
  getAsset: (/** @type {string} */ name) => {
    throw new Error(`Unexpected getAsset(${name})`);
  },
}));

describe('cli/assets/extract-templates', () => {
  it('extracts template files from a provided in-memory SEA asset provider', async () => {
    const mod = await import('../../../cli/assets/extract-templates.js');

    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-extract-templates-sea-'),
    );

    /** @type {Map<string, Buffer>} */
    const assets = new Map();

    const relFiles = ['models/example.sql', 'sources/example.yaml'];
    assets.set(
      mod.TEMPLATES_ASSET_MANIFEST_KEY,
      Buffer.from(
        JSON.stringify({ baseKey: mod.TEMPLATES_ASSET_BASE, files: relFiles }),
        'utf8',
      ),
    );

    assets.set(
      `${mod.TEMPLATES_ASSET_BASE}/models/example.sql`,
      Buffer.from('select 1 as one;\n', 'utf8'),
    );
    assets.set(
      `${mod.TEMPLATES_ASSET_BASE}/sources/example.yaml`,
      Buffer.from('name: example\n', 'utf8'),
    );

    /** @type {{ isSea: () => boolean, getAsset: (name: string) => any }} */
    const provider = {
      isSea: () => true,
      getAsset: (name) => {
        const buf = assets.get(name);
        if (!buf) throw new Error(`Missing asset: ${name}`);
        return buf;
      },
    };

    const result = await mod.extractTemplates({
      destinationDir: tmp,
      diskSourceDir: tmp,
      assetProvider: provider,
    });

    expect(result).toEqual({ mode: 'sea', filesWritten: 2 });

    await expect(
      fsp.readFile(path.join(tmp, 'models', 'example.sql'), 'utf8'),
    ).resolves.toEqual('select 1 as one;\n');

    await expect(
      fsp.readFile(path.join(tmp, 'sources', 'example.yaml'), 'utf8'),
    ).resolves.toEqual('name: example\n');
  });

  it('falls back to disk copy when SEA assets are unavailable', async () => {
    const mod = await import('../../../cli/assets/extract-templates.js');

    const src = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-extract-templates-fs-src-'),
    );
    const dest = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-extract-templates-fs-dest-'),
    );

    await fsp.mkdir(path.join(src, 'models'), { recursive: true });
    await fsp.writeFile(path.join(src, 'models', 'a.sql'), 'select 42;\n');

    /** @type {{ isSea: () => boolean, getAsset: (name: string) => any }} */
    const provider = {
      isSea: () => true,
      getAsset: () => {
        throw new Error('asset not found');
      },
    };

    const result = await mod.extractTemplates({
      destinationDir: dest,
      diskSourceDir: src,
      assetProvider: provider,
      assetManifestKey: mod.TEMPLATES_ASSET_MANIFEST_KEY,
    });

    expect(result).toEqual({ mode: 'fs', filesWritten: 0 });

    await expect(
      fsp.readFile(path.join(dest, 'models', 'a.sql'), 'utf8'),
    ).resolves.toEqual('select 42;\n');
  });
});
