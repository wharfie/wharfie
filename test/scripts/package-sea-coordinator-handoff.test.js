/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  createPackageSeaCoordinatorHandoff,
  PACKAGE_SEA_COORDINATOR_COMMAND_TIMEOUT_MS,
} from '../../scripts/package-sea-coordinator-handoff.js';
import { runCommand } from '../../scripts/package-verification.js';
import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createCoordinatorAuthorityInspectionDocument,
  createCoordinatorAuthorityOperatorReleaseRequestId,
  validateCoordinatorAuthorityTakeoverReceipt,
} from '../../src/core/runtime/operator/coordinator-authority-command.js';

const APP_ID = 'package-sea-handoff';
const SESSION_ID = `wss_${'A'.repeat(43)}`;
const LABEL = 'isolated killed resident';
/** @type {string[]} */
const ownedRoots = [];

afterEach(() => {
  while (ownedRoots.length > 0) {
    const root = ownedRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function authoritySnapshot(overrides = {}) {
  const appId = overrides.appId ?? APP_ID;
  const coordinatorId = overrides.coordinatorId ?? SESSION_ID;
  const epoch = overrides.epoch ?? 1;
  const acquisitionRequestId =
    overrides.acquisitionRequestId ?? 'acquire-resident';
  const acquiredAt = overrides.acquiredAt ?? 10;
  const heartbeatAt = overrides.heartbeatAt ?? acquiredAt;
  const status = overrides.status ?? 'ACTIVE';
  const releasedAt = status === 'RELEASED' ? heartbeatAt + 10 : null;
  return {
    schemaVersion: 1,
    appId,
    coordinatorId,
    authorityId: createCanonicalJsonSha256Id({
      domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
      prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
      value: {
        schemaVersion: 1,
        appId,
        coordinatorId,
        epoch,
        requestId: acquisitionRequestId,
      },
    }),
    epoch,
    status,
    recordVersion: overrides.recordVersion ?? 1,
    acquisitionRequestId,
    acquiredAt,
    heartbeatAt,
    releasedAt,
    updatedAt: releasedAt ?? heartbeatAt,
    lastRequestId: overrides.lastRequestId ?? acquisitionRequestId,
  };
}

const PREDECESSOR = authoritySnapshot();
const INSPECTION = createCoordinatorAuthorityInspectionDocument(
  APP_ID,
  PREDECESSOR,
);

/** @param {string[]} args @param {string} flag @returns {string} */
function argument(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || args[index + 1] === undefined) {
    throw new Error(`Expected ${flag} in public command.`);
  }
  return args[index + 1];
}

/** @param {string[]} args @param {Record<string, any>} inspection @returns {Record<string, any>} */
function takeoverReceipt(args, inspection) {
  const coordinatorId = argument(args, '--coordinator-id');
  const requestId = argument(args, '--request-id');
  const observedAuthority = inspection.observedAuthority;
  const releaseRequestId = createCoordinatorAuthorityOperatorReleaseRequestId({
    appId: APP_ID,
    coordinatorId,
    requestId,
  });
  const takeoverAuthority = authoritySnapshot({
    coordinatorId,
    acquisitionRequestId: requestId,
    epoch: observedAuthority.epoch + 1,
    recordVersion: observedAuthority.recordVersion + 1,
    acquiredAt: observedAuthority.updatedAt + 10,
  });
  const releasedAt = takeoverAuthority.heartbeatAt + 10;
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.coordinator-authority.takeover',
    action: 'takeover-and-release',
    applied: true,
    scope: { appId: APP_ID },
    releaseRequestId,
    observedAuthority,
    takeoverAuthority,
    resultAuthority: {
      ...takeoverAuthority,
      status: 'RELEASED',
      recordVersion: takeoverAuthority.recordVersion + 1,
      releasedAt,
      updatedAt: releasedAt,
      lastRequestId: releaseRequestId,
    },
  };
  return validateCoordinatorAuthorityTakeoverReceipt(receipt, {
    appId: APP_ID,
    coordinatorId,
    requestId,
    inspection,
  });
}

/**
 * @param {{inspection?: Record<string, any>, first?: (receipt: Record<string, any>) => Record<string, any>, replay?: (receipt: Record<string, any>) => Record<string, any>, final?: (inspection: Record<string, any>) => Record<string, any>, failAt?: number, failure?: Error, invalidJsonAt?: number}} [options]
 */
function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-sea-coordinator-handoff-'));
  ownedRoots.push(root);
  const inspection = clone(options.inspection ?? INSPECTION);
  const common = {
    artifactPath: join(root, 'relocated-app'),
    appId: APP_ID,
    cwd: root,
    env: { WHARFIE_DATA_ROOT: join(root, 'state'), SEA_PROOF: 'sealed' },
    label: LABEL,
  };
  const input = {
    ...common,
    exit: { code: null, signal: 'SIGKILL' },
    ownership: { appId: APP_ID, sessionId: SESSION_ID },
  };
  /** @type {Array<{command: string, args: string[], options: {cwd?: string, env?: Record<string, string | undefined>, capture?: boolean, timeoutMs?: number, killSignal?: 'SIGKILL'}}>} */
  const calls = [];
  /** @type {Array<{path: string, bytes: string, inode: bigint, modifiedAt: bigint, changedAt: bigint, mode: number}>} */
  const files = [];
  /** @type {Record<string, any> | undefined} */
  let receipt;
  let takeoverCount = 0;
  const failure =
    options.failure ?? new Error('simulated public command failure');
  const handoff = createPackageSeaCoordinatorHandoff({
    runCommand(command, args, commandOptions = {}) {
      const index = calls.length;
      calls.push({ command, args: [...args], options: commandOptions });
      if (index === options.failAt) throw failure;
      if (index === options.invalidJsonAt) {
        return { stdout: 'not a JSON document', stderr: '' };
      }
      let document;
      if (args[2] === 'inspect') {
        document = receipt
          ? { ...inspection, observedAuthority: receipt.resultAuthority }
          : inspection;
        if (receipt && options.final) document = options.final(clone(document));
      } else if (args[2] === 'takeover') {
        const inspectionPath = argument(args, '--inspection-file');
        const stats = statSync(inspectionPath, { bigint: true });
        files.push({
          path: inspectionPath,
          bytes: readFileSync(inspectionPath, 'utf8'),
          inode: stats.ino,
          modifiedAt: stats.mtimeNs,
          changedAt: stats.ctimeNs,
          mode: Number(stats.mode & 0o777n),
        });
        takeoverCount += 1;
        if (takeoverCount === 1) {
          const accepted = takeoverReceipt(args, inspection);
          receipt = options.first ? options.first(clone(accepted)) : accepted;
          document = receipt;
        } else {
          if (!receipt)
            throw new Error('Takeover replay preceded its receipt.');
          document = { ...receipt, applied: false };
          if (options.replay) document = options.replay(clone(document));
        }
      } else {
        throw new Error(`Unexpected public command: ${args.join(' ')}`);
      }
      return { stdout: `\n${JSON.stringify(document)}\n`, stderr: '' };
    },
  });
  return { root, common, input, inspection, calls, files, handoff, failure };
}

