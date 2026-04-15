import { Command } from 'commander';

import { requireAppManifest } from '../lib/app-manifest.js';
import {
  createDeployPlan,
  materializeDeployPlan,
} from '../lib/systemd-release.js';
import { createCommandIO, resolveShell, writeCommandResult } from './shared.js';

/**
 * @param {string[] | undefined} values - values.
 * @returns {Record<string, string>} - Result.
 */
function parseEnvironmentAssignments(values) {
  return (Array.isArray(values) ? values : []).reduce((acc, assignment) => {
    if (typeof assignment !== 'string') {
      return acc;
    }

    const index = assignment.indexOf('=');
    if (index <= 0) {
      throw new Error(
        `Invalid --env assignment '${assignment}'. Expected KEY=VALUE.`,
      );
    }

    const key = assignment.slice(0, index).trim();
    const value = assignment.slice(index + 1);
    if (!key) {
      throw new Error(
        `Invalid --env assignment '${assignment}'. Expected KEY=VALUE.`,
      );
    }

    acc[key] = value;
    return acc;
  }, /** @type {Record<string, string>} */ ({}));
}

/**
 * @param {string} value - value.
 * @param {string[] | undefined} previous - previous.
 * @returns {string[]} - Result.
 */
function appendRepeatableOption(value, previous) {
  return [...(Array.isArray(previous) ? previous : []), value];
}

/**
 * @param {any} opts - opts.
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./shared.js').CommandIO, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider, platform?: string }} [deps] - deps.
 * @returns {Promise<Record<string, any>>} - Result.
 */
export async function deployArtifact(opts, deps = {}) {
  const platform =
    typeof deps.platform === 'string' ? deps.platform : process.platform;
  const hasInjectedShell = !!deps.shell && typeof deps.shell.run === 'function';
  if (platform !== 'linux' && opts.dryRun !== true && !hasInjectedShell) {
    throw new Error('Artifact deploy currently supports Linux/systemd only.');
  }

  const manifest = await requireAppManifest(opts, {
    assetProvider: deps.assetProvider,
  });
  const environment = parseEnvironmentAssignments(opts.env);
  const plan = createDeployPlan({
    manifest,
    artifactPath: opts.artifactPath,
    releaseRoot: opts.releaseRoot,
    systemdDir: opts.systemdDir,
    serviceName: opts.serviceName,
    releaseId: opts.releaseId,
    role: opts.role,
    workingDirectory: opts.workingDirectory,
    serviceUser: opts.serviceUser,
    environment,
    extraArgs: Array.isArray(opts.startArg) ? opts.startArg : [],
  });

  if (!opts.dryRun) {
    await materializeDeployPlan(plan, { fsOps: deps.fsOps });
    const shell = resolveShell(deps.shell);
    for (const command of plan.shellCommands) {
      // eslint-disable-next-line no-await-in-loop
      await shell.run(command.command, command.args, { captureOutput: true });
    }
  }

  return {
    app: plan.appName,
    serviceName: plan.serviceName,
    unitName: plan.unitName,
    releaseId: plan.releaseId,
    targetSelector: plan.targetSelector,
    artifactPath: plan.artifactPath,
    currentArtifactPath: plan.paths.currentArtifactPath,
    manifestPath: plan.paths.releaseManifestPath,
    recordPath: plan.paths.releaseRecordPath,
    unitPath: plan.paths.unitPath,
    releaseDir: plan.paths.releaseDir,
    dryRun: opts.dryRun === true,
    shellCommands: plan.shellCommands,
    summary: `Prepared ${plan.unitName} release ${plan.releaseId}${opts.dryRun ? ' (dry-run)' : ''}`,
  };
}

/**
 * @param {{ shell?: import('./shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./shared.js').CommandIO, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider, platform?: string }} [deps] - deps.
 * @returns {Command} - Result.
 */
export function createDeployCommand(deps = {}) {
  const command = new Command('deploy')
    .description('Deploy this artifact as a Linux/systemd-managed release')
    .option('--artifact-path <path>', 'Artifact binary path', process.execPath)
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
      '--systemd-dir <path>',
      'systemd unit directory',
      '/etc/systemd/system',
    )
    .option('--service-name <name>', 'Override systemd service name')
    .option('--release-id <id>', 'Override release identifier')
    .option('--role <role>', 'Runtime node role', 'all')
    .option('--service-user <user>', 'systemd service user', 'root')
    .option('--working-directory <path>', 'systemd working directory')
    .option(
      '--env <key=value>',
      'Environment variable assignment for the systemd unit (repeatable)',
      appendRepeatableOption,
      /** @type {string[]} */ ([]),
    )
    .option(
      '--start-arg <arg>',
      'Additional runtime bootstrap argument passed to the packaged artifact (repeatable)',
      appendRepeatableOption,
      /** @type {string[]} */ ([]),
    )
    .option('--dry-run', 'Print the deployment plan without mutating the host')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      const io = createCommandIO(deps.io);
      try {
        const result = await deployArtifact(opts, deps);
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

export default createDeployCommand;
