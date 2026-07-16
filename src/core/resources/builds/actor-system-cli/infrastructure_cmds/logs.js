import { Command } from 'commander';

import { getManifestAppId, requireAppManifest } from '../lib/app-manifest.js';
import {
  getReleaseLogWindow,
  listReleaseRecords,
  readCurrentReleaseId,
  selectReleaseRecord,
} from '../lib/systemd-release.js';
import { createCommandIO, resolveShell, writeCommandResult } from './shared.js';

/**
 * @param {any} opts - opts.
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./shared.js').CommandIO, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [deps] - deps.
 * @returns {Promise<Record<string, any>>} - Result.
 */
export async function getDeploymentLogs(opts, deps = {}) {
  const manifest = await requireAppManifest(opts, {
    assetProvider: deps.assetProvider,
  });
  const appName = getManifestAppId(manifest);
  if (!appName) {
    throw new Error('The app manifest is missing app.id.');
  }
  const releases = await listReleaseRecords({
    releaseRoot: opts.releaseRoot || '/var/lib/wharfie',
    appName,
    fsOps: deps.fsOps,
  });
  const currentReleaseId = await readCurrentReleaseId({
    releaseRoot: opts.releaseRoot || '/var/lib/wharfie',
    appName,
    fsOps: deps.fsOps,
  });
  const selected = selectReleaseRecord(releases, {
    currentReleaseId,
    releaseId: opts.releaseId,
  });
  const unitName =
    selected?.unitName || `${opts.serviceName || appName}.service`;
  const window = selected
    ? getReleaseLogWindow(releases, selected.releaseId)
    : {};

  /** @type {string[]} */
  const args = [
    '-u',
    unitName,
    '--no-pager',
    '-n',
    String(Number(opts.lines || 100)),
  ];
  if (opts.follow === true) {
    args.push('-f');
  }
  if (opts.since) {
    args.push('--since', String(opts.since));
  } else if (window.since) {
    args.push('--since', window.since);
  }
  if (window.until && !opts.follow) {
    args.push('--until', window.until);
  }

  /** @type {string | undefined} */
  let output;
  if (!opts.dryRun && opts.json !== true) {
    const shell = resolveShell(deps.shell);
    const response = await shell.run('journalctl', args, {
      captureOutput: opts.follow !== true,
      inheritStdio: opts.follow === true,
    });
    output = response.stdout;
  }

  return {
    app: appName,
    unitName,
    releaseId: selected?.releaseId,
    journalctl: {
      command: 'journalctl',
      args,
    },
    ...(window.since || window.until ? { window } : {}),
    ...(typeof output === 'string' ? { output } : {}),
    dryRun: opts.dryRun === true,
    summary: `Resolved logs for ${unitName}${selected ? ` (${selected.releaseId})` : ''}`,
  };
}

/**
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./shared.js').CommandIO, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [deps] - deps.
 * @returns {Command} - Result.
 */
export function createLogsCommand(deps = {}) {
  const command = new Command('logs')
    .description('Show journalctl logs for this artifact release')
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
    .option('--service-name <name>', 'Override systemd service name')
    .option('--release-id <id>', 'Inspect logs for a specific release id')
    .option('--lines <n>', 'Tail line count', (value) => Number(value), 100)
    .option('--since <value>', 'Override the journalctl --since window')
    .option('--follow', 'Follow logs')
    .option('--dry-run', 'Print the journalctl command without executing it')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      const io = createCommandIO(deps.io);
      try {
        const result = await getDeploymentLogs(opts, deps);
        if (typeof result.output === 'string' && opts.json !== true) {
          io.write(result.output);
          if (!result.output.endsWith('\n')) {
            io.write('\n');
          }
          return;
        }
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

export default createLogsCommand;
