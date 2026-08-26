import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { runCommand } from './package-verification.js';

export const PACKAGE_SEA_COORDINATOR_COMMAND_TIMEOUT_MS = 30_000;

/**
 * @typedef SeaCoordinatorCommandInput
 * @property {string} artifactPath - Relocated SEA executable.
 * @property {string} appId - Exact application scope.
 * @property {string} cwd - Isolated proof directory.
 * @property {Record<string, string>} env - Sealed packaged environment.
 * @property {string} label - Failure context.
 */

/**
 * @typedef StoppedServiceLossInput
 * @property {Record<string, any>} expectedAuthority - Exact ACTIVE predecessor captured before loss.
 * @property {{MainPID: string, ActiveState: string, SubState: string}} stopped - Independent manager readback after explicitly stopping retries.
 * @property {{kind: 'systemd-sigkill', processId: number, ExecMainPID: string, ExecMainCode: string, ExecMainStatus: string} | {kind: 'vm-power-cycle', previousBootId: string, bootId: string}} loss - Direct process-death or changed-kernel evidence, never heartbeat age.
 */

/**
 * Use only public packaged commands to inspect authority and explicitly fence
 * one predecessor that this verifier has already killed. Stale ownership,
 * socket absence, and heartbeat age never authorize a handoff on their own.
 * @param {{runCommand?: typeof runCommand}} [ports] - Injectable command port for isolated tests.
 * @returns {{inspect: (input: SeaCoordinatorCommandInput) => Record<string, any>, assertReleased: (input: SeaCoordinatorCommandInput) => Record<string, any>, afterSigkill: (input: SeaCoordinatorCommandInput & {exit: {code: number | null, signal: string | null}, ownership: Record<string, any>}) => Record<string, any>, afterStoppedServiceLoss: (input: SeaCoordinatorCommandInput & StoppedServiceLossInput) => Record<string, any>}} - Public-command verifier operations.
 */
