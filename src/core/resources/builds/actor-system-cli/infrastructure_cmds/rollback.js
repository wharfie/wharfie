import path from 'node:path';

import { Command } from 'commander';

import { getManifestAppName, requireAppManifest } from '../lib/app-manifest.js';
import {
  getAppRoot,
  listReleaseRecords,
  readCurrentReleaseId,
  repointCurrentRelease,
  selectReleaseRecord,
} from '../lib/systemd-release.js';
import { createCommandIO, resolveShell, writeCommandResult } from './shared.js';

/**
 * @param {any} opts - opts.
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider, platform?: string }} [deps] - deps.
 * @returns {Promise<Record<string, any>>} - Result.
 */
export async function rollbackArtifact(opts, deps = {}) {
  const platform =
    typeof deps.platform === 'string' ? deps.platform : process.platform;
  const hasInjectedShell = !!deps.shell && typeof deps.shell.run === 'function';
  if (platform !== 'linux' && opts.dryRun !== true && !hasInjectedShell) {
    throw new Error('Artifact rollback currently supports Linux/systemd only.');
  }

  const manifest = await requireAppManifest(opts, {
    assetProvider: deps.assetProvider,
  });
  const appName = getManifestAppName(manifest);
  if (!appName) {
    throw new Error('The app manifest is missing app.name.');
  }
  const releaseRoot = opts.releaseRoot || '/var/lib/wharfie';
  const releases = await listReleaseRecords({
    releaseRoot,
    appName,
    fsOps: deps.fsOps,
  });
  const currentReleaseId = await readCurrentReleaseId({
    releaseRoot,
    appName,
    fsOps: deps.fsOps,
  });
  const target = selectReleaseRecord(releases, {
    currentReleaseId,
    releaseId: opts.releaseId,
    mode: opts.releaseId ? 'current' : 'previous',
  });

  if (!target) {
    throw new Error('No rollback target release was found.');
  }
  if (currentReleaseId && target.releaseId === currentReleaseId) {
    throw new Error('Rollback target matches the current release.');
  }

  const appRoot = getAppRoot(releaseRoot, appName);
  const currentLinkPath = path.join(appRoot, 'current');
  const releaseDir = path.join(appRoot, 'releases', target.releaseId);
  const shellCommands = [
    { command: 'systemctl', args: ['restart', target.unitName] },
  ];

  if (!opts.dryRun) {
    await repointCurrentRelease(currentLinkPath, releaseDir, {
      fsOps: deps.fsOps,
    });
    const shell = resolveShell(deps.shell);
    for (const command of shellCommands) {
      // eslint-disable-next-line no-await-in-loop
      await shell.run(command.command, command.args, { captureOutput: true });
    }
  }

  return {
    app: appName,
    fromReleaseId: currentReleaseId,
    toReleaseId: target.releaseId,
    unitName: target.unitName,
    dryRun: opts.dryRun === true,
    shellCommands,
    summary: `Prepared rollback to ${target.releaseId}${opts.dryRun ? ' (dry-run)' : ''}`,
  };
}

/**
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./shared.js').CommandIO, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [deps] - deps.
 * @returns {Command} - Result.
 */
export function createRollbackCommand(deps = {}) {
  const command = new Command('rollback')
    .description(
      'Switch the current release symlink and restart the systemd unit',
    )
    .option(
      '--manifest-file <path>',
      'JSON file containing the packaged app manifest',
    )
    .option('--manifest <json>', 'Inline JSON packaged app manifest')
    .option(
      '--release-root <path>',
      'Release root directory',
      '/var/lib/wharfie',
    )
    .option(
      '--release-id <id>',
      'Rollback to a specific release id (defaults to previous)',
    )
    .option('--dry-run', 'Print the rollback plan without mutating the host')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      const io = createCommandIO(deps.io);
      try {
        const result = await rollbackArtifact(opts, deps);
        writeCommandResult(result, opts, io);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error || 'Unknown error');
        io.error(`${message}\n`);
        process.exitCode = 1;
      }
    });

  return command;
}

export default createRollbackCommand;
