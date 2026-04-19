/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const CHILD_PROCESS_IMPORT = 'node:child_process';

describe('SeaBuild', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('fails instead of writing a non-SEA script fallback when builder Node lacks SEA support', async () => {
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({
        stdout: 'Usage: node\n',
        stderr: '',
        status: 0,
      })),
    }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');

    const build = new SeaBuild({
      name: 'no-sea-fallback',
      properties: {
        entryCode: 'console.log("never bundled")',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });

    await expect(build.build()).rejects.toThrow(
      /must be real Node SEA executables/i,
    );
  });
});
