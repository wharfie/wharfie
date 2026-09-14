/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Fixed acceptance-only target operations. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from '../src/core/runtime/application-revision.js';
import { assertArtifactId } from '../src/core/runtime/artifact-record.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../src/core/runtime/build-target.js';
import { assertDomainSeparatedSha256Id } from '../src/core/runtime/content-id.js';
import { assertStableDecision } from './verify-steady-file-preview-target.js';

export const PREVIEW_RECIPIENT_TARGET = Object.freeze({
  username: 'wharfie-recipient',
  uid: 60707,
  home: '/home/wharfie-recipient',
  path: '/home/wharfie-recipient/recipient/bin',
  handoff: '/home/wharfie-recipient/recipient/handoff',
  executable: '/home/wharfie-recipient/recipient/handoff/app',
  artifactRecordPath:
    '/home/wharfie-recipient/recipient/handoff/artifact-record.json',
  inputPath: '/home/wharfie-recipient/recipient/handoff/input.txt',
});
const APP_ID = 'steady-file-demo';
const UNIT = `wharfie-${APP_ID}.service`;
const APP_ROOT = `${PREVIEW_RECIPIENT_TARGET.home}/.local/share/wharfie-nodejs/applications/${APP_ID}`;
// Exact sibling derivation from createServicePurgeTombstonePath in the manager.
const PURGE_TOMBSTONE = `${PREVIEW_RECIPIENT_TARGET.home}/.local/share/wharfie-nodejs/applications/.wharfie-service-purge-v1.${APP_ID}`;
const UNIT_PATH = `${PREVIEW_RECIPIENT_TARGET.home}/.config/systemd/user/${UNIT}`;
const MAX_OUTPUT_BYTES = 512 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const PHASE_TIMEOUT_MS = 180_000;
const TIMER_MS = 60_000;
const SERVICE_ACTIONS = new Set([
  'install',
  'converge',
  'update',
  'rollback',
  'recover',
  'prune',
  'purge',
  'start',
  'stop',
  'restart',
  'status',
  'uninstall',
]);

/** @typedef {{status:number, stdout:string, stderr:string, signal?:string|null}} TargetResult */
/** @typedef {{runId:string, artifactRecord:Record<string, any>, inputBytes:string}} TargetInput */
/** @typedef {{run:(command:string,args:string[],options:{timeoutMs:number,maxOutputBytes:number,allowFailure:boolean})=>Promise<TargetResult>, checkpoint?:(phase:string,receipt:Record<string,any>)=>Promise<void>|void, now?:()=>number, wait?:(duration:number)=>Promise<void>, controllerProcessId?:number}} TargetPorts */

/**
 * @param {string} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {unknown} value
 * @returns {Record<string,any>}
 */
function object(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return /** @type {Record<string,any>} */ (value);
}

/**
 * Preserve only a recognized public service error's fixed action and code.
 * Messages, remediation, raw output, and unrelated JSON never enter receipts.
 * @param {TargetResult} result
 * @param {string} action
 * @returns {{action:string,code:string}|undefined}
 */
function serviceError(result, action) {
  if (result.status === 0 || !SERVICE_ACTIONS.has(action)) return undefined;
  for (const output of [result.stderr, result.stdout]) {
    const line = output.trim().split('\n').filter(Boolean).at(-1);
    if (!line || Buffer.byteLength(line) > 16 * 1024) continue;
    try {
      const value = JSON.parse(line);
      if (
        value?.schemaVersion === 1 &&
        value.kind === 'wharfie.service.error' &&
        value.action === action &&
        typeof value.code === 'string' &&
        /^[a-z][a-z0-9-]{0,95}$/.test(value.code)
      )
        return { action, code: value.code };
    } catch {
      // The command still fails; only recognized structured diagnostics survive.
    }
  }
  return undefined;
}

/**
 * @param {TargetInput} input
 * @param {TargetPorts} ports
 */
