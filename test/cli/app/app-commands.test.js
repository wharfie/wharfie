/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { kitchenSinkExternalDependencies } from '../../../scratch/examples/actor-systems/kitchen-sink/config.js';

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
  'hello-world',
);
const packageDemoDir = path.join(
  repoRoot,
  'test',
  'fixtures',
  'apps',
  'package-demo',
);
const plainPackageDemoDir = path.join(
  repoRoot,
  'test',
  'fixtures',
  'apps',
  'plain-package-demo',
);
const kitchenSinkDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
  'kitchen-sink',
);
const currentTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
};
const alternateTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch === 'x64' ? 'arm64' : 'x64',
};

/**
 * @param {string} packageName - packageName.
 * @returns {string} - Result.
 */
function readInstalledVersion(packageName) {
  const entryPath = require.resolve(packageName);
  let currentDir = path.dirname(entryPath);

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (manifest?.name === packageName && manifest?.version) {
        return manifest.version;
      }
    } catch {
      // keep walking upward
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(`Could not resolve installed version for ${packageName}`);
}

/**
 * @param {readonly (string | { name: string, version?: string })[]} externals - externals.
 * @returns {{ name: string, version: string }[]} - Result.
 */
function normalizeExpectedExternals(externals) {
  return externals.map((external) => {
    if (typeof external === 'string') {
      const trimmed = external.trim();
      const versionSeparator = trimmed.lastIndexOf('@');
      if (versionSeparator > 0) {
        const name = trimmed.slice(0, versionSeparator).trim();
        const version = trimmed.slice(versionSeparator + 1).trim();
        if (name && version) {
          return { name, version };
        }
      }

      return {
        name: trimmed,
        version: readInstalledVersion(trimmed),
      };
    }

    if (!external?.name) {
      throw new TypeError('External dependency objects require a name');
    }

    return {
      name: external.name,
      version: external.version || readInstalledVersion(external.name),
    };
  });
}

/**
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - target.
 * @returns {string} - Result.
 */
function getTargetSelector(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

/**
 * @param {string[]} args - args.
 * @param {import('node:child_process').SpawnSyncOptions} [options] - options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Result.
 */
function runCli(args, options = {}) {
  return /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
      },
      ...options,
    })
  );
}

