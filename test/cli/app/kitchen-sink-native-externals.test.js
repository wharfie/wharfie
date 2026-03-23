/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadApp } from '../../../cli/app/load-app.js';

const require = createRequire(import.meta.url);
const maybeIt = process.env.WHARFIE_RUN_NATIVE_EXTERNALS === '1' ? it : it.skip;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const kitchenSinkDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
  'kitchen-sink',
);

/**
 * @param {string} packageName - packageName.
 * @returns {string} - Result.
 */
function readInstalledVersion(packageName) {
  const entryPath = require.resolve(packageName);
  let currentDir = path.dirname(entryPath);

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (manifest?.name === packageName && manifest?.version) {
        return manifest.version;
      }
    } catch {
      // keep walking upward
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(`Could not resolve installed version for ${packageName}`);
}

describe('kitchen-sink native externals integration', () => {
  maybeIt(
    'invokes the kitchen-sink fixture with host-native externals enabled',
    async () => {
      const nativeLmdbPath = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-native-externals-'),
      );
      const { appExport, manifest } = await loadApp({ dir: kitchenSinkDir });

      expect(manifest.functions).toEqual([
        expect.objectContaining({
          name: 'start',
          entrypoint: expect.objectContaining({
            path: expect.any(String),
            export: 'start',
          }),
          external: expect.arrayContaining([
            { name: 'lmdb', version: readInstalledVersion('lmdb') },
            {
              name: '@duckdb/node-api',
              version: readInstalledVersion('@duckdb/node-api'),
            },
            { name: 'sharp', version: '0.34.1' },
            {
              name: 'sodium-native',
              version: readInstalledVersion('sodium-native'),
            },
            { name: 'usb', version: '2.13.0' },
          ]),
          resources: expect.objectContaining({
            db: expect.any(Object),
            queue: expect.any(Object),
            objectStorage: expect.any(Object),
          }),
        }),
      ]);

      try {
        const result = await appExport.invoke('start', {
          who: 'native-externals',
          iterations: 32,
          lmdbPath: nativeLmdbPath,
          checkOptionalNativeExternals: true,
        });

        expect(result.ok).toBe(true);
        expect(result.native.lmdbRecord).toMatchObject({
          who: 'native-externals',
          message: 'hello native-externals',
          runId: result.runId,
        });
        expect(result.native.duckdb).toMatchObject({
          version: expect.any(String),
          rangeSum: 10,
        });
        expect(result.native.optional).toEqual({
          sharp: expect.objectContaining({
            packageName: 'sharp',
            status: expect.stringMatching(/^(OK|SKIPPED)$/),
          }),
          sodiumNative: expect.objectContaining({
            packageName: 'sodium-native',
            status: expect.stringMatching(/^(OK|SKIPPED)$/),
          }),
          usb: expect.objectContaining({
            packageName: 'usb',
            status: expect.stringMatching(/^(OK|SKIPPED)$/),
          }),
        });

        for (const probe of Object.values(result.native.optional)) {
          if (probe.status === 'SKIPPED') {
            expect(typeof probe.reason).toBe('string');
            expect(probe.reason.length).toBeGreaterThan(0);
          }
        }
      } finally {
        await appExport.closeRuntimeResources();
        rmSync(nativeLmdbPath, { recursive: true, force: true });
      }
    },
    30000,
  );
});