function context(input, ports) {
  assert.match(
    input.runId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(typeof input.inputBytes, 'string');
  assert.ok(
    Buffer.byteLength(input.inputBytes) > 0 &&
      Buffer.byteLength(input.inputBytes) <= 4096,
  );
  const artifact = object(input.artifactRecord);
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.kind, 'artifactRecord');
  assert.equal(artifact.appId, APP_ID);
  assertArtifactId(artifact.artifactId);
  assertApplicationRevisionId(artifact.revisionId);
  const digest = validateSha256Digest(artifact.byteDigest);
  assert.equal(artifact.artifactId, `waf1_${digest.value}`);
  assert.ok(Number.isSafeInteger(artifact.size) && artifact.size > 0);
  assert.deepEqual(artifact.format, { kind: 'node-sea', version: 1 });
  const target = validateBuildTarget(artifact.target);
  assert.equal(target.platform, 'linux');
  assert.equal(target.architecture, 'x64');
  assert.equal(target.libc, 'glibc');
  assert.equal(artifact.targetId, getBuildTargetId(target));
  const artifactSha256 = Buffer.from(digest.value, 'base64url').toString('hex');
  const now = ports.now || Date.now;
  const wait = ports.wait || delay;
  const controllerProcessId = ports.controllerProcessId ?? process.pid;
  assert.ok(
    Number.isSafeInteger(controllerProcessId) && controllerProcessId > 0,
  );
  const startedAt = now();
  const deadline = startedAt + PHASE_TIMEOUT_MS;
  let stage = 'validate-target';
  /** @type {{executable:string,status:number|null,signal:string|null,timedOut:boolean,serviceError?:{action:string,code:string}}|null} */
  let commandResult = null;
  /** @type {Record<string,any>|undefined} */
  let purgeTree;
  const binding = {
    schemaVersion: 1,
    kind: 'wharfie.preview-recipient.target-owned',
    runId: input.runId,
    uid: PREVIEW_RECIPIENT_TARGET.uid,
    home: PREVIEW_RECIPIENT_TARGET.home,
    appId: APP_ID,
    artifactId: artifact.artifactId,
    revisionId: artifact.revisionId,
    artifactSha256,
    inputSha256: sha256(input.inputBytes),
  };
  const fingerprint = {
    bytes: Buffer.byteLength(input.inputBytes),
    sha256: binding.inputSha256,
    readStable: true,
  };
  const expected = {
    stable: true,
    baseline: fingerprint,
    current: fingerprint,
  };

  /**
   * @param {string} name
   * @param {Record<string,any>} value
   */
  async function checkpoint(name, value) {
    assert.ok(Buffer.byteLength(JSON.stringify(value)) <= MAX_OUTPUT_BYTES);
    await ports.checkpoint?.(name, value);
  }
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {{allowFailure?:boolean,timeoutMs?:number,maxOutputBytes?:number}} [options]
   */
  async function run(command, args, options = {}) {
    assert.ok(now() < deadline, 'Recipient phase deadline elapsed.');
    const executable = command.split('/').at(-1) || 'unknown';
    commandResult = { executable, status: null, signal: null, timedOut: false };
    let result;
    try {
      result = await ports.run(command, args, {
        timeoutMs: Math.max(
          1,
          Math.min(options.timeoutMs ?? COMMAND_TIMEOUT_MS, deadline - now()),
        ),
        maxOutputBytes: Math.min(
          options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
          MAX_OUTPUT_BYTES,
        ),
        allowFailure: true,
      });
    } catch (error) {
      const diagnostic = /** @type {{diagnostic?:Record<string,any>}|null} */ (
        error
      )?.diagnostic;
      commandResult = {
        executable,
        status: Number.isSafeInteger(diagnostic?.status)
          ? diagnostic?.status
          : null,
        signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(diagnostic?.signal)
          ? diagnostic?.signal
          : null,
        timedOut: diagnostic?.timedOut === true,
      };
      throw new Error('Recipient command failed.');
    }
    commandResult = {
      executable,
      status: Number.isSafeInteger(result.status) ? result.status : null,
      signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(result.signal || '')
        ? (result.signal ?? null)
        : null,
      timedOut: false,
    };
    assert.ok(now() < deadline, 'Recipient phase deadline elapsed.');
    assert.equal(typeof result.stdout, 'string');
    assert.equal(typeof result.stderr, 'string');
    assert.ok(
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <=
        MAX_OUTPUT_BYTES,
    );
    if (
      command === PREVIEW_RECIPIENT_TARGET.executable &&
      args[0] === 'wharfie' &&
      args[1] === 'service'
    ) {
      const recognized = serviceError(result, args[2]);
      if (recognized) commandResult.serviceError = recognized;
    }
    if (!options.allowFailure)
      assert.equal(result.status, 0, 'Recipient command failed.');
    return result;
  }
  /** Collect bounded metadata only after the exact public purge retry fails. */
  async function capturePurgeTree() {
    const originalCommand = commandResult;
    purgeTree = {
      schemaVersion: 1,
      kind: 'wharfie.preview-recipient.purge-tree',
      roots: [],
      complete: false,
      truncated: false,
      rejectedNames: false,
    };
    let remainingBytes = 64 * 1024;
    let remainingEntries = 256;
    try {
      for (const suffix of [
        '.local',
        '.local/share',
        '.local/share/wharfie-nodejs',
        '.local/share/wharfie-nodejs/applications',
      ]) {
        const ancestor = `${PREVIEW_RECIPIENT_TARGET.home}/${suffix}`;
        assert.equal(
          await text('/usr/bin/stat', ['--format=%F:%u', '--', ancestor]),
          `directory:${PREVIEW_RECIPIENT_TARGET.uid}`,
        );
      }
      for (const [label, root] of [
        ['application', APP_ROOT],
        ['tombstone', PURGE_TOMBSTONE],
      ]) {
        const exists = await run('/usr/bin/test', ['-e', root], {
          allowFailure: true,
        });
        const link = await run('/usr/bin/test', ['-L', root], {
          allowFailure: true,
        });
        assert.ok(
          [0, 1].includes(exists.status) && [0, 1].includes(link.status),
        );
        const missing = exists.status === 1 && link.status === 1;
        const observed = {
          root: label,
          missing,
          entries: /** @type {Record<string,any>[]} */ ([]),
        };
        purgeTree.roots.push(observed);
        if (missing) continue;
        if (remainingBytes <= 0 || remainingEntries <= 0) {
          purgeTree.truncated = true;
          continue;
        }
        const result = await run(
          '/usr/bin/find',
          ['-P', root, '-xdev', '-printf', '%y\t%m\t%U\t%n\t%D\t%P\\0'],
          { timeoutMs: 10_000, maxOutputBytes: remainingBytes },
        );
        remainingBytes -=
          Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
        assert.ok(remainingBytes >= 0);
        assert.ok(result.stdout.endsWith('\0'));
        for (const row of result.stdout.slice(0, -1).split('\0')) {
          if (remainingEntries === 0) {
            purgeTree.truncated = true;
            break;
          }
          const parts = row.split('\t');
          assert.equal(parts.length, 6);
          const [type, mode, uid, nlink, dev, relativePath] = parts;
          assert.match(type, /^[bcdflps?]$/);
          assert.match(mode, /^[0-7]{1,4}$/);
          for (const number of [uid, nlink, dev])
            assert.ok(
              /^\d{1,20}$/.test(number) && Number.isSafeInteger(Number(number)),
            );
          if (
            relativePath.length > 2048 ||
            (relativePath !== '' &&
              relativePath
                .split('/')
                .some(
                  (part) =>
                    !/^[A-Za-z0-9._-]{1,128}$/.test(part) ||
                    part === '.' ||
                    part === '..',
                ))
          ) {
            purgeTree.rejectedNames = true;
            continue;
          }
          observed.entries.push({
            type,
            mode,
            uid: Number(uid),
            nlink: Number(nlink),
            dev: Number(dev),
            relativePath: relativePath || '.',
          });
          remainingEntries--;
        }
      }
      purgeTree.complete = !purgeTree.truncated && !purgeTree.rejectedNames;
    } catch {
      purgeTree.observationFailed = true;
    } finally {
      // Metadata collection must not replace the failed purge command evidence.
      commandResult = originalCommand;
    }
  }
  /**
   * @param {string} command
   * @param {string[]} args
   */
  async function text(command, args) {
    return (await run(command, args)).stdout.trim();
  }
  /**
   * @param {string[]} args
   * @param {{allowFailure?:boolean,timeoutMs?:number}} [options]
   */
  async function app(args, options) {
    return await run(PREVIEW_RECIPIENT_TARGET.executable, args, options);
  }
  /**
   * @param {string} textValue
   */
  function parse(textValue) {
    return object(
      JSON.parse(textValue.trim().split('\n').filter(Boolean).at(-1) || ''),
    );
  }
  /**
   * @param {string[]} args
   * @param {number} [timeoutMs]
   */
  async function appJson(args, timeoutMs) {
    return parse((await app(args, { timeoutMs })).stdout);
  }
  /**
   * @param {string} file
   */
  async function absent(file) {
    assert.equal(
      (await run('/usr/bin/test', ['-e', file], { allowFailure: true })).status,
      1,
    );
    assert.equal(
      (await run('/usr/bin/test', ['-L', file], { allowFailure: true })).status,
      1,
    );
  }
  /**
   * @param {string} file
   * @param {string} expectedDigest
   */
  async function digestFile(file, expectedDigest) {
    assert.equal(
      (await run('/usr/bin/test', ['-L', file], { allowFailure: true })).status,
      1,
    );
    assert.equal(
      await text('/usr/bin/sha256sum', ['--', file]),
      `${expectedDigest}  ${file}`,
    );
  }
  /**
   * @param {unknown} owned
   */
  function assertOwned(owned) {
    assert.deepEqual(owned, binding);
  }
  /** Validate only exact transferred authority; never infer ownership from app ID alone. */
  async function validateTarget() {
    assert.equal(
      await text('/usr/bin/id', ['-u']),
      String(PREVIEW_RECIPIENT_TARGET.uid),
    );
    assert.equal(
      await text('/usr/bin/id', ['-un']),
      PREVIEW_RECIPIENT_TARGET.username,
    );
    assert.equal(await text('/usr/bin/uname', ['-sm']), 'Linux x86_64');
    assert.equal(
      await text('/usr/bin/printenv', ['HOME']),
      PREVIEW_RECIPIENT_TARGET.home,
    );
    assert.equal(
      await text('/usr/bin/printenv', ['PATH']),
      PREVIEW_RECIPIENT_TARGET.path,
    );
    assert.equal(
      await text('/usr/bin/stat', [
        '--format=%a:%u',
        '--',
        PREVIEW_RECIPIENT_TARGET.home,
      ]),
      `700:${PREVIEW_RECIPIENT_TARGET.uid}`,
    );
    for (const tool of ['node', 'npm']) {
      const unavailable = await run('/usr/bin/env', [tool, '--version'], {
        allowFailure: true,
      });
      assert.equal(
        unavailable.status,
        127,
        'Recipient exposes a development runtime.',
      );
    }
    assert.equal(
      await text('/usr/bin/loginctl', [
        'show-user',
        String(PREVIEW_RECIPIENT_TARGET.uid),
        '--property=Linger',
        '--value',
      ]),
      'yes',
    );
    const managerEnvironment = (
      await text('/usr/bin/systemctl', ['--user', 'show-environment'])
    ).split('\n');
    assert.deepEqual(
      managerEnvironment.filter((entry) => entry.startsWith('PATH=')),
      [`PATH=${PREVIEW_RECIPIENT_TARGET.path}`],
    );
    assert.equal(
      await text('/usr/bin/stat', [
        '--format=%F:%s:%a:%u',
        '--',
        PREVIEW_RECIPIENT_TARGET.executable,
      ]),
      `regular file:${artifact.size}:700:${PREVIEW_RECIPIENT_TARGET.uid}`,
    );
    await digestFile(PREVIEW_RECIPIENT_TARGET.executable, artifactSha256);
    assert.equal(
      (
        await run(
          '/usr/bin/test',
          ['-L', PREVIEW_RECIPIENT_TARGET.artifactRecordPath],
          { allowFailure: true },
        )
      ).status,
      1,
    );
    assert.deepEqual(
      object(
        JSON.parse(
          await text('/usr/bin/cat', [
            PREVIEW_RECIPIENT_TARGET.artifactRecordPath,
          ]),
        ),
      ),
      JSON.parse(JSON.stringify(artifact)),
    );
    assert.equal(
      await text('/usr/bin/stat', [
        '--format=%F:%s:%a:%u',
        '--',
        PREVIEW_RECIPIENT_TARGET.inputPath,
      ]),
      `regular file:${fingerprint.bytes}:600:${PREVIEW_RECIPIENT_TARGET.uid}`,
    );
    await digestFile(PREVIEW_RECIPIENT_TARGET.inputPath, binding.inputSha256);
  }
  /** Read public service state. */
  async function service() {
    return await appJson(['wharfie', 'service', 'status', '--json']);
  }
  /**
   * @param {Record<string,any>} status
   */
  async function healthy(status) {
    const reference = {
      artifactId: artifact.artifactId,
      revisionId: artifact.revisionId,
    };
    assert.equal(status.schemaVersion, 3);
    assert.equal(status.kind, 'wharfie.service.status');
    assert.equal(status.appId, APP_ID);
    assert.equal(status.unit, UNIT);
    assert.equal(status.health, 'healthy');
    assert.equal(status.persistence?.linger, true);
    assert.equal(status.persistence?.unitEnabled, true);
    assert.equal(status.persistence?.bootEnabled, true);
    assert.equal(status.systemd?.fragmentPath, UNIT_PATH);
    assert.equal(status.systemd?.dropInPaths, '');
    assert.ok(
      Number.isSafeInteger(status.systemd?.mainPid) &&
        status.systemd.mainPid > 0,
    );
    assert.equal(status.runtime?.processId, status.systemd.mainPid);
    assert.equal(status.runtime?.status, 'READY');
    assert.equal(status.runtime?.session, 'active');
    assert.equal(status.runtime?.currentOwner, true);
    assert.equal(status.integrity?.status, 'verified');
    assert.equal(status.installation?.activeArtifactId, artifact.artifactId);
    assert.equal(status.installation?.activeRevisionId, artifact.revisionId);
    assert.equal(status.installation?.previousArtifactId, null);
    assert.equal(status.installation?.previousRevisionId, null);
    assert.equal(status.activation?.phase, 'ACTIVE');
    assert.deepEqual(status.activation?.selected, reference);
    assert.equal(status.activation?.rollback, null);
    assert.equal(status.desiredConvergence?.disposition, 'authorized');
    assert.deepEqual(status.desiredConvergence?.desired, reference);
    const releasePath = `${APP_ROOT}/releases/${artifact.artifactId}/app`;
    await digestFile(releasePath, artifactSha256);
    assert.equal(
      await text('/usr/bin/readlink', [`/proc/${status.systemd.mainPid}/exe`]),
      releasePath,
    );
    assert.equal(
      await text('/usr/bin/stat', [
        '--format=%u',
        '--',
        `/proc/${status.systemd.mainPid}`,
      ]),
      String(PREVIEW_RECIPIENT_TARGET.uid),
    );
    const environment = (
      await run('/usr/bin/cat', [`/proc/${status.systemd.mainPid}/environ`])
    ).stdout.split('\0');
    assert.deepEqual(
      environment.filter((entry) => entry.startsWith('PATH=')),
      [`PATH=${PREVIEW_RECIPIENT_TARGET.path}`],
    );
    assert.deepEqual(
      environment.filter((entry) => entry.startsWith('HOME=')),
      [`HOME=${PREVIEW_RECIPIENT_TARGET.home}`],
    );
    return {
      artifactId: artifact.artifactId,
      revisionId: artifact.revisionId,
      processId: status.systemd.mainPid,
      generation: status.runtime.generation,
      releasePath,
      nodeUnavailable: true,
    };
  }
  /**
   * @param {string} runId
   */
  async function inspect(runId) {
    assertDomainSeparatedSha256Id(runId, 'wfr', 'workflow runId');
    const view = await appJson([
      'wharfie',
      'inspect',
      '--run-id',
      runId,
      '--json',
    ]);
    assert.equal(view.kind, 'wharfie.execution-ledger.run');
    assert.deepEqual(view.integrity, { verified: true });
    for (const identity of [view.run, view.workflowCursor]) {
      assert.equal(identity?.runId, runId);
      assert.equal(identity?.appId, APP_ID);
      assert.equal(identity?.revisionId, artifact.revisionId);
    }
    assert.equal(view.run.trigger?.kind, 'workflow');
    assert.equal(view.run.trigger?.workflowId, 'verify-stable');
    return view;
  }
  /**
   * @param {Record<string,any>} view
   * @param {string[]} activities
   */
  function assertActivities(view, activities) {
    assert.deepEqual(
      view.invocations
        .map((/** @type {Record<string,any>} */ entry) => entry.activityId)
        .sort(),
      [...activities].sort(),
    );
    assert.equal(view.attempts.length, activities.length);
    for (const invocation of view.invocations) {
      assert.equal(invocation.status, 'COMPLETED');
      const attempts = view.attempts.filter(
        (/** @type {Record<string,any>} */ entry) =>
          entry.invocationId === invocation.invocationId,
      );
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].status, 'COMPLETED');
      assert.equal(attempts[0].generation, invocation.generation);
    }
  }
  /**
   * @param {Record<string,any>} view
   * @param {number} remaining
   * @param {Record<string,any>} [previous]
   */
  function waiting(view, remaining, previous) {
    assert.equal(view.run.status, 'RUNNING');
    assert.equal(view.workflowCursor.disposition, 'TIMER_WAITING');
    assert.equal(view.workflowCursor.stepId, 'stability-window');
    assert.equal(view.timers.length, 1);
    const timer = view.timers[0];
    assert.equal(timer.status, 'WAITING');
    assert.equal(timer.stepId, 'stability-window');
    assert.equal(timer.timerId, view.workflowCursor.timerId);
    assert.equal(timer.dueAt - timer.scheduledAt, TIMER_MS);
    assert.ok(timer.dueAt - now() >= remaining);
    assertActivities(view, ['capture']);
    if (previous) {
      assert.deepEqual(view.timers, previous.timers);
      assert.deepEqual(view.invocations, previous.invocations);
      assert.deepEqual(view.attempts, previous.attempts);
    }
  }
  /**
   * @param {string} runId
   * @param {(view:Record<string,any>)=>boolean} matches
   */
  async function poll(runId, matches) {
    while (now() < deadline) {
      const view = await inspect(runId);
      if (matches(view)) return view;
      assert.equal(view.run.status, 'RUNNING');
      await wait(Math.min(500, Math.max(1, deadline - now())));
    }
    throw new Error('Recipient phase deadline elapsed.');
  }
  /**
   * @param {string} runId
   * @param {string} status
   */
  async function history(runId, status) {
    const page = await appJson(['wharfie', 'list', '--limit', '10', '--json']);
    assert.equal(page.kind, 'wharfie.execution-ledger.run-page');
    assert.deepEqual(page.integrity, { verified: true });
    assert.deepEqual(page.scope, { appId: APP_ID });
    assert.equal(page.nextCursor, null);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].runId, runId);
    assert.equal(page.items[0].revisionId, artifact.revisionId);
    assert.equal(page.items[0].kind, 'workflow');
    assert.equal(page.items[0].status, status);
    return page;
  }
  /**
   * @param {string} runId
   */
  async function output(runId) {
    const result = await appJson([
      'wharfie',
      'output',
      '--run-id',
      runId,
      '--confirm-sensitive-output',
      '--json',
    ]);
    assert.equal(result.kind, 'wharfie.execution-ledger.run-output');
    assert.equal(result.disclosure, 'application-sensitive-unredacted');
    assert.deepEqual(result.integrity, { verified: true });
    assert.deepEqual(result.scope, {
      appId: APP_ID,
      revisionId: artifact.revisionId,
      runId,
    });
    assert.equal(result.snapshot?.runKind, 'workflow');
    assert.equal(result.snapshot?.status, 'COMPLETED');
    assert.deepEqual(
      result.outputs?.map(
        (/** @type {Record<string,any>} */ entry) => entry.stepId,
      ),
      ['baseline', 'stability-window', 'comparison'],
    );
    assertStableDecision(
      result.outputs.at(-1)?.value,
      PREVIEW_RECIPIENT_TARGET.inputPath,
      expected,
    );
    assert.equal(result.terminal?.type, 'completed');
    assertStableDecision(
      result.terminal?.result,
      PREVIEW_RECIPIENT_TARGET.inputPath,
      expected,
    );
    return result;
  }
  /**
   * @param {string} name
   * @param {()=>Promise<Record<string,any>>} operation
   */
  async function phase(name, operation) {
    stage = name;
    try {
      const receipt = await operation();
      assert.ok(now() < deadline, 'Recipient phase deadline elapsed.');
      await checkpoint(name, receipt);
      assert.ok(now() < deadline, 'Recipient phase deadline elapsed.');
      return receipt;
    } catch (error) {
      if (
        stage === 'complete-cleanup' &&
        /** @type {{diagnostic?:{kind?:unknown}}|null} */ (error)?.diagnostic
          ?.kind === 'wharfie.preview-recipient.target-failure'
      )
        throw error;
      const receipt = {
        schemaVersion: 1,
        kind: 'wharfie.preview-recipient.target-failure',
        phase: stage,
        durationMs: Math.max(0, now() - startedAt),
        code:
          error instanceof SyntaxError
            ? 'invalid-json'
            : commandResult?.status !== 0 && commandResult !== null
              ? 'command-failed'
              : now() >= deadline
                ? 'deadline'
                : 'assertion',
        command: commandResult,
        ...(purgeTree ? { purgeTree } : {}),
      };
      await checkpoint('failure', receipt);
      throw Object.assign(new Error('Preview recipient target proof failed.'), {
        diagnostic: receipt,
      });
    }
  }
  return {
    /** @param {string} name */
    stage(name) {
      stage = name;
    },
    artifact,
    artifactSha256,
    binding,
    expected,
    now,
    controllerProcessId,
    checkpoint,
    run,
    capturePurgeTree,
    text,
    app,
    appJson,
    parse,
    absent,
    digestFile,
    assertOwned,
    validateTarget,
    service,
    healthy,
    inspect,
    waiting,
    assertActivities,
    poll,
    history,
    output,
    phase,
  };
}

