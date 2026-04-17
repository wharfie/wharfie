/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../../../bin/wharfie', import.meta.url));
const repoRoot = path.resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
);
const BUILD_SELF_IMPORT = '../../../src/cli/cmds/build_self.js';
const PACKAGE_LOCAL_APP_IMPORT = '../../../src/cli/app/local-app.js';

/**
 * @returns {string} - Result.
 */
function makeTmpRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'wharfie-build-self-'));
  mkdirSync(
    path.join(root, 'src', 'cli', 'project', 'project_structure_examples'),
    {
      recursive: true,
    },
  );
  mkdirSync(path.join(root, 'apps', 'wharfie-cli'), { recursive: true });
  mkdirSync(
    path.join(
      root,
      'src',
      'cli',
      'project',
      'project_structure_examples',
      'nested',
    ),
    {
      recursive: true,
    },
  );

  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'wharfie-build-self-fixture', private: true }),
    'utf8',
  );
  writeFileSync(
    path.join(root, 'src', 'cli', 'entry.js'),
    'export async function main() {}\n',
    'utf8',
  );
  writeFileSync(
    path.join(root, 'apps', 'wharfie-cli', 'wharfie.app.js'),
    'export default { name: "wharfie-cli" };\n',
    'utf8',
  );
  writeFileSync(
    path.join(
      root,
      'src',
      'cli',
      'project',
      'project_structure_examples',
      'base.txt',
    ),
    'base template',
    'utf8',
  );
  writeFileSync(
    path.join(
      root,
      'src',
      'cli',
      'project',
      'project_structure_examples',
      'nested',
      'child.txt',
    ),
    'nested template',
    'utf8',
  );

  return root;
}

describe('wharfie build-self', () => {
  test('is disabled under jest to avoid network downloads', () => {
    const res = spawnSync(process.execPath, [binPath, 'build-self'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        WHARFIE_DISABLE_UPDATE_CHECK: '1',
      },
    });

    expect(res.status).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toMatch(/disabled under jest/i);
  });

  test('resolveBuildSourceRoot prefers the current workspace when Wharfie sources are present', async () => {
    const tmpRepo = makeTmpRepo();

    try {
      const mod = await import(BUILD_SELF_IMPORT);
      expect(path.resolve(mod.resolveBuildSourceRoot(tmpRepo))).toBe(
        path.resolve(tmpRepo),
      );
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
      jest.resetModules();
    }
  });

  test('resolveBuildSourceRoot falls back to the installed package when cwd lacks Wharfie sources', async () => {
    const tmpWorkspace = mkdtempSync(
      path.join(tmpdir(), 'wharfie-build-self-workspace-'),
    );

    try {
      writeFileSync(
        path.join(tmpWorkspace, 'package.json'),
        JSON.stringify({ name: 'workspace-fixture', private: true }),
        'utf8',
      );

      const mod = await import(BUILD_SELF_IMPORT);
      expect(path.resolve(mod.resolveBuildSourceRoot(tmpWorkspace))).toBe(
        repoRoot,
      );
    } finally {
      rmSync(tmpWorkspace, { recursive: true, force: true });
      jest.resetModules();
    }
  });

  test('buildSelf packages the self-hosted app via packageLocalApp and renames the final artifact', async () => {
    const previousCwd = process.cwd();
    const previousNodeVersion = process.env.WHARFIE_SELF_NODE_VERSION;
    const tmpRepo = makeTmpRepo();
    let observedNodeVersion;

    try {
      process.chdir(tmpRepo);
      jest.resetModules();

      const packageLocalApp = jest.fn(
        /**
         * @param {{ dir: string, outputDir: string, targetFilters: string[] }} options - options.
         */
        async (options) => {
          observedNodeVersion = process.env.WHARFIE_SELF_NODE_VERSION;
          const outputFile = path.join(
            options.outputDir,
            'wharfie-cli-node24.13.1-linux-x64',
          );
          mkdirSync(options.outputDir, { recursive: true });
          writeFileSync(outputFile, 'fake sea binary', 'utf8');

          return {
            app: { name: 'wharfie-cli' },
            outputDir: options.outputDir,
            artifacts: [
              {
                fileName: path.basename(outputFile),
                path: outputFile,
                target: {
                  nodeVersion: '24.13.1',
                  platform: 'linux',
                  architecture: 'x64',
                },
              },
            ],
          };
        },
      );

      jest.unstable_mockModule(PACKAGE_LOCAL_APP_IMPORT, () => ({
        packageLocalApp,
      }));

      const mod = await import(BUILD_SELF_IMPORT);
      await mod.buildSelf({
        platform: 'linux',
        arch: 'amd64',
        nodeVersion: '24.13.1',
      });

      const distBinaryPath = path.join(tmpRepo, 'dist', 'wharfie-linux-x64');
      const originalArtifactPath = path.join(
        tmpRepo,
        'dist',
        'wharfie-cli-node24.13.1-linux-x64',
      );

      expect(packageLocalApp).toHaveBeenCalledWith({
        dir: path.join(tmpRepo, 'apps', 'wharfie-cli'),
        outputDir: path.join(tmpRepo, 'dist'),
        targetFilters: ['linux-x64'],
      });
      expect(observedNodeVersion).toBe('24.13.1');
      expect(existsSync(originalArtifactPath)).toBe(false);
      expect(existsSync(distBinaryPath)).toBe(true);
      expect(readFileSync(distBinaryPath, 'utf8')).toBe('fake sea binary');
      expect(statSync(distBinaryPath).mode & 0o111).toBeGreaterThan(0);
      expect(mod.normalizeArch('amd64')).toBe('x64');
      expect(mod.normalizePlatform('linux')).toBe('linux');
      expect(mod.findRepoRoot(path.join(tmpRepo, 'src', 'cli'))).toBe(tmpRepo);
      expect(process.env.WHARFIE_SELF_NODE_VERSION).toBe(previousNodeVersion);
    } finally {
      process.chdir(previousCwd);
      if (previousNodeVersion === undefined) {
        delete process.env.WHARFIE_SELF_NODE_VERSION;
      } else {
        process.env.WHARFIE_SELF_NODE_VERSION = previousNodeVersion;
      }
      rmSync(tmpRepo, { recursive: true, force: true });
      jest.resetModules();
      jest.restoreAllMocks();
    }
  });
});
