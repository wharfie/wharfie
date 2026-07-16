/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { kitchenSinkExternalDependencies } from '../../../scratch/examples/apps/kitchen-sink/config.js';
import { runLocalApp } from '../../../src/cli/app/local-app.js';

const maybeIt = process.env.WHARFIE_RUN_NATIVE_EXTERNALS === '1' ? it : it.skip;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const kitchenSinkDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'kitchen-sink',
);

describe('kitchen-sink native externals integration', () => {
  maybeIt(
    'invokes the kitchen-sink fixture with host-native externals enabled',
    async () => {
      const nativeLmdbPath = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-native-externals-'),
      );

      try {
        const { manifest, result } = await runLocalApp({
          dir: kitchenSinkDir,
          activityName: 'start',
          eventInput: JSON.stringify({
            who: 'native-externals',
            iterations: 32,
            lmdbPath: nativeLmdbPath,
            checkOptionalNativeExternals: true,
          }),
        });

        expect(manifest.activities.start).toEqual({
          entrypoint: {
            kind: 'node',
            path: 'activity.js',
            export: 'start',
          },
          externalPackages: kitchenSinkExternalDependencies,
          resources: {
            db: {
              adapter: 'vanilla',
              options: {
                path: 'tmp/wharfie-examples/kitchen-sink/activity',
              },
            },
            queue: {
              adapter: 'vanilla',
              options: {
                path: 'tmp/wharfie-examples/kitchen-sink/activity',
              },
            },
            objectStorage: {
              adapter: 'vanilla',
              options: {
                path: 'tmp/wharfie-examples/kitchen-sink/activity',
              },
            },
          },
        });
        expect(result.ok).toBe(true);
        expect(result.native.lmdbRecord).toMatchObject({
          who: 'native-externals',
          message: 'hello native-externals',
          runId: result.runId,
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
        rmSync(nativeLmdbPath, { recursive: true, force: true });
      }
    },
    30000,
  );
});