/**
 * Prepare unfinished durable work; caller must reap this controller before finish.
 * @param {TargetInput} input
 * @param {TargetPorts} ports
 */
export async function preparePreviewRecipientTarget(input, ports) {
  const c = context(input, ports);
  return await c.phase('prepare', async () => {
    c.stage('validate-target');
    await c.validateTarget();
    c.stage('verify-empty-target');
    await c.absent(APP_ROOT);
    await c.absent(UNIT_PATH);
    await c.absent(
      `${PREVIEW_RECIPIENT_TARGET.home}/.config/systemd/user/default.target.wants/${UNIT}`,
    );
    const absent = await c.service();
    assert.equal(absent.health, 'absent');
    assert.equal(absent.appId, APP_ID);
    assert.equal(absent.unit, UNIT);
    c.stage('ordinary-cli');
    const ordinary = object(
      JSON.parse((await c.app([PREVIEW_RECIPIENT_TARGET.inputPath])).stdout),
    );
    assertStableDecision(
      ordinary,
      PREVIEW_RECIPIENT_TARGET.inputPath,
      c.expected,
    );
    await c.absent(APP_ROOT);
    await c.checkpoint('owned', c.binding);
    c.stage('submit-workflow');
    const start = await c.appJson([
      'wharfie',
      'start',
      '--json',
      '--',
      PREVIEW_RECIPIENT_TARGET.inputPath,
    ]);
    assert.equal(start.kind, 'wharfie.execution-ledger.workflow-start');
    assert.equal(start.appId, APP_ID);
    assert.equal(start.revisionId, c.artifact.revisionId);
    assert.equal(start.workflowId, 'verify-stable');
    assert.equal(start.reused, false);
    assert.equal(start.runStatus, 'RUNNING');
    assertDomainSeparatedSha256Id(start.runId, 'wfr', 'workflow runId');
    c.stage('install-service');
    const install = await c.appJson(
      ['wharfie', 'service', 'install', '--json'],
      120_000,
    );
    assert.equal(install.action, 'install');
    assert.equal(install.requestStatus, 'fulfilled');
    assert.equal(install.outcome, 'target-active');
    assert.equal(install.activeArtifactId, c.artifact.artifactId);
    c.stage('observe-resident');
    const resident = await c.healthy(await c.service());
    c.stage('observe-waiting');
    const waiting = await c.poll(
      start.runId,
      (view) => view.workflowCursor.disposition === 'TIMER_WAITING',
    );
    c.waiting(waiting, 30_000);
    const history = await c.history(start.runId, 'RUNNING');
    return {
      schemaVersion: 1,
      kind: 'wharfie.preview-recipient.target-prepare',
      owned: c.binding,
      controllerProcessId: c.controllerProcessId,
      observedAt: c.now(),
      ordinary,
      start,
      install,
      resident,
      waiting,
      history,
      submittingProcessExited: true,
    };
  });
}