describe('wharfie app commands', () => {
  it('runs a demo function from the CLI with --event JSON', () => {
    const result = runCli([
      'app',
      'run',
      'echo-event',
      '--dir',
      helloWorldDir,
      '--event',
      '{"who":"cli-user"}',
      '--no-pretty',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      who: 'cli-user',
      message: 'hello cli-user',
      requestId: null,
    });
  });

  it('runs a demo function from the CLI using stdin JSON as the event', () => {
    const result = runCli(
      ['app', 'run', 'hello-resources', '--dir', helloWorldDir, '--no-pretty'],
      {
        input: '{"who":"stdin-user"}',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      who: 'stdin-user',
      dbRecord: {
        id: 'greeting',
        who: 'stdin-user',
        message: 'hello stdin-user',
      },
      queueBody: JSON.stringify({ hello: 'stdin-user' }),
      objectBody: 'hello stdin-user',
    });
  });

  it('prints the compiled manifest for the kitchen-sink fixture', () => {
    const result = runCli(['app', 'manifest', kitchenSinkDir, '--no-pretty']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout);
    expect(payload.app).toEqual({ name: 'kitchen-sink-demo' });
    expect(payload.activities).toEqual({
      start: expect.objectContaining({
        entrypoint: expect.stringContaining(
          path.join('scratch', 'functions', 'start.js'),
        ),
        export: 'start',
        resources: expect.objectContaining({
          db: expect.objectContaining({ adapter: 'vanilla' }),
          queue: expect.objectContaining({ adapter: 'vanilla' }),
          objectStorage: expect.objectContaining({ adapter: 'vanilla' }),
        }),
        external: expect.arrayContaining(
          normalizeExpectedExternals(kitchenSinkExternalDependencies),
        ),
      }),
    });
  });

  it('packages every app target when no target filter is provided and embeds a target-specific manifest asset', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'all-targets',
      String(process.pid),
    );
    const traceFile = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'traces',
      `all-targets-${process.pid}.json`,
    );

    const result = runCli(
      [
        'app',
        'package',
        packageDemoDir,
        '--output-dir',
        outputDir,
        '--no-pretty',
      ],
      {
        env: {
          ...process.env,
          WHARFIE_PACKAGE_DEMO_TRACE_FILE: traceFile,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ app: { name: string }, outputDir: string, targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { fileName: string, path: string, target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.app).toEqual({ name: 'package-demo' });
    expect(payload.outputDir).toBe(outputDir);
    expect(payload.targets).toEqual([currentTarget, alternateTarget]);
    expect(payload.artifacts).toHaveLength(2);
    expect(payload.artifacts.map((artifact) => artifact.target)).toEqual([
      currentTarget,
      alternateTarget,
    ]);
    payload.artifacts.forEach((artifact) => {
      expect(existsSync(artifact.path)).toBe(true);
      expect(readFileSync(artifact.path, 'utf8')).toContain(
        `echo ${getTargetSelector(artifact.target)}`,
      );
    });
    expect(readdirSync(outputDir).sort()).toEqual(
      payload.artifacts.map((artifact) => artifact.fileName).sort(),
    );
    expect(JSON.parse(readFileSync(traceFile, 'utf8'))).toEqual({
      builtTargets: [
        getTargetSelector(currentTarget),
        getTargetSelector(alternateTarget),
      ],
      embeddedManifestByTarget: {
        [getTargetSelector(currentTarget)]: {
          appName: 'package-demo',
          targetSelectors: [getTargetSelector(currentTarget)],
        },
        [getTargetSelector(alternateTarget)]: {
          appName: 'package-demo',
          targetSelectors: [getTargetSelector(alternateTarget)],
        },
      },
    });
  });

  it('packages only the selected target when --target is provided', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'selected-target',
      String(process.pid),
    );
    const traceFile = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'traces',
      `selected-target-${process.pid}.json`,
    );
    const targetSelector = getTargetSelector(currentTarget);

    const result = runCli(
      [
        'app',
        'package',
        packageDemoDir,
        '--output-dir',
        outputDir,
        '--target',
        targetSelector,
        '--no-pretty',
      ],
      {
        env: {
          ...process.env,
          WHARFIE_PACKAGE_DEMO_TRACE_FILE: traceFile,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { fileName: string, path: string, target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.targets).toEqual([currentTarget]);
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0].target).toEqual(currentTarget);
    expect(readdirSync(outputDir)).toEqual([payload.artifacts[0].fileName]);
    expect(JSON.parse(readFileSync(traceFile, 'utf8'))).toEqual({
      builtTargets: [targetSelector],
      embeddedManifestByTarget: {
        [targetSelector]: {
          appName: 'package-demo',
          targetSelectors: [targetSelector],
        },
      },
    });
  });

  it('accepts short target aliases for --target', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'short-target',
      String(process.pid),
    );
    const shortAlias = `${currentTarget.platform}-${currentTarget.architecture}`;

    const result = runCli([
      'app',
      'package',
      packageDemoDir,
      '--output-dir',
      outputDir,
      '--target',
      shortAlias,
      '--no-pretty',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.targets).toEqual([currentTarget]);
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0].target).toEqual(currentTarget);
  });

  it('preserves repeated --target order in the packaged output', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'ordered-targets',
      String(process.pid),
    );

    const result = runCli([
      'app',
      'package',
      packageDemoDir,
      '--output-dir',
      outputDir,
      '--target',
      getTargetSelector(alternateTarget),
      '--target',
      getTargetSelector(currentTarget),
      '--no-pretty',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.targets).toEqual([alternateTarget, currentTarget]);
    expect(payload.artifacts.map((artifact) => artifact.target)).toEqual([
      alternateTarget,
      currentTarget,
    ]);
  });

  it('packages a plain-object CLI app and the artifact defaults to the developer CLI surface', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'plain-object-cli',
      String(process.pid),
    );

    const result = runCli([
      'app',
      'package',
      plainPackageDemoDir,
      '--output-dir',
      outputDir,
      '--no-pretty',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ app: { name: string }, targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { path: string, target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.app).toEqual({ name: 'plain-package-demo' });
    expect(payload.targets).toEqual([currentTarget]);
    expect(payload.artifacts).toHaveLength(1);
    expect(existsSync(payload.artifacts[0].path)).toBe(true);

    const artifactRun = spawnSync(payload.artifacts[0].path, [], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
      },
    });

    expect(artifactRun.status).toBe(0);
    expect(artifactRun.stdout).toContain('plain-package-demo cli []');
    expect(artifactRun.stdout).toContain('overall');
    expect(artifactRun.stdout).not.toContain('Wharfie function commands');
    expect(artifactRun.stdout).not.toContain(
      'Self-managing artifact infrastructure commands',
    );
  });

  it('fails with a helpful error when a requested target does not exist', () => {
    const result = runCli([
      'app',
      'package',
      packageDemoDir,
      '--target',
      'node99.99.99-linux-x64',
      '--no-pretty',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown target');
    expect(result.stderr).toContain('node99.99.99-linux-x64');
    expect(result.stderr).toContain(getTargetSelector(currentTarget));
    expect(result.stderr).toContain(getTargetSelector(alternateTarget));
  });
});
