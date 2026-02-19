/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * NOTE:
 * We intentionally avoid spawning `bin/wharfie` in tests.
 * The CLI is exercised indirectly via existing runner + operations-store tests.
 * This test just verifies the `ops` command group is wired into the entrypoint.
 */
describe('wharfie ops CLI wiring', () => {
  test('bin/wharfie registers the ops command group', () => {
    const binPath = fileURLToPath(
      new URL('../../../bin/wharfie', import.meta.url),
    );

    const src = readFileSync(binPath, 'utf8');

    expect(src).toContain("program.addCommand(require('../cli/cmds/ops'));");
    expect(src).toMatch(
      /argv\[0\]\s*===\s*'app'\s*\|\|\s*argv\[0\]\s*===\s*'ops'/,
    );
  });
});
