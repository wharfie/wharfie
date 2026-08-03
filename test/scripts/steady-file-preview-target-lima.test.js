/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const configPath = path.join(
  repoRoot,
  'test',
  'systemd',
  'steady-file-preview-target-lima.yaml',
);

async function readConfig() {
  return await fsp.readFile(configPath, 'utf8');
}

describe('steady-file clean preview target Lima contract', () => {
  it('uses one fixed non-root Wharfie account with a persistent systemd user manager', async () => {
    const config = await readConfig();

    expect(config).toMatch(
      /^user:\n[ ]{2}name: wharfie\n[ ]{2}comment: Wharfie preview target\n[ ]{2}home: \/home\/wharfie\n[ ]{2}shell: \/bin\/bash\n[ ]{2}uid: 1001$/m,
    );
    expect(config).toContain('test "{{.User}}" = wharfie');
    expect(config).toContain(
      'install -d -m 0700 -o wharfie -g wharfie /home/wharfie/preview',
    );
    expect(config).toContain(
      'install -d -m 0700 -o wharfie -g wharfie /home/wharfie/preview/handoff',
    );
    expect(config).toContain('loginctl enable-linger wharfie');
    expect(config).toContain('test "$(id -un)" = wharfie');
    expect(config).toContain('test "$(id -u)" -gt 0');
    expect(config).toContain(
      'test "$(loginctl show-user "$(id -u)" --property=Linger --value)" = yes',
    );
    expect(config).toContain('systemctl --user show-environment >/dev/null');
  });

  it('contains no package installation, JavaScript runtime, or build-tool command', async () => {
    const config = await readConfig();
    const packageMutation =
      /\b(?:apt|apt-get|apk|brew|dnf|dpkg|pacman|snap|yum|zypper)\b/i;
    const runtimeOrBuildTool =
      /(?:^|[\s"'=/])(?:node|nodejs|npm|npx|corepack|pnpm|yarn|bun|deno|build-essential|cc|gcc|g\+\+|clang|cmake|make|ninja|python|python3|pip|pip3|git|cargo|rustc)(?=$|[\s"'=/@-])/im;

    expect(config).not.toMatch(packageMutation);
    expect(config).not.toMatch(runtimeOrBuildTool);
  });

  it('disables mounts and container runtimes without exposing a host repository path', async () => {
    const config = await readConfig();

    expect(config.match(/^mounts:/gm)).toEqual(['mounts:']);
    expect(config).toMatch(/^mounts: \[\]$/m);
    expect(config).not.toMatch(/^\s+(?:mountPoint|writable|sshfs|9p):/m);
    expect(config).toMatch(
      /^containerd:\n[ ]{2}system: false\n[ ]{2}user: false$/m,
    );
    expect(config).toMatch(/^plain: true$/m);
    expect(config).not.toContain(repoRoot);
    expect(config).not.toMatch(/\/Users\/|[\\/]workspace[\\/]wharfie/i);
  });
});
