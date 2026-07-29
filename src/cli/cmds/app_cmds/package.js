import { Command } from 'commander';

import { packageLocalApp, stringifyJson } from '../../app/local-app.js';
import { createApplicationPackageReceipt } from '../../app/package-command-receipt.js';
import { packageSingleNodeSelfDeployableApp } from '../../app/single-node-self-deployable-package.js';
import { getHostBuildTarget } from '../../../core/runtime/host-build-target.js';
import { renderTerminalSafeJson } from '../../../core/runtime/operator/terminal-safe-json.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string} value - value.
 * @param {string[]} previous - previous.
 * @returns {string[]} - Result.
 */
function collectTargetFilter(value, previous) {
  return [...previous, value];
}

const UNSAFE_TERMINAL_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

/**
 * @param {string} value - Candidate terminal text.
 * @returns {boolean} - Whether the text contains active terminal controls.
 */
function containsUnsafeTerminalCharacters(value) {
  return UNSAFE_TERMINAL_CHARACTER.test(value);
}

/**
 * @param {string} value - Exact artifact path.
 * @returns {string} - Terminal-inert human path presentation.
 */
function formatHumanArtifactPath(value) {
  return containsUnsafeTerminalCharacters(value)
    ? 'path (JSON): ' + renderTerminalSafeJson(value)
    : value;
}

/**
 * @param {number} bytes - Exact byte length.
 * @returns {string} - Compact binary-size label.
 */
function formatArtifactSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}} target - Exact artifact target.
 * @returns {string} - Readable exact target identity.
 */