/** @param {() => unknown} action @returns {unknown} */
function captureFailure(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail.');
}

describe('package SEA coordinator handoff', () => {
  it('uses one exact inspection file and stable confirmed request for takeover and replay', () => {
    const value = fixture();
    const result = value.handoff.afterSigkill(value.input);
    const takeoverArgs = value.calls[1].args;
    const inspectionPath = argument(takeoverArgs, '--inspection-file');
    const coordinatorId = argument(takeoverArgs, '--coordinator-id');
    const requestId = argument(takeoverArgs, '--request-id');

    expect(value.calls.map(({ args }) => args)).toEqual([
      ['wharfie', 'coordinator', 'inspect', '--json'],
      [
        'wharfie',
        'coordinator',
        'takeover',
        '--inspection-file',
        inspectionPath,
        '--coordinator-id',
        coordinatorId,
        '--request-id',
        requestId,
        '--confirm-authority-replacement',
        '--json',
      ],
      takeoverArgs,
      ['wharfie', 'coordinator', 'inspect', '--json'],
    ]);
    for (const call of value.calls) {
      expect(call.command).toBe(value.common.artifactPath);
      expect(call.options).toEqual({
        cwd: value.common.cwd,
        env: value.common.env,
        capture: true,
        timeoutMs: PACKAGE_SEA_COORDINATOR_COMMAND_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      expect(call.options.env).toBe(value.common.env);
      expect(call.args).not.toContain('--app-id');
    }
    expect(coordinatorId).not.toBe(SESSION_ID);
    expect(requestId).not.toBe(PREDECESSOR.acquisitionRequestId);
    expect(requestId).not.toBe(coordinatorId);
    expect(value.files).toHaveLength(2);
    expect(value.files[1]).toEqual(value.files[0]);
    expect(value.files[0]).toMatchObject({
      path: inspectionPath,
      bytes: `${JSON.stringify(value.inspection)}\n`,
      mode: 0o600,
    });
    expect(readdirSync(value.root)).toEqual([basename(inspectionPath)]);
    expect(result).toEqual(takeoverReceipt(takeoverArgs, value.inspection));
    expect(result.resultAuthority.status).toBe('RELEASED');
    expect(result).not.toHaveProperty('currentAuthority');
  });

  it('generates fresh intent and inspection identities for separate confirmed handoffs', () => {
    const first = fixture();
    const second = fixture();
    first.handoff.afterSigkill(first.input);
    second.handoff.afterSigkill(second.input);
    for (const flag of [
      '--inspection-file',
      '--coordinator-id',
      '--request-id',
    ]) {
      expect(argument(first.calls[1].args, flag)).not.toBe(
        argument(second.calls[1].args, flag),
      );
    }
  });

  const stopped = { MainPID: '0', ActiveState: 'inactive', SubState: 'dead' };
  const systemdLoss = /** @type {const} */ ({
    kind: 'systemd-sigkill',
    processId: 412,
    ExecMainPID: '412',
    ExecMainCode: '2',
    ExecMainStatus: '9',
  });
  const rebootLoss = /** @type {const} */ ({
    kind: 'vm-power-cycle',
    previousBootId: 'ed4b3684-f598-4a84-a9ad-78d899e79966',
    bootId: 'b163b029-c027-4cb2-83f6-b9d23db7c042',
  });

  it.each([systemdLoss, rebootLoss])(
    'explicitly recovers a stopped service after $kind without inventing a child exit',
    (loss) => {
      const value = fixture();
      const receipt = value.handoff.afterStoppedServiceLoss({
        ...value.common,
        stopped,
        loss,
        expectedAuthority: PREDECESSOR,
      });
      expect(receipt.observedAuthority).toEqual(PREDECESSOR);
      expect(receipt.resultAuthority.status).toBe('RELEASED');
      expect(value.calls.map(({ args }) => args[2])).toEqual([
        'inspect',
        'takeover',
        'takeover',
        'inspect',
      ]);
      expect(value.calls[2].args).toEqual(value.calls[1].args);
      expect(value.files[1]).toEqual(value.files[0]);
    },
  );

  it.each([
    { stopped: { ...stopped, MainPID: '412' } },
    { stopped: { ...stopped, ActiveState: 'activating' } },
    { stopped: { ...stopped, SubState: 'auto-restart' } },
    { loss: { ...systemdLoss, processId: 0 } },
    { loss: { ...systemdLoss, ExecMainPID: '413' } },
    { loss: { ...systemdLoss, ExecMainCode: '1' } },
    { loss: { ...systemdLoss, ExecMainStatus: '15' } },
    { loss: { ...rebootLoss, bootId: rebootLoss.previousBootId } },
    { loss: { ...rebootLoss, previousBootId: 'not-a-boot-id' } },
    { loss: { ...rebootLoss, kind: 'stale-heartbeat' } },
    { expectedAuthority: { ...PREDECESSOR, status: 'RELEASED' } },
    { expectedAuthority: { ...PREDECESSOR, appId: 'another-app' } },
  ])(
    'refuses unproven stopped-service loss %j before commands',
    (overrides) => {
      const value = fixture();
      expect(() =>
        value.handoff.afterStoppedServiceLoss(
          /** @type {any} */ ({
            ...value.common,
            stopped,
            loss: systemdLoss,
            expectedAuthority: PREDECESSOR,
            ...overrides,
          }),
        ),
      ).toThrow();
      expect(value.calls).toEqual([]);
      expect(readdirSync(value.root)).toEqual([]);
    },
  );

  it('does not silently rebase a stopped-service takeover onto changed authority', () => {
    const value = fixture();
    expect(() =>
      value.handoff.afterStoppedServiceLoss({
        ...value.common,
        stopped,
        loss: rebootLoss,
        expectedAuthority: { ...PREDECESSOR, recordVersion: 2 },
      }),
    ).toThrow(/exact retained predecessor/);
    expect(value.calls).toHaveLength(1);
    expect(readdirSync(value.root)).toEqual([]);
  });

  it.each([
    undefined,
    { code: 0, signal: null },
    { code: 1, signal: null },
    { code: null, signal: 'SIGTERM' },
    { code: 0, signal: 'SIGKILL' },
    { code: null, signal: 'SIGKILL', inferred: true },
  ])(
    'rejects unconfirmed exit %j before invoking any public command',
    (exit) => {
      const value = fixture();
      expect(() =>
        value.handoff.afterSigkill(
          /** @type {any} */ ({ ...value.input, exit }),
        ),
      ).toThrow(/confirmed SIGKILL/);
      expect(value.calls).toEqual([]);
      expect(readdirSync(value.root)).toEqual([]);
    },
  );

  it.each([
    { appId: 'another-app', sessionId: SESSION_ID },
    { appId: APP_ID, sessionId: '' },
    undefined,
  ])(
    'rejects invalid killed ownership %j before invoking commands',
    (ownership) => {
      const value = fixture();
      expect(() =>
        value.handoff.afterSigkill(
          /** @type {any} */ ({ ...value.input, ownership }),
        ),
      ).toThrow();
      expect(value.calls).toEqual([]);
    },
  );

  it.each([
    { name: 'absent', authority: null },
    { name: 'active', authority: PREDECESSOR },
    { name: 'released', authority: authoritySnapshot({ status: 'RELEASED' }) },
  ])(
    'inspects $name authority without any implicit takeover',
    ({ authority }) => {
      const inspection = createCoordinatorAuthorityInspectionDocument(
        APP_ID,
        authority,
      );
      const value = fixture({ inspection });
      expect(value.handoff.inspect(value.common)).toEqual(inspection);
      expect(value.calls.map(({ args }) => args)).toEqual([
        ['wharfie', 'coordinator', 'inspect', '--json'],
      ]);
      expect(readdirSync(value.root)).toEqual([]);
    },
  );

  it.each([
    { name: 'absent', authority: null, released: false },
    { name: 'active', authority: PREDECESSOR, released: false },
    {
      name: 'released',
      authority: authoritySnapshot({ status: 'RELEASED' }),
      released: true,
    },
  ])(
    'assertReleased treats $name authority as read-only evidence',
    ({ authority, released }) => {
      const value = fixture({
        inspection: createCoordinatorAuthorityInspectionDocument(
          APP_ID,
          authority,
        ),
      });
      if (released)
        expect(value.handoff.assertReleased(value.common)).toEqual(authority);
      else
        expect(() => value.handoff.assertReleased(value.common)).toThrow(
          /did not release coordinator authority/,
        );
      expect(value.calls.map(({ args }) => args)).toEqual([
        ['wharfie', 'coordinator', 'inspect', '--json'],
      ]);
      expect(readdirSync(value.root)).toEqual([]);
    },
  );

  it.each([null, authoritySnapshot({ status: 'RELEASED' })])(
    'refuses a killed handoff without an ACTIVE predecessor',
    (authority) => {
      const value = fixture({
        inspection: createCoordinatorAuthorityInspectionDocument(
          APP_ID,
          authority,
        ),
      });
      expect(() => value.handoff.afterSigkill(value.input)).toThrow(
        /killed coordinator's ACTIVE authority/,
      );
      expect(value.calls).toHaveLength(1);
      expect(readdirSync(value.root)).toEqual([]);
    },
  );

  it.each([
    {
      name: 'application scope',
      inspection: { ...INSPECTION, scope: { appId: 'another-app' } },
    },
    {
      name: 'snapshot application',
      inspection: {
        ...INSPECTION,
        observedAuthority: authoritySnapshot({ appId: 'another-app' }),
      },
    },
    {
      name: 'killed session',
      inspection: {
        ...INSPECTION,
        observedAuthority: authoritySnapshot({
          coordinatorId: 'another-session',
        }),
      },
    },
    {
      name: 'expanded inspection envelope',
      inspection: { ...INSPECTION, extra: true },
    },
  ])(
    'rejects mismatched $name without attempting takeover',
    ({ inspection }) => {
      const value = fixture({ inspection });
      expect(() => value.handoff.afterSigkill(value.input)).toThrow();
      expect(value.calls).toHaveLength(1);
      expect(readdirSync(value.root)).toEqual([]);
    },
  );

  it.each([
    {
      name: 'already replayed first result',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        applied: false,
      }),
    },
    {
      name: 'changed predecessor',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        observedAuthority: {
          ...receipt.observedAuthority,
          lastRequestId: 'changed-predecessor',
        },
      }),
    },
    {
      name: 'wrong successor epoch',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        takeoverAuthority: {
          ...receipt.takeoverAuthority,
          epoch: receipt.takeoverAuthority.epoch + 1,
        },
      }),
    },
    {
      name: 'ACTIVE result',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        resultAuthority: { ...receipt.resultAuthority, status: 'ACTIVE' },
      }),
    },
    {
      name: 'currentAuthority alias',
      mutate: (/** @type {Record<string, any>} */ receipt) => {
        const { resultAuthority, ...rest } = receipt;
        return { ...rest, currentAuthority: resultAuthority };
      },
    },
  ])(
    'rejects a stale or changed $name receipt without rebasing',
    ({ mutate }) => {
      const value = fixture({ first: mutate });
      expect(() => value.handoff.afterSigkill(value.input)).toThrow();
      expect(value.calls).toHaveLength(2);
      expect(value.files).toHaveLength(1);
    },
  );

  it.each([
    {
      name: 'applied flag',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        applied: true,
      }),
    },
    {
      name: 'release request',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        releaseRequestId: 'changed-release-request',
      }),
    },
    {
      name: 'result snapshot',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        resultAuthority: {
          ...receipt.resultAuthority,
          updatedAt: receipt.resultAuthority.updatedAt + 1,
        },
      }),
    },
    {
      name: 'extra field',
      mutate: (/** @type {Record<string, any>} */ receipt) => ({
        ...receipt,
        extra: true,
      }),
    },
  ])(
    'rejects replay drift in $name without re-inspection or a new intent',
    ({ mutate }) => {
      const value = fixture({ replay: mutate });
      expect(() => value.handoff.afterSigkill(value.input)).toThrow(
        /changed its exact takeover-and-release replay/,
      );
      expect(value.calls).toHaveLength(3);
      expect(value.calls[2].args).toEqual(value.calls[1].args);
      expect(value.files[1]).toEqual(value.files[0]);
    },
  );

  it.each([
    {
      name: 'absent authority',
      mutate: (/** @type {Record<string, any>} */ inspection) => ({
        ...inspection,
        observedAuthority: null,
      }),
    },
    {
      name: 'ACTIVE authority',
      mutate: (/** @type {Record<string, any>} */ inspection) => ({
        ...inspection,
        observedAuthority: {
          ...inspection.observedAuthority,
          status: 'ACTIVE',
        },
      }),
    },
    {
      name: 'another RELEASED result',
      mutate: (/** @type {Record<string, any>} */ inspection) => ({
        ...inspection,
        observedAuthority: {
          ...inspection.observedAuthority,
          lastRequestId: 'another-release',
        },
      }),
    },
  ])(
    'rejects final inspection with $name instead of the exact released result',
    ({ mutate }) => {
      const value = fixture({ final: mutate });
      expect(() => value.handoff.afterSigkill(value.input)).toThrow(
        /did not retain the exact released successor authority/,
      );
      expect(value.calls).toHaveLength(4);
    },
  );

  it.each([0, 1, 2, 3])(
    'preserves command failure at step %i as the cause and never retries',
    (failAt) => {
      const failure = new Error(`command failure ${failAt}`);
      const value = fixture({ failAt, failure });
      const error = captureFailure(() =>
        value.handoff.afterSigkill(value.input),
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('cause', failure);
      expect(error).toHaveProperty(
        'message',
        `${LABEL} coordinator command failed: ${failure.message}`,
      );
      expect(value.calls).toHaveLength(failAt + 1);
    },
  );

  it('propagates malformed command JSON with context and its parse failure', () => {
    const value = fixture({ invalidJsonAt: 0 });
    const error = captureFailure(() => value.handoff.inspect(value.common));
    expect(error).toHaveProperty(
      'message',
      expect.stringContaining(`${LABEL} coordinator command failed:`),
    );
    expect(error).toHaveProperty('cause', expect.any(SyntaxError));
    expect(value.calls).toHaveLength(1);
  });

  it.each([
    { timeoutMs: 0, killSignal: 'SIGKILL' },
    { timeoutMs: -1, killSignal: 'SIGKILL' },
    { timeoutMs: 1.5, killSignal: 'SIGKILL' },
    { timeoutMs: Number.NaN, killSignal: 'SIGKILL' },
    { timeoutMs: 2_147_483_648, killSignal: 'SIGKILL' },
    { timeoutMs: 1 },
    { killSignal: 'SIGKILL' },
    { timeoutMs: 1, killSignal: 'SIGTERM' },
  ])('rejects unsafe shared command bounds %j before spawning', (options) => {
    expect(() =>
      runCommand('must-not-execute', [], /** @type {any} */ (options)),
    ).toThrow(TypeError);
  });

  const posixIt = process.platform === 'win32' ? it.skip : it;
  posixIt(
    'hard-kills and reaps a hung artifact that traps SIGTERM within the deadline budget',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-command-timeout-'));
      ownedRoots.push(root);
      const pidPath = join(root, 'child.pid');
      const artifactEntryPath = join(root, 'wharfie');
      writeFileSync(
        artifactEntryPath,
        [
          "'use strict';",
          "const { writeFileSync } = require('node:fs');",
          "process.on('SIGTERM', () => {});",
          `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
          'setInterval(() => {}, 1_000);',
        ].join('\n'),
      );

      const startedAt = Date.now();
      const failure = captureFailure(() =>
        runCommand(
          process.execPath,
          ['wharfie', 'coordinator', 'inspect', '--json'],
          {
            cwd: root,
            env: process.env,
            capture: true,
            timeoutMs: 500,
            killSignal: 'SIGKILL',
          },
        ),
      );
      const elapsedMs = Date.now() - startedAt;

      expect(failure).toHaveProperty('code', 'ETIMEDOUT');
      expect(elapsedMs).toBeGreaterThanOrEqual(400);
      expect(elapsedMs).toBeLessThan(3_000);
      expect(existsSync(pidPath)).toBe(true);
      const childPid = Number(readFileSync(pidPath, 'utf8'));
      expect(Number.isSafeInteger(childPid)).toBe(true);
      expect(childPid).toBeGreaterThan(0);
      expect(captureFailure(() => process.kill(childPid, 0))).toHaveProperty(
        'code',
        'ESRCH',
      );
    },
  );
});
