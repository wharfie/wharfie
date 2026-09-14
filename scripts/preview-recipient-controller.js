import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBoundedProcessRunner } from '../src/core/runtime/bounded-process.js';
import {
  cleanupPreviewRecipientTarget,
  finishPreviewRecipientTarget,
  preparePreviewRecipientTarget,
} from './preview-recipient-target.js';

export const RECIPIENT_HOME = '/home/wharfie-recipient';
export const RECIPIENT_HANDOFF = `${RECIPIENT_HOME}/recipient/handoff`;
export const RECIPIENT_USER = 'wharfie-recipient';
export const RECIPIENT_UID = 60707;

/**
 * Execute only an exact command as the prepared disposable recipient. Commands
 * have their own target-user timeout, including when the parent controller dies.
 * @param {{run?: ReturnType<typeof createBoundedProcessRunner>['run']}} [dependencies] - Bounded process seam.
 * @returns {(file: string, args: string[], options?: {timeoutMs?: number, maxOutputBytes?: number, allowFailure?: boolean}) => Promise<{status: number, stdout: string, stderr: string}>} - Isolated target command port.
 */
export function createPreviewRecipientTargetCommand(dependencies = {}) {
  const run = dependencies.run ?? createBoundedProcessRunner().run;
  return async (file, args, options = {}) => {
    assert.ok(path.isAbsolute(file));
    assert.ok(
      Array.isArray(args) && args.every((value) => typeof value === 'string'),
    );
    const timeoutMs = options.timeoutMs ?? 120_000;
    assert.ok(
      Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000,
    );
    const started = performance.now();
    const result = await run({
      file: '/usr/bin/sudo',
      args: [
        '-n',
        '-u',
        RECIPIENT_USER,
        '/usr/bin/timeout',
        '--signal=KILL',
        `${Math.ceil(timeoutMs / 1000)}s`,
        '/usr/bin/env',
        '-i',
        `--chdir=${RECIPIENT_HOME}`,
        `HOME=${RECIPIENT_HOME}`,
        `USER=${RECIPIENT_USER}`,
        `LOGNAME=${RECIPIENT_USER}`,
        `PATH=${RECIPIENT_HOME}/recipient/bin`,
        `XDG_CONFIG_HOME=${RECIPIENT_HOME}/.config`,
        `XDG_DATA_HOME=${RECIPIENT_HOME}/.local/share`,
        `XDG_STATE_HOME=${RECIPIENT_HOME}/.local/state`,
        `XDG_CACHE_HOME=${RECIPIENT_HOME}/.cache`,
        `XDG_RUNTIME_DIR=/run/user/${RECIPIENT_UID}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${RECIPIENT_UID}/bus`,
        'LANG=C.UTF-8',
        'TZ=UTC',
        `TMPDIR=${RECIPIENT_HOME}/recipient/tmp`,
        file,
        ...args,
      ],
      stdin: null,
      environment: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      timeoutMilliseconds: timeoutMs + 10_000,
      maximumStdoutBytes: options.maxOutputBytes ?? 1024 * 1024,
      maximumStderrBytes: 64 * 1024,
    });
    if (
      result.status !== 'exited' ||
      result.exitCode === null ||
      result.signal !== null ||
      result.timedOut ||
      [124, 137].includes(result.exitCode) ||
      (result.exitCode !== 0 && !options.allowFailure)
    ) {
      throw Object.assign(new Error('Recipient command failed.'), {
        diagnostic: {
          phase: 'recipient-command',
          command: path.basename(file),
          durationMs: Math.round(performance.now() - started),
          status: result.exitCode,
          signal: result.signal,
          timedOut:
            result.timedOut || [124, 137].includes(result.exitCode ?? 0),
        },
      });
    }
    return {
      status: result.exitCode,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
    };
  };
}

/**
 * Internal controller boundary. Parent-owned JSON carries no credentials; each
 * prepare/finish invocation is a separate process that exits before reconnect.
 * @param {string[]} argv - Phase and private authority, checkpoint, and result paths.
 * @returns {Promise<void>} - Persist bounded output for the supervising runner.
 */
export async function previewRecipientControllerMain(argv) {
  assert.equal(argv.length, 4);
  const [phase, authorityPath, checkpointPath, resultPath] = argv;
  assert.ok(['prepare', 'complete', 'cleanup'].includes(phase));
  for (const file of [authorityPath, checkpointPath, resultPath])
    assert.ok(path.isAbsolute(file));
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(
    process.env.WHARFIE_PREVIEW_RECIPIENT_DISPOSABLE,
    'github-actions',
  );
  const readJson = async (/** @type {string} */ file) => {
    const bytes = await readFile(file);
    assert.ok(bytes.length <= 256 * 1024);
    return JSON.parse(bytes.toString('utf8'));
  };
  const authority = await readJson(authorityPath);
  const dependencies = {
    run: createPreviewRecipientTargetCommand(),
    checkpoint: async (
      /** @type {string} */ name,
      /** @type {unknown} */ receipt,
    ) => {
      const bytes = JSON.stringify({ phase: name, receipt });
      assert.ok(Buffer.byteLength(bytes) <= 128 * 1024);
      await writeFile(checkpointPath, bytes + '\n', { mode: 0o600 });
      if (name === 'owned') {
        await writeFile(
          path.join(path.dirname(checkpointPath), 'authority-owned.json'),
          JSON.stringify(receipt) + '\n',
          { mode: 0o600, flag: 'wx' },
        );
      }
    },
  };
  let result;
  if (phase === 'prepare')
    result = await preparePreviewRecipientTarget(authority, dependencies);
  else if (phase === 'complete')
    result = await finishPreviewRecipientTarget(authority, dependencies);
  else result = await cleanupPreviewRecipientTarget(authority, dependencies);
  const bytes = JSON.stringify(result);
  assert.ok(Buffer.byteLength(bytes) <= 128 * 1024);
  await writeFile(resultPath, bytes + '\n', { mode: 0o600, flag: 'wx' });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  previewRecipientControllerMain(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      'Recipient controller failed; see the bounded checkpoint.\n',
    );
    process.exitCode = 1;
  });
}