/**
 * Independently remove only application state claimed before this proof started.
 * @param {TargetInput & {owned:unknown}} input
 * @param {TargetPorts} ports
 */
export async function cleanupPreviewRecipientTarget(input, ports) {
  const c = context(input, ports);
  c.assertOwned(input.owned);
  return await c.phase('cleanup', async () => {
    c.stage('cleanup-validate-target');
    await c.validateTarget();
    c.stage('cleanup-uninstall');
    const uninstall = await c.appJson(
      ['wharfie', 'service', 'uninstall', '--json'],
      120_000,
    );
    assert.equal(uninstall.action, 'uninstall');
    assert.ok(
      ['uninstalled', 'already-uninstalled', 'orphan-reconciled'].includes(
        uninstall.outcome,
      ),
    );
    assert.equal(uninstall.health, 'absent');
    const status = await c.service();
    assert.equal(status.health, 'absent');
    assert.ok(['uninstalled', 'absent'].includes(status.installation?.state));
    c.stage('cleanup-systemd-absence');
    const properties = [
      'LoadState',
      'ActiveState',
      'SubState',
      'MainPID',
      'FragmentPath',
      'DropInPaths',
      'NeedDaemonReload',
    ];
    const raw = await c.text('/usr/bin/systemctl', [
      '--user',
      'show',
      UNIT,
      '--no-pager',
      ...properties.map((key) => `--property=${key}`),
    ]);
    const entries = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]);
    assert.equal(entries.length, properties.length);
    const systemd = Object.fromEntries(entries);
    assert.deepEqual(systemd, {
      LoadState: 'not-found',
      ActiveState: 'inactive',
      SubState: 'dead',
      MainPID: '0',
      FragmentPath: '',
      DropInPaths: '',
      NeedDaemonReload: 'no',
    });
    await c.absent(UNIT_PATH);
    await c.absent(
      `${PREVIEW_RECIPIENT_TARGET.home}/.config/systemd/user/default.target.wants/${UNIT}`,
    );
    c.stage('cleanup-prune');
    const prune =
      status.installation.state === 'absent'
        ? null
        : await c.appJson(['wharfie', 'service', 'prune', '--json']);
    if (prune) {
      assert.equal(prune.kind, 'wharfie.service.release-prune');
      assert.equal(prune.installationState, 'uninstalled');
      assert.deepEqual(prune.selected, {
        artifactId: c.artifact.artifactId,
        revisionId: c.artifact.revisionId,
      });
      assert.equal(prune.rollback, null);
      assert.equal(prune.retainedReleaseCount, 1);
      assert.equal(prune.removedCount, 0);
    }
    c.stage('cleanup-purge');
    const args = [
      'wharfie',
      'service',
      'purge',
      '--confirm-data-loss',
      APP_ID,
      '--json',
    ];
    let result = await c.app(args, { allowFailure: true, timeoutMs: 120_000 });
    let purgeAttempts = 1;
    if (result.status !== 0) {
      const failure = c.parse(result.stderr.trim() || result.stdout);
      assert.deepEqual(failure, {
        schemaVersion: 1,
        kind: 'wharfie.service.error',
        action: 'purge',
        code: 'systemd-user-service-purge-incomplete',
        message:
          'Systemd user-service purge was interrupted and is safe to retry.',
        remediation:
          'Retry service purge with the same --confirm-data-loss application ID.',
      });
      try {
        result = await c.app(args, { allowFailure: true, timeoutMs: 120_000 });
      } catch (error) {
        await c.capturePurgeTree();
        throw error;
      }
      purgeAttempts++;
      if (result.status !== 0) {
        await c.capturePurgeTree();
        assert.equal(result.status, 0, 'Recipient purge retry failed.');
      }
    }
    const purge = c.parse(result.stdout);
    assert.equal(purge.action, 'purge');
    assert.equal(purge.requestStatus, 'fulfilled');
    assert.ok(['purged', 'already-purged'].includes(purge.outcome));
    c.stage('cleanup-final-absence');
    await c.absent(APP_ROOT);
    await c.absent(PURGE_TOMBSTONE);
    await c.absent(UNIT_PATH);
    await c.absent(
      `${PREVIEW_RECIPIENT_TARGET.home}/.config/systemd/user/default.target.wants/${UNIT}`,
    );
    const finalSystemd = await c.text('/usr/bin/systemctl', [
      '--user',
      'show',
      UNIT,
      '--no-pager',
      ...properties.map((key) => `--property=${key}`),
    ]);
    assert.equal(finalSystemd, raw);
    await c.digestFile(PREVIEW_RECIPIENT_TARGET.executable, c.artifactSha256);
    return {
      schemaVersion: 1,
      kind: 'wharfie.preview-recipient.target-cleanup',
      owned: c.binding,
      uninstall,
      systemd,
      prune,
      purge,
      purgeAttempts,
      applicationRootAbsent: true,
      purgeTombstoneAbsent: true,
      externalArtifactPreserved: true,
    };
  });
}

