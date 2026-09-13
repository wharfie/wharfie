/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Internal acceptance host operations use compact typed helpers with fixed commands. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { assertDomainSeparatedSha256Id } from '../src/core/runtime/content-id.js';
import { createDeploymentOpenSshTransport } from '../src/core/runtime/deployment-openssh-transport.js';
import { readDeploymentSshHostKey } from '../src/core/runtime/deployment-ssh-host-key.js';
import { createDeploymentSshIdentityStore } from '../src/core/runtime/deployment-ssh-identity.js';
import {
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  createSingleNodeCloudInit,
} from '../src/core/runtime/single-node-cloud-init.js';
import {
  getSingleNodeDeploymentCurrentRelease,
  getSingleNodeDeploymentEffectiveDesired,
  validateSingleNodeDeploymentJournal,
} from '../src/core/runtime/single-node-deployment-journal.js';
import {
  getSingleNodeRemoteArtifactPaths,
  validateSingleNodeRemoteServiceIdentity,
} from '../src/core/runtime/single-node-remote-activation.js';
import { SINGLE_NODE_RUNTIME_ACCOUNT } from '../src/core/runtime/single-node-runtime-account.js';
import { runLiveDeploymentProcess } from './live-deployment-package.js';
import { rebootLiveDeploymentInChild } from './live-deployment-reboot-child.js';

const MAX_BYTES = 256 * 1024;
const BOOT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOOT_PATH = '/proc/sys/kernel/random/boot_id';

// Shell source is fixed. All variable data crosses as separate POSIX argv.
// Noclobber rejects existing files and symlinks; the acceptance owns this path.
const STAGE = 'set -eu; umask 077; set -C; /usr/bin/cat > "$1"';
const MARKERS =
  'set -eu; test ! -L "$1"; if test -f "$1"; then /usr/bin/cat -- "$1"; else test ! -e "$1"; fi';
const PROCESS = `set -eu
if owner=$(/usr/bin/stat -c %u /proc/"$1" 2>/dev/null) && stat=$(/usr/bin/cat /proc/"$1"/stat 2>/dev/null); then
  printf '%s\\n%s\\n' "$owner" "$stat"
elif test ! -d /proc/"$1"; then
  printf 'absent\\n'
else
  exit 1
fi
`;
// The final effect addresses the systemd unit, avoiding an unrelated reused PID.
const KILL = `set -eu
test "$(/usr/bin/cat /proc/sys/kernel/random/boot_id)" = "$1"
test "$(/usr/bin/id -u)" = "$5"
test "$(/usr/bin/stat -c %u /proc/"$2")" = "$5"
stat=$(/usr/bin/cat /proc/"$2"/stat)
fields=\${stat##*) }
set -- "$1" "$2" "$3" "$4" "$5" $fields
test "\${25}" = "$3"
test "$(/usr/bin/systemctl --user show --property=MainPID --value "$4")" = "$2"
/usr/bin/systemctl --user kill --kill-whom=main --signal=KILL "$4"
`;

/**
 * Keep raw remote output and provider diagnostics out of retained failures.
 * @template T
 * @param {string} phase
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function guarded(phase, operation) {
  const started = performance.now();
  try {
    return await operation();
  } catch (error) {
    const source =
      error !== null && typeof error === 'object' && 'diagnostic' in error
        ? /** @type {Record<string, any>} */ (error.diagnostic)
        : null;
    throw Object.assign(new Error(`Live deployment failed during ${phase}.`), {
      diagnostic: {
        phase,
        command: phase === 'host-reboot' ? 'node' : 'ssh',
        durationMs: Math.round(performance.now() - started),
        status: Number.isSafeInteger(source?.status) ? source?.status : null,
        signal:
          typeof source?.signal === 'string' &&
          /^SIG[A-Z0-9]{1,16}$/.test(source.signal)
            ? source.signal
            : null,
        timedOut: source?.timedOut === true,
        aborted: source?.aborted === true,
        outputLimitExceeded: source?.outputLimitExceeded === true,
        spawnError: source?.spawnError === true,
        stdinError: source?.stdinError === true,
        retryable: source?.retryable === true,
      },
    });
  }
}

/**
 * Decode a bounded object, never falling back to raw text in an error.
 * @param {Buffer} bytes
 * @returns {Record<string, any>}
 */