function formatTarget(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

/**
 * @param {string} value - One shell argument.
 * @returns {string} - Copy-pasteable POSIX shell argument.
 */
function quoteShellArgument(value) {
  if (containsUnsafeTerminalCharacters(value)) {
    throw new TypeError(
      'A terminal-unsafe path cannot be rendered as a shell command.',
    );
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/**
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}} target - Exact artifact target.
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}|null} hostTarget - Exact host target when it can be established.
 * @returns {boolean} - Whether the standalone artifact can run on this host.
 */
function isHostTarget(target, hostTarget) {
  if (!hostTarget) return false;
  return (
    target.platform === hostTarget.platform &&
    target.architecture === hostTarget.architecture &&
    (target.platform !== 'linux' || target.libc === hostTarget.libc)
  );
}

/**
 * @param {() => {nodeVersion: string, platform: string, architecture: string, libc?: string}} readHostTarget - Exact host target reader.
 * @returns {{nodeVersion: string, platform: string, architecture: string, libc?: string}|null} - Exact host target, or null when this host is unsupported.
 */
function resolveHumanHostTarget(readHostTarget) {
  try {
    return readHostTarget();
  } catch {
    return null;
  }
}

/**
 * Render the default, human-first package result. The versioned JSON receipt
 * remains available unchanged behind --json.
 * @param {ReturnType<typeof createApplicationPackageReceipt>} receipt - Validated package receipt.
 * @param {boolean} durable - Whether the packaged app declares a durable CLI handoff.
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}|null} hostTarget - Exact host target when it can be established.
 * @returns {string} - Human package summary including a copy-pasteable next command when safe.
 */
function formatPackageSummary(receipt, durable, hostTarget) {
  const artifactLabel =
    receipt.artifactCount === 1
      ? ''
      : ' (' + receipt.artifactCount + ' artifacts)';
  const lines = ['✓ Packaged ' + receipt.appId + artifactLabel];

  for (const artifact of receipt.artifacts) {
    lines.push(
      '  ' +
        formatTarget(artifact.target) +
        ' · ' +
        formatArtifactSize(artifact.size),
      '  ' + formatHumanArtifactPath(artifact.path),
    );
  }

  const nextArtifact =
    receipt.artifacts.find((artifact) =>
      isHostTarget(artifact.target, hostTarget),
    ) || receipt.artifacts[0];
  const nextIsOnThisHost = isHostTarget(nextArtifact.target, hostTarget);
  const nextLabel = nextIsOnThisHost
    ? 'Next'
    : 'Next on ' + formatTarget(nextArtifact.target);
  if (!nextIsOnThisHost) {
    lines.push(
      nextLabel +
        ': copy the artifact shown above to a matching host and invoke it there.',
    );
  } else if (nextArtifact.target.platform === 'win32') {
    lines.push(
      'Next: invoke the artifact shown above from your Windows shell; an exact command is omitted because cmd.exe and PowerShell use different quoting syntax.',
    );
  } else if (containsUnsafeTerminalCharacters(nextArtifact.path)) {
    lines.push(
      nextLabel +
        ': shell command omitted because the artifact path contains terminal-unsafe control or format characters; rerun with --json for the exact machine-readable path.',
    );
  } else {
    const durableArguments = durable ? ' wharfie run --name first-run --' : '';
    lines.push(
      nextLabel +
        ': ' +
        quoteShellArgument(nextArtifact.path) +
        durableArguments,
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * @typedef {(chunk: string | Uint8Array, encoding?: NodeJS.BufferEncoding | (() => void), callback?: (() => void)) => boolean} StreamWrite
 */

/**
 * Reserve stdout for the package receipt while trusted manifest and build code
 * runs in-process. Diagnostics remain visible on stderr.
 * @template T
 * @param {() => Promise<T>} operation - Package operation.
 * @returns {Promise<T>} - Package result.
 */
async function withPackageStdoutReserved(operation) {
  const originalStdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  /** @type {StreamWrite} */
  const redirectedWrite = function redirectedWrite(chunk, encoding, callback) {
    /** @type {NodeJS.BufferEncoding | undefined} */
    const resolvedEncoding =
      typeof encoding === 'string' ? encoding : undefined;
    /** @type {(() => void) | undefined} */
    let resolvedCallback = typeof encoding === 'function' ? encoding : callback;
    if (typeof resolvedCallback !== 'function') resolvedCallback = undefined;

    const writer = /** @type {StreamWrite} */ (stderrWrite);
    return writer.call(
      process.stderr,
      chunk,
      resolvedEncoding,
      resolvedCallback,
    );
  };

  process.stdout.write = /** @type {typeof process.stdout.write} */ (
    redirectedWrite
  );
  try {
    return await operation();
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}

/**
 * Create one fresh package command. Injection keeps command serialization
 * independently testable without constructing a native SEA.
 * @param {{
 *   packageApplication?: typeof packageLocalApp,
 *   packageSelfDeployableApplication?: typeof packageSingleNodeSelfDeployableApp,
 *   writeOutput?: (value: string) => unknown,
 *   writeDiagnostic?: (value: string) => unknown,
 *   readHostTarget?: typeof getHostBuildTarget
 * }} [dependencies] - Optional command adapters.
 * @returns {Command} - Fresh package command.
 */
export function createPackageCommand(dependencies = {}) {
  const packageApplication = dependencies.packageApplication || packageLocalApp;
  const packageSelfDeployableApplication =
    dependencies.packageSelfDeployableApplication ||
    packageSingleNodeSelfDeployableApp;
  const writeOutput =
    dependencies.writeOutput ||
    ((value) => {
      process.stdout.write(value);
    });
  const writeDiagnostic =
    dependencies.writeDiagnostic ||
    ((value) => {
      process.stderr.write(value);
    });
  const readHostTarget = dependencies.readHostTarget || getHostBuildTarget;

  return new Command('package')
    .description('Package a Wharfie app into executable artifacts')
    .argument('[dir]', 'Directory containing wharfie.app.js (default: cwd)')
    .option(
      '--output-dir <dir>',
      'Directory to copy packaged artifacts into (default: <app dir>/dist)',
    )
    .option(
      '-t, --target <target>',
      'Package only the selected build target (repeatable)',
      collectTargetFilter,
      [],
    )
    .option(
      '--self-deployable',
      'Embed an authenticated Linux SEA for single-node cloud deployment',
    )
    .option('--json', 'Output the versioned JSON package receipt')
    .option(
      '--no-pretty',
      'Disable pretty JSON output (implies --json for compatibility)',
    )
    .action(async (dir, options) => {
      const resolvedDir = dir || process.cwd();
      const jsonOutput = options.json || options.pretty === false;

      try {
        const packageOutput = await withPackageStdoutReserved(async () => {
          const onProgress = jsonOutput
            ? undefined
            : (/** @type {{message?: unknown}} */ progress) => {
                if (typeof progress?.message !== 'string') return;
                writeDiagnostic(`  ${progress.message}\n`);
              };
          const packageRequest = {
            dir: resolvedDir,
            outputDir: options.outputDir,
            targetFilters: Array.isArray(options.target) ? options.target : [],
            ...(onProgress ? { onProgress } : {}),
          };
          if (!options.selfDeployable) {
            const result = await packageApplication(packageRequest);
            return {
              receipt: createApplicationPackageReceipt(result),
              durable: !!result?.revision?.contract?.cli?.durable,
            };
          }
          const result = await packageSelfDeployableApplication(packageRequest);
          return {
            receipt: createApplicationPackageReceipt({
              app: result.app,
              revision: result.revision,
              targets: result.targets,
              outputDir: result.outputDir,
              artifacts: result.artifacts,
            }),
            durable: !!result?.revision?.contract?.cli?.durable,
          };
        });
        writeOutput(
          jsonOutput
            ? `${stringifyJson(packageOutput.receipt, options)}\n`
            : formatPackageSummary(
                packageOutput.receipt,
                packageOutput.durable,
                resolveHumanHostTarget(readHostTarget),
              ),
        );
      } catch (err) {
        displayFailure(err);
        process.exitCode = 1;
      }
    });
}
