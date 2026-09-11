/* eslint-env jest */

import path from 'node:path';

import { createProgram } from '../../src/cli/entry.js';

describe('CLI deployment boundary', () => {
  test('rejects removed source deployment commands before preparing local state', async () => {
    let preparedPaths = false;
    const program = createProgram({
      pathsModule: {
        config: path.join(process.cwd(), '.wharfie-test-config'),
        createWharfiePaths: async () => {
          preparedPaths = true;
        },
      },
    })
      .exitOverride()
      .configureOutput({ writeErr: () => {} });

    await expect(
      program.parseAsync(['node', 'wharfie', 'deployment', 'inspect']),
    ).rejects.toMatchObject({
      code: 'commander.unknownCommand',
      exitCode: 1,
    });
    expect(preparedPaths).toBe(false);
  });
});
