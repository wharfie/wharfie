/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('wharfie build-self', () => {
  test('is disabled under jest to avoid network downloads', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wharfie-build-self-'));
    const xdgDir = join(tempDir, 'xdg');

    try {
      const binPath = fileURLToPath(
        new URL('../../../bin/wharfie', import.meta.url),
      );

      const res = spawnSync(process.execPath, [binPath, 'build-self'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          // Ensure the command sees a test environment even if this test is run
          // outside of Jest in the future.
          NODE_ENV: 'test',
          JEST_WORKER_ID: '1',

          // Isolate env-paths() output so the test doesn't touch real user dirs.
          XDG_DATA_HOME: join(xdgDir, 'data'),
          XDG_CONFIG_HOME: join(xdgDir, 'config'),
          XDG_CACHE_HOME: join(xdgDir, 'cache'),
        },
      });

      expect(res.status).toBe(1);
      expect(`${res.stderr}\n${res.stdout}`).toContain('disabled');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
