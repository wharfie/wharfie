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
          inputInput: JSON.stringify({
            who: 'native-externals',
            lmdbPath: nativeLmdbPath,
          }),
        });

        expect(manifest.activities.start).toEqual({
          entrypoint: {
            kind: 'node',
            path: 'activity.js',
            export: 'start',
          },
          externalPackages: kitchenSinkExternalDependencies,
        });
        expect(result.ok).toBe(true);
        expect(result.native).toEqual({
          lmdbRecord: {
            who: 'native-externals',
            message: 'hello native-externals',
            runId: result.runId,
          },
        });
      } finally {
        rmSync(nativeLmdbPath, { recursive: true, force: true });
      }
    },
    30000,
  );
});