export function createPackageSeaCoordinatorHandoff(ports = {}) {
  const execute = ports.runCommand || runCommand;

  /**
   * @param {SeaCoordinatorCommandInput} input - Packaged command context.
   * @param {string[]} args - Public coordinator arguments.
   * @returns {Record<string, any>} - Complete JSON command document.
   */
  const command = (input, args) => {
    try {
      return JSON.parse(
        execute(input.artifactPath, ['wharfie', 'coordinator', ...args], {
          cwd: input.cwd,
          env: input.env,
          capture: true,
          timeoutMs: PACKAGE_SEA_COORDINATOR_COMMAND_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        }).stdout.trim(),
      );
    } catch (error) {
      throw new Error(
        `${input.label} coordinator command failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };

  /**
   * @param {SeaCoordinatorCommandInput} input - Exact packaged app context.
   * @returns {Record<string, any>} - Verified read-only inspection document.
   */
  const inspect = (input) => {
    const inspection = command(input, ['inspect', '--json']);
    assert.deepEqual(
      inspection,
      {
        schemaVersion: 1,
        kind: 'wharfie.coordinator-authority.inspection',
        authority: 'none',
        authoritative: false,
        integrity: { verified: true },
        scope: { appId: input.appId },
        observedAuthority: inspection.observedAuthority,
      },
      `${input.label} returned an invalid coordinator inspection`,
    );
    const authority = inspection.observedAuthority;
    if (authority !== null) {
      assert.ok(authority, `${input.label} omitted coordinator authority`);
      assert.equal(authority.schemaVersion, 1);
      assert.equal(authority.appId, input.appId);
      assert.ok(Number.isSafeInteger(authority.epoch) && authority.epoch > 0);
      assert.ok(
        Number.isSafeInteger(authority.recordVersion) &&
          authority.recordVersion > 0,
      );
      assert.ok(['ACTIVE', 'RELEASED'].includes(authority.status));
      assert.equal(typeof authority.coordinatorId, 'string');
      assert.ok(authority.coordinatorId.length > 0);
    }
    return inspection;
  };

  /**
   * @param {SeaCoordinatorCommandInput} input - Owner-free response boundary.
   * @returns {Record<string, any>} - Exact released snapshot, without takeover.
   */
  const assertReleased = (input) => {
    const { observedAuthority } = inspect(input);
    assert.equal(
      observedAuthority?.status,
      'RELEASED',
      `${input.label} did not release coordinator authority before its response`,
    );
    return observedAuthority;
  };

  /**
   * @param {SeaCoordinatorCommandInput & {exit: {code: number | null, signal: string | null}, ownership: Record<string, any>}} input - Confirmed killed predecessor and exact retained local owner.
   * @returns {Record<string, any>} - Stable, exactly replayed takeover-and-release receipt.
   */
  const afterSigkill = (input) => {
    assert.deepEqual(
      input.exit,
      { code: null, signal: 'SIGKILL' },
      `${input.label} cannot replace a coordinator without a confirmed SIGKILL`,
    );
    assert.equal(input.ownership?.appId, input.appId);
    assert.equal(typeof input.ownership?.sessionId, 'string');
    assert.ok(input.ownership.sessionId.length > 0);
    const inspection = inspect(input);
    const predecessor = inspection.observedAuthority;
    assert.equal(
      predecessor?.status,
      'ACTIVE',
      `${input.label} did not retain its killed coordinator's ACTIVE authority`,
    );
    assert.equal(
      predecessor.coordinatorId,
      input.ownership.sessionId,
      `${input.label} observed authority belonging to a different coordinator`,
    );
    return takeoverAndRelease(input, inspection);
  };

  /**
   * Recover a disposable proof service only after independently witnessing its
   * loss and stopping the supervisor. This does not reinterpret a VM reboot as
   * a child-process exit, or authorize a takeover from stale status alone.
   * @param {SeaCoordinatorCommandInput & StoppedServiceLossInput} input - Explicitly stopped proof service and exact predecessor.
   * @returns {Record<string, any>} - Exactly replayed takeover-and-release receipt.
   */
  const afterStoppedServiceLoss = (input) => {
    assert.equal(input.stopped.MainPID, '0');
    assert.equal(input.stopped.ActiveState, 'inactive');
    assert.equal(input.stopped.SubState, 'dead');
    assert.equal(input.expectedAuthority.appId, input.appId);
    assert.equal(input.expectedAuthority.status, 'ACTIVE');
    if (input.loss.kind === 'systemd-sigkill') {
      assert.ok(
        Number.isSafeInteger(input.loss.processId) && input.loss.processId > 0,
      );
      assert.equal(input.loss.ExecMainPID, String(input.loss.processId));
      assert.equal(input.loss.ExecMainCode, '2');
      assert.equal(input.loss.ExecMainStatus, '9');
    } else {
      assert.equal(input.loss.kind, 'vm-power-cycle');
      const bootIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
      assert.match(input.loss.previousBootId, bootIdPattern);
      assert.match(input.loss.bootId, bootIdPattern);
      assert.notEqual(input.loss.bootId, input.loss.previousBootId);
    }
    const inspection = inspect(input);
    assert.deepEqual(
      inspection.observedAuthority,
      input.expectedAuthority,
      `${input.label} no longer names the exact retained predecessor`,
    );
    return takeoverAndRelease(input, inspection);
  };

  /**
   * @param {SeaCoordinatorCommandInput} input - Confirmed recovery context.
   * @param {Record<string, any>} inspection - Exact already-validated inspection.
   * @returns {Record<string, any>} - Exactly replayed takeover-and-release receipt.
   */
  function takeoverAndRelease(input, inspection) {
    const predecessor = inspection.observedAuthority;
    // Keep one exact inspection and one stable intent for both invocations.
    // A conflict fails the proof; it must never re-inspect and silently rebase.
    const nonce = randomUUID();
    const coordinatorId = `sea-handoff-${nonce}`;
    const requestId = `sea-handoff-request-${nonce}`;
    const inspectionPath = path.join(
      input.cwd,
      `coordinator-inspection-${nonce}.json`,
    );
    writeFileSync(inspectionPath, `${JSON.stringify(inspection)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    const args = [
      'takeover',
      '--inspection-file',
      inspectionPath,
      '--coordinator-id',
      coordinatorId,
      '--request-id',
      requestId,
      '--confirm-authority-replacement',
      '--json',
    ];
    const receipt = command(input, args);
    assert.deepEqual(receipt, {
      schemaVersion: 1,
      kind: 'wharfie.coordinator-authority.takeover',
      action: 'takeover-and-release',
      applied: true,
      scope: { appId: input.appId },
      releaseRequestId: receipt.releaseRequestId,
      observedAuthority: predecessor,
      takeoverAuthority: receipt.takeoverAuthority,
      resultAuthority: receipt.resultAuthority,
    });
    assert.equal(typeof receipt.releaseRequestId, 'string');
    assert.ok(receipt.releaseRequestId.length > 0);
    const successor = receipt.takeoverAuthority;
    assert.equal(successor.schemaVersion, predecessor.schemaVersion);
    assert.equal(successor.appId, input.appId);
    assert.equal(successor.coordinatorId, coordinatorId);
    assert.equal(successor.status, 'ACTIVE');
    assert.equal(successor.epoch, predecessor.epoch + 1);
    assert.equal(successor.recordVersion, predecessor.recordVersion + 1);
    assert.equal(successor.acquisitionRequestId, requestId);
    assert.equal(successor.lastRequestId, requestId);
    assert.equal(successor.releasedAt, null);
    assert.notEqual(successor.authorityId, predecessor.authorityId);
    const released = receipt.resultAuthority;
    assert.ok(Number.isSafeInteger(released.releasedAt));
    assert.ok(released.releasedAt >= successor.heartbeatAt);
    assert.equal(released.updatedAt, released.releasedAt);
    assert.deepEqual(released, {
      ...successor,
      status: 'RELEASED',
      recordVersion: successor.recordVersion + 1,
      releasedAt: released.releasedAt,
      updatedAt: released.updatedAt,
      lastRequestId: receipt.releaseRequestId,
    });
    assert.deepEqual(
      command(input, args),
      { ...receipt, applied: false },
      `${input.label} changed its exact takeover-and-release replay`,
    );
    assert.deepEqual(
      inspect(input),
      { ...inspection, observedAuthority: released },
      `${input.label} did not retain the exact released successor authority`,
    );
    return receipt;
  }

  return Object.freeze({
    inspect,
    assertReleased,
    afterSigkill,
    afterStoppedServiceLoss,
  });
}
