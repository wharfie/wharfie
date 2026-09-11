/**
 * @typedef RemoteRecoveryServiceFailure
 * @property {string} operation - Selected public service command.
 * @property {'exited'|'ambiguous'} status - Process completion classification.
 * @property {number|null} exitCode - Observed exit code.
 * @property {string|null} signal - Observed terminating signal.
 * @property {boolean} timedOut - Whether the process deadline expired.
 * @property {string} stdout - Bounded public command output prefix.
 * @property {string} stderr - Bounded public command error prefix.
 */

/**
 * Keep only bounded diagnostics for the proof's two public service commands.
 * @param {string} remotePath - Exact proof-owned artifact path.
 * @param {unknown} request - Request already validated by the real transport.
 * @param {import('../src/core/runtime/bounded-process.js').BoundedProcessOutcome} outcome - Real bounded process result.
 * @returns {RemoteRecoveryServiceFailure|null} - Allowed failure context only.
 */
export function remoteRecoveryServiceFailureContext(
  remotePath,
  request,
  outcome,
) {
  const argv = /** @type {{argv: string[]}} */ (request).argv;
  if (
    argv.length !== 5 ||
    argv[0] !== remotePath ||
    argv[1] !== 'wharfie' ||
    argv[2] !== 'service' ||
    !['converge', 'status'].includes(argv[3]) ||
    argv[4] !== '--json' ||
    (outcome.status === 'exited' && outcome.exitCode === 0)
  ) {
    return null;
  }
  return {
    operation: argv[3],
    status: outcome.status,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    stdout: outcome.stdout.subarray(0, 8192).toString('utf8'),
    stderr: outcome.stderr.subarray(0, 8192).toString('utf8'),
  };
}
