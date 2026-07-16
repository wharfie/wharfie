/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';
const SPAWN_SELF_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/control_cmds/state_cmds/util/spawn-self.js';

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('getSelfSpawnCommand', () => {
  it('does not pass the SEA executable to itself as a script argument', async () => {
    await jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
      isSea: () => true,
    }));
    process.argv = [process.execPath, process.execPath, 'wharfie', 'manifest'];

    const { getSelfSpawnCommand } = await import(SPAWN_SELF_IMPORT);

    expect(getSelfSpawnCommand()).toEqual({
      cmd: process.execPath,
      prefixArgs: [],
    });
  });

  it('preserves the script prefix for ordinary Node execution', async () => {
    await jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
      isSea: () => false,
    }));
    const scriptPath = fileURLToPath(import.meta.url);
    process.argv = [process.execPath, scriptPath, '--example'];

    const { getSelfSpawnCommand } = await import(SPAWN_SELF_IMPORT);

    expect(getSelfSpawnCommand()).toEqual({
      cmd: process.execPath,
      prefixArgs: [scriptPath],
    });
  });
});