function json(bytes) {
  assert.ok(bytes.byteLength <= MAX_BYTES);
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

/** Compare JSON evidence independently of validators' null prototypes. @param {unknown} actual @param {unknown} expected */
function sameJson(actual, expected) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual)),
    JSON.parse(JSON.stringify(expected)),
  );
}

/** @param {Buffer} bytes @param {number} pid */
function processIdentity(bytes, pid) {
  const probe = bytes.toString('utf8');
  if (probe === 'absent\n') return null;
  const newline = probe.indexOf('\n');
  assert.ok(newline > 0);
  const uid = Number(probe.slice(0, newline));
  assert.ok(Number.isSafeInteger(uid) && uid >= 0);
  const stat = probe.slice(newline + 1);
  assert.ok(stat.startsWith(`${pid} (`));
  const fields = stat
    .slice(stat.lastIndexOf(') ') + 2)
    .trim()
    .split(/\s+/);
  assert.ok(fields.length >= 20 && /^[0-9]{1,20}$/.test(fields[19]));
  return { uid, pid, startTicks: fields[19] };
}

/**
 * Fixed operations against the exact acceptance journal and pinned SSH host.
 * Every public operation verifies the immutable bootstrap before guest access.
 * A target selector observes uploaded in-flight bytes without granting faults
 * or fixture writes before the controller commits that release.
 * @param {Record<string, any>} input
 * @param {Record<string, any>} [dependencies]
 */