/**
 * Reconnect from a fresh controller, finish the same run, then prove cleanup.
 * @param {TargetInput & {prepared:Record<string,any>}} input
 * @param {TargetPorts} ports
 */
export async function finishPreviewRecipientTarget(input, ports) {
  const c = context(input, ports);
  const prepared = object(input.prepared);
  assert.equal(prepared.kind, 'wharfie.preview-recipient.target-prepare');
  c.assertOwned(prepared.owned);
  assert.ok(
    Number.isSafeInteger(prepared.controllerProcessId) &&
      prepared.controllerProcessId > 0,
  );
  assert.notEqual(prepared.controllerProcessId, c.controllerProcessId);
  return await c.phase('complete', async () => {
    c.stage('reconnect-validate-target');
    await c.validateTarget();
    c.stage('reconnect-waiting');
    const runId = prepared.start.runId;
    const waiting = await c.inspect(runId);
    c.waiting(waiting, 1, prepared.waiting);
    c.stage('reconnect-resident');
    const resident = await c.healthy(await c.service());
    assert.deepEqual(resident, prepared.resident);
    await c.checkpoint('reconnected', {
      schemaVersion: 1,
      kind: 'wharfie.preview-recipient.target-reconnected',
      controllerProcessId: c.controllerProcessId,
      prepareControllerProcessId: prepared.controllerProcessId,
      observedAt: c.now(),
      waiting,
      resident,
    });
    c.stage('observe-completion');
    const completed = await c.poll(
      runId,
      (view) => view.workflowCursor.disposition === 'COMPLETED',
    );
    assert.equal(completed.run.status, 'COMPLETED');
    c.assertActivities(completed, ['capture', 'verify']);
    assert.equal(completed.timers.length, 1);
    assert.equal(completed.timers[0].status, 'FIRED');
    for (const key of ['timerId', 'stepId', 'scheduledAt', 'dueAt']) {
      assert.equal(completed.timers[0][key], waiting.timers[0][key]);
    }
    assert.deepEqual(
      completed.invocations.find(
        (/** @type {Record<string,any>} */ entry) =>
          entry.invocationId === waiting.invocations[0].invocationId,
      ),
      waiting.invocations[0],
    );
    assert.deepEqual(
      completed.attempts.find(
        (/** @type {Record<string,any>} */ entry) =>
          entry.attemptId === waiting.attempts[0].attemptId,
      ),
      waiting.attempts[0],
    );
    c.stage('read-completed-history');
    const history = await c.history(runId, 'COMPLETED');
    const output = await c.output(runId);
    c.stage('complete-cleanup');
    const cleanup = await cleanupPreviewRecipientTarget(
      { ...input, owned: prepared.owned },
      ports,
    );
    return {
      schemaVersion: 1,
      kind: 'wharfie.preview-recipient.target-complete',
      owned: c.binding,
      controllerProcessId: c.controllerProcessId,
      prepareControllerProcessId: prepared.controllerProcessId,
      sameRunCompleted: true,
      committedWorkPreserved: true,
      completed,
      history,
      output,
      cleanup,
    };
  });
}
