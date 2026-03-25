import { Command } from 'commander';

import { getManifestAppName, requireAppManifest } from '../lib/app-manifest.js';
import {
  listReleaseRecords,
  readCurrentReleaseId,
  selectReleaseRecord,
} from '../lib/systemd-release.js';
import { createCommandIO, resolveShell, writeCommandResult } from './shared.js';

/**
 * @param {string} stdout - stdout.
 * @returns {Record<string, string>} - Result.
 */
function parseSystemctlShow(stdout) {
  return stdout
    .split(/\r?\n/g)
    .filter(Boolean)
    .reduce((acc, line) => {
      const index = line.indexOf('=');
      if (index <= 0) return acc;
      acc[line.slice(0, index)] = line.slice(index + 1);
      return acc;
    }, /** @type {Record<string, string>} */ ({}));
}

/**
 * @param {any} opts - opts.
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [deps] - deps.
 * @returns {Promise<Record<string, any>>} - Result.
 */
export async function getDeploymentStatus(opts, deps = {}) {
  const manifest = await requireAppManifest(opts, {
    assetProvider: deps.assetProvider,
  });
  const appName = getManifestAppName(manifest);
  if (!appName) {
    throw new Error('The app manifest is missing app.name.');
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

  /** @type {Record<string, string> | undefined} */
  let systemd;
  if (!opts.dryRun) {
    const shell = resolveShell(deps.shell);
    const response = await shell.run(
      'systemctl',
      [
        'show',
        unitName,
        '--property=ActiveState,SubState,FragmentPath,UnitFileState',
        '--no-pager',
      ],
      { captureOutput: true },
    );
    systemd = parseSystemctlShow(response.stdout);
  }

  return {
    app: appName,
    unitName,
    currentReleaseId,
    selectedReleaseId: selected?.releaseId,
    releases,
    ...(systemd ? { systemd } : {}),
    dryRun: opts.dryRun === true,
    summary: `Resolved ${releases.length} release(s) for ${unitName}`,
  };
}

/**
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./shared.js').CommandIO, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [deps] - deps.
 * @returns {Command} - Result.
 */
export function createStatusCommand(deps = {}) {
  const command = new Command('status')
    .description('Show systemd + release status for this artifact')
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
    .option('--release-id <id>', 'Inspect a specific release id')
    .option(
      '--dry-run',
      'Skip systemctl inspection and print release metadata only',
    )
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      const io = createCommandIO(deps.io);
      try {
        const result = await getDeploymentStatus(opts, deps);
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

export default createStatusCommand;