export async function createLiveDeploymentHost(input, dependencies = {}) {
  return await guarded('host-initialize', async () => {
    const { state, dataRoot, env, signal } = input;
    const journal = validateSingleNodeDeploymentJournal(input.journal);
    const selection = input.release ?? 'current';
    assert.ok(['current', 'target'].includes(selection));
    const current = getSingleNodeDeploymentCurrentRelease(journal);
    const release =
      selection === 'target' ? journal.release.transition?.target : current;
    assert.ok(
      path.isAbsolute(dataRoot) && current && release && journal.sshHost,
    );
    if (selection === 'target')
      assert.equal(journal.release.transition.kind, 'update');
    const desired =
      selection === 'target'
        ? release.desired
        : getSingleNodeDeploymentEffectiveDesired(journal);
    assert.equal(journal.phase, 'active');
    assert.match(state.runId, RUN_ID);
    assert.equal(state.deploymentId, `acceptance-${state.runId}`);
    assert.equal(desired.intent.deployment.id, state.deploymentId);
    assert.equal(journal.deploymentInstanceId, state.deploymentInstanceId);
    assert.equal(desired.desiredRevisionId, state.desiredRevisionId);
    assert.equal(desired.intent.appId, state.appId);
    assert.equal(desired.intent.provider.kind, state.provider);
    assert.equal(desired.artifact.artifactId, state.guestArtifactId);
    assert.equal(desired.artifact.revisionId, state.guestRevisionId);
    assert.deepEqual(release.desired, desired);
    const expectedPath = `/home/wharfie/live-acceptance-${state.runId}.txt`;
    const run = dependencies.run ?? runLiveDeploymentProcess;
    const runProcess = {
      /** @param {Record<string, any>} request */
      async run(request) {
        const result = await run({
          file: request.file,
          args: request.args,
          cwd: dataRoot,
          env: request.environment,
          timeoutMs: request.timeoutMilliseconds,
          signal,
          phase: 'host-ssh',
          ...(request.stdin === null
            ? {}
            : { stdin: request.stdin.toString('utf8') }),
        });
        assert.ok(
          Buffer.byteLength(result.stdout) <= request.maximumStdoutBytes,
        );
        assert.ok(
          Buffer.byteLength(result.stderr) <= request.maximumStderrBytes,
        );
        return {
          status: /** @type {const} */ ('exited'),
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: Buffer.from(result.stdout),
          stderr: Buffer.from(result.stderr),
        };
      },
    };
    const identity = await (
      dependencies.readIdentity ??
      (async () =>
        await createDeploymentSshIdentityStore({
          root: path.join(dataRoot, 'single-node-deployment-ssh', 'v1'),
          runProcess,
        }).readIdentity({
          deploymentInstanceId: journal.deploymentInstanceId,
          incarnationId: journal.incarnationId,
        }))
    )();
    const cloudInit = createSingleNodeCloudInit({
      deploymentInstanceId: journal.deploymentInstanceId,
      incarnationId: journal.incarnationId,
      publicKey: identity.publicKey,
      publicKeyFingerprint: identity.publicKeyFingerprint,
    });
    sameJson(cloudInit.digest, journal.providerIntent.intent.cloudInitDigest);
    const hostKey = await (
      dependencies.readHostKey ?? readDeploymentSshHostKey
    )({
      address: journal.sshHost.address,
      knownHostsPath: identity.knownHostsPath,
    });
    sameJson(hostKey, journal.sshHost);
    const transport = (
      dependencies.createTransport ?? createDeploymentOpenSshTransport
    )({
      address: journal.sshHost.address,
      privateKeyPath: identity.privateKeyPath,
      knownHostsPath: identity.knownHostsPath,
      runProcess,
    });
    const remotePath =
      selection === 'target'
        ? getSingleNodeRemoteArtifactPaths(desired, journal.incarnationId)
            .remoteArtifactPath
        : release.activation.artifact.remotePath;
    /** @param {string[]} argv @param {Buffer|null} [stdin] @param {number} [timeoutMilliseconds] */
    const remote = async (argv, stdin = null, timeoutMilliseconds = 30_000) => {
      const result = await transport.runRemoteArgv({
        argv,
        stdin,
        timeoutMilliseconds,
        maximumStdoutBytes: MAX_BYTES,
        maximumStderrBytes: 8192,
      });
      assert.equal(result.status, 'exited');
      assert.equal(result.exitCode, 0);
      assert.ok(!result.timedOut && result.signal === null);
      assert.ok(
        Buffer.isBuffer(result.stdout) && result.stdout.length <= MAX_BYTES,
      );
      return /** @type {Buffer} */ (result.stdout);
    };
    const bootstrap = async () => {
      const actual = json(
        await remote([
          '/usr/bin/cat',
          '--',
          SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
        ]),
      );
      sameJson(actual, cloudInit.bootstrapIdentity);
    };
    const serviceStatus = async () => {
      if (selection === 'target') {
        const digest = await remote(['/usr/bin/sha256sum', '--', remotePath]);
        const expectedHex = Buffer.from(
          desired.artifact.byteDigest.value,
          'base64url',
        ).toString('hex');
        assert.equal(
          digest.toString('utf8'),
          `${expectedHex}  ${remotePath}\n`,
        );
      }
      const service = json(
        await remote([remotePath, 'wharfie', 'service', 'status', '--json']),
      );
      validateSingleNodeRemoteServiceIdentity(service, desired);
      assert.ok(
        Number.isSafeInteger(service.systemd.mainPid) &&
          service.systemd.mainPid >= 0,
      );
      return service;
    };
    const observe = async () =>
      await guarded('host-observe', async () => {
        await bootstrap();
        const bootId = (await remote(['/usr/bin/cat', '--', BOOT_PATH]))
          .toString('utf8')
          .trim();
        assert.match(bootId, BOOT_ID);
        const uid = Number(
          (await remote(['/usr/bin/id', '-u'])).toString('utf8').trim(),
        );
        assert.equal(uid, SINGLE_NODE_RUNTIME_ACCOUNT.uid);
        const service = await serviceStatus();
        const pid = service.systemd.mainPid;
        let identity = null;
        if (pid > 0) {
          const process = processIdentity(
            await remote([
              '/bin/sh',
              '-c',
              PROCESS,
              'wharfie-live-acceptance',
              String(pid),
            ]),
            pid,
          );
          if (process === null) {
            throw Object.assign(new Error('Resident observation changed.'), {
              diagnostic: { retryable: true },
            });
          }
          assert.equal(process.uid, uid);
          identity = { pid, startTicks: process.startTicks };
        }
        const finalBootId = (await remote(['/usr/bin/cat', '--', BOOT_PATH]))
          .toString('utf8')
          .trim();
        assert.equal(finalBootId, bootId);
        return {
          schemaVersion: 1,
          kind: 'wharfie.live-deployment.host',
          deploymentInstanceId: journal.deploymentInstanceId,
          incarnationId: journal.incarnationId,
          bootId,
          uid,
          artifactId: desired.artifact.artifactId,
          revisionId: desired.artifact.revisionId,
          service,
          process: identity,
        };
      });
    /** @param {Record<string, any>} before */
    const expectedObservation = async (before) => {
      const current = await observe();
      assert.equal(current.deploymentInstanceId, before.deploymentInstanceId);
      assert.equal(current.incarnationId, before.incarnationId);
      assert.equal(current.bootId, before.bootId);
      assert.equal(current.service.health, 'healthy');
      assert.deepEqual(current.process, before.process);
      assert.ok(current.process);
      return current;
    };
    return Object.freeze({
      observe,
      /** @param {Record<string, any>} before */
      async killResident(before) {
        return await guarded('host-kill-resident', async () => {
          assert.equal(
            selection,
            'current',
            'In-flight target observations cannot authorize host faults.',
          );
          const current = await expectedObservation(before);
          assert.ok(current.process);
          await remote([
            '/bin/sh',
            '-c',
            KILL,
            'wharfie-live-acceptance',
            current.bootId,
            String(current.process.pid),
            current.process.startTicks,
            current.service.unit,
            String(current.uid),
          ]);
          const deadline = performance.now() + 30_000;
          const remaining = () => {
            const value = Math.floor(deadline - performance.now());
            assert.ok(value > 0, 'Killed resident exit was not confirmed.');
            return Math.min(30_000, value);
          };
          for (;;) {
            const bootId = (
              await remote(['/usr/bin/cat', '--', BOOT_PATH], null, remaining())
            )
              .toString('utf8')
              .trim();
            assert.equal(bootId, current.bootId);
            const previous = processIdentity(
              await remote(
                [
                  '/bin/sh',
                  '-c',
                  PROCESS,
                  'wharfie-live-acceptance',
                  String(current.process.pid),
                ],
                null,
                remaining(),
              ),
              current.process.pid,
            );
            if (
              previous === null ||
              previous.startTicks !== current.process.startTicks
            )
              break;
            await delay(Math.min(250, remaining()), undefined, { signal });
          }
          return {
            action: 'resident-killed',
            bootId: current.bootId,
            process: current.process,
            predecessorExited: true,
          };
        });
      },
      /** @param {Record<string, any>} before */
      async reboot(before) {
        return await guarded('host-reboot', async () => {
          assert.equal(
            selection,
            'current',
            'In-flight target observations cannot authorize host faults.',
          );
          await expectedObservation(before);
          return await (dependencies.reboot ?? rebootLiveDeploymentInChild)({
            journal,
            dataRoot,
            env,
            signal,
          });
        });
      },
      /** @param {string} runId */
      async inspectRun(runId) {
        return await guarded('host-inspect-run', async () => {
          assertDomainSeparatedSha256Id(runId, 'wfr', 'workflow runId');
          await bootstrap();
          return json(
            await remote([
              remotePath,
              'wharfie',
              'inspect',
              '--run-id',
              runId,
              '--json',
            ]),
          );
        });
      },
      /** @param {string} inputPath @param {string} bytes */
      async stageInput(inputPath, bytes) {
        return await guarded('host-stage-input', async () => {
          assert.equal(
            selection,
            'current',
            'In-flight target observations cannot authorize fixture writes.',
          );
          assert.equal(inputPath, expectedPath);
          assert.ok(
            typeof bytes === 'string' && Buffer.byteLength(bytes) <= 4096,
          );
          await bootstrap();
          await remote(
            ['/bin/sh', '-c', STAGE, 'wharfie-live-acceptance', expectedPath],
            Buffer.from(bytes),
          );
          assert.equal(
            (await remote(['/usr/bin/cat', '--', expectedPath])).toString(
              'utf8',
            ),
            bytes,
          );
          return { staged: true, bytes: Buffer.byteLength(bytes) };
        });
      },
      /** @param {string} inputPath */
      async readMarkers(inputPath) {
        return await guarded('host-read-markers', async () => {
          assert.equal(inputPath, expectedPath);
          await bootstrap();
          const bytes = await remote([
            '/bin/sh',
            '-c',
            MARKERS,
            'wharfie-live-acceptance',
            `${expectedPath}.activities.jsonl`,
          ]);
          assert.ok(bytes.byteLength <= 16 * 1024);
          if (bytes.byteLength === 0) return [];
          const lines = bytes.toString('utf8').trim().split('\n');
          assert.ok(lines.length <= 16);
          return lines.map((line) => json(Buffer.from(line)));
        });
      },
    });
  });
}
