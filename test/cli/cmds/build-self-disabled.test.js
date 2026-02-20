/* eslint-env jest */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('wharfie build-self', () => {
  it('is disabled under jest to avoid network downloads', () => {
    const binPath = fileURLToPath(
      new URL('../../../bin/wharfie', import.meta.url),
    );

    const res = spawnSync(process.execPath, [binPath, 'build-self'], {
      encoding: 'utf8',
    });

    expect(res.status).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toMatch(/disabled/i);
  });
});
