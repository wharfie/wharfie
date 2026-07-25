import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createSha256Id } from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION,
  getAwsSingleNodeHostArtifactProjectionLayout,
  validateAwsSingleNodeHostArtifactProjectionEvidence,
} from '../../src/core/runtime/deployment-aws-host-artifact-projection.js';
import {
  AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_SCHEMA_VERSION,
  createAwsSingleNodeHostServiceConvergenceAdapter,
  validateAwsSingleNodeHostServiceConvergenceEvidence,
} from '../../src/core/runtime/deployment-aws-host-service-convergence.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  semanticId,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @type {Readonly<AnyRecord>} */
let request;
/** @type {string} */
let root;

beforeAll(() => {
  const fixture = makeFixture();
  request = createAwsSingleNodeHostActivationRequest(fixture.requestContext);
  root = path.join(
    tmpdir(),
    'wharfie-host-service-convergence-test',
    request.requestId,
  );
});

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Readonly<AnyRecord>} exactRequest @returns {Readonly<AnyRecord>} */
function makeArtifactContext(exactRequest) {
  return deepFreeze({
    request: exactRequest,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        exactRequest,
        'artifact-projection',
      ),
      kind: 'artifact-projection',
      attemptGeneration: 1,
    },
    priorEvidence: {
      'runtime-identity': { proof: 'runtime' },
      'application-storage': { proof: 'application-storage' },
      'control-storage': { proof: 'control-storage' },
    },
  });
}

/** @param {Readonly<AnyRecord>} exactRequest @returns {Readonly<AnyRecord>} */
function makeArtifactEvidence(exactRequest) {
  const layout = getAwsSingleNodeHostArtifactProjectionLayout(
    exactRequest,
    root,
  );
  return validateAwsSingleNodeHostArtifactProjectionEvidence(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND,
      requestId: exactRequest.requestId,
      deploymentInstanceId: exactRequest.deploymentInstanceId,
      appId: exactRequest.appId,
      artifactId: exactRequest.artifactId,
      revisionId: exactRequest.revisionId,
      targetId: exactRequest.targetId,
      contentLength: exactRequest.artifact.contentLength,
      byteDigest: exactRequest.artifact.byteDigest,
      artifactPath: layout.artifactPath,
    },
    makeArtifactContext(exactRequest),
    root,
  );
}

/**
 * @param {Readonly<AnyRecord>} exactRequest
 * @param {number} [attemptGeneration]
 * @param {AnyRecord} [overrides]
 * @returns {Readonly<AnyRecord>}
 */
function makeContext(exactRequest, attemptGeneration = 1, overrides = {}) {
  return deepFreeze({
    request: exactRequest,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        exactRequest,
        'service-convergence',
      ),
      kind: 'service-convergence',
      attemptGeneration,
    },
    priorEvidence: {
      'runtime-identity': { proof: 'runtime' },
      'application-storage': { proof: 'application-storage' },
      'control-storage': { proof: 'control-storage' },
      'artifact-projection': makeArtifactEvidence(exactRequest),
    },
    ...overrides,
  });
}

/** @param {Readonly<AnyRecord>} exactRequest @returns {{artifactId: string, revisionId: string}} */
function release(exactRequest) {
  return {
    artifactId: exactRequest.artifactId,
    revisionId: exactRequest.revisionId,
  };
}

/** @returns {{artifactId: string, revisionId: string}} */
function otherRelease() {
  return {
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'other exact service release bytes',
    }),
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:host-service-convergence-revision:v1',
      { revision: 2 },
    ),
  };
}

/** @param {Readonly<AnyRecord>} exactRequest @param {AnyRecord} [overrides] @returns {AnyRecord} */
function systemd(exactRequest, overrides = {}) {
  return {
    loadState: 'loaded',
    unitFileState: 'enabled',
    activeState: 'active',
    subState: 'running',
    result: 'success',
    mainPid: 731,
    execMainStatus: 0,
    fragmentPath: path.join(
      '/var/lib/wharfie-runtime',
      '.config',
      'systemd',
      'user',
      `wharfie-${exactRequest.appId}.service`,
    ),
    dropInPaths: '',
    needDaemonReload: false,
    ...overrides,
  };
}

/** @returns {AnyRecord} */
function wiring() {
  return {
    state: 'managed',
    unitFile: 'managed',
    selection: 'managed',
    effectiveUnit: 'managed',
    cleanupPending: false,
  };
}

/**
 * @param {Readonly<AnyRecord>} exactRequest
 * @param {'physical-absence'|'durable-install'|'durable-change'|'durable-active'} basis
 * @param {AnyRecord} [overrides]
 * @returns {AnyRecord}
 */
function desiredConvergence(
  exactRequest,
  basis = 'durable-active',
  overrides = {},
) {
  return {
    schemaVersion: 1,
    kind: 'wharfie.service.desired-convergence',
    appId: exactRequest.appId,
    unit: `wharfie-${exactRequest.appId}.service`,
    desired: release(exactRequest),
    disposition: 'authorized',
    basis,
    ...overrides,
  };
}

/**
 * @param {Readonly<AnyRecord>} exactRequest
 * @param {{artifactId: string, revisionId: string}} [current]
 * @returns {AnyRecord}
 */
function healthyStatus(exactRequest, current = release(exactRequest)) {
  return {
    schemaVersion: 3,
    kind: 'wharfie.service.status',
    appId: exactRequest.appId,
    unit: `wharfie-${exactRequest.appId}.service`,
    installation: {
      state: 'installed',
      activeArtifactId: current.artifactId,
      activeRevisionId: current.revisionId,
      previousArtifactId: null,
      previousRevisionId: null,
    },
    systemd: systemd(exactRequest),
    runtime: {
      status: 'READY',
      artifactId: current.artifactId,
      revisionId: current.revisionId,
      generation: 9,
      ownerKind: 'resident',
      ownerGeneration: 4,
      session: 'active',
      processId: 731,
      currentOwner: true,
    },
    integrity: {
      status: 'verified',
      artifactId: current.artifactId,
      revisionId: current.revisionId,
    },
    wiring: wiring(),
    persistence: {
      linger: true,
      unitEnabled: true,
      bootEnabled: true,
    },
    health: 'healthy',
    activation: {
      phase: 'ACTIVE',
      action: null,
      desired: current,
      selected: current,
      rollback: null,
      lastOutcome: 'target-active',
    },
    desiredConvergence: desiredConvergence(exactRequest),
  };
}

/** @param {Readonly<AnyRecord>} exactRequest @returns {AnyRecord} */
function absentStatus(exactRequest) {
  return {
    schemaVersion: 3,
    kind: 'wharfie.service.status',
    appId: exactRequest.appId,
    unit: `wharfie-${exactRequest.appId}.service`,
    installation: { state: 'absent' },
    systemd: {
      loadState: 'not-found',
      unitFileState: '',
      activeState: 'inactive',
      subState: 'dead',
      result: 'success',
      mainPid: 0,
      execMainStatus: 0,
      fragmentPath: '',
      dropInPaths: '',
      needDaemonReload: false,
    },
    runtime: null,
    wiring: {
      state: 'absent',
      unitFile: 'absent',
      selection: 'absent',
      effectiveUnit: 'absent',
      cleanupPending: false,
    },
    health: 'absent',
    activation: null,
    desiredConvergence: desiredConvergence(exactRequest, 'physical-absence'),
  };
}

/**
 * @param {unknown} status
 * @param {AnyRecord} [overrides]
 * @returns {{adapter: Readonly<AnyRecord>, command: AnyRecord, inspectExactService: jest.Mock, convergeExactService: jest.Mock}}
 */
function makeAdapter(status, overrides = {}) {
  const inspectExactService = jest.fn(
    /** @this {AnyRecord} */
    async function inspect() {
      expect(this).toBe(command);
      return status;
    },
  );
  const convergeExactService = jest.fn(
    /** @this {AnyRecord} */
    async function converge() {
      expect(this).toBe(command);
      return { forged: 'ignored command result' };
    },
  );
  const command = { inspectExactService, convergeExactService };
  const adapter = createAwsSingleNodeHostServiceConvergenceAdapter({
    command,
    root,
    testOnlyRoot: true,
    ...overrides,
  });
  return {
    adapter,
    command,
    inspectExactService,
    convergeExactService,
  };
}

/** @param {number} attemptGeneration @returns {AnyRecord} */
function expectedPortInput(attemptGeneration) {
  const artifactEvidence = makeArtifactEvidence(request);
  return {
    requestId: request.requestId,
    intentId: getAwsSingleNodeHostActivationIntentId(
      request,
      'service-convergence',
    ),
    attemptGeneration,
    deploymentInstanceId: request.deploymentInstanceId,
    appId: request.appId,
    artifactId: request.artifactId,
    revisionId: request.revisionId,
    targetId: request.targetId,
    artifactPath: artifactEvidence.artifactPath,
    contentLength: artifactEvidence.contentLength,
    byteDigest: artifactEvidence.byteDigest,
  };
}

describe('AWS single-node host service convergence', () => {
  it('settles only exact healthy, active, boot-persistent desired service proof', async () => {
    const { adapter, inspectExactService } = makeAdapter(
      healthyStatus(request),
    );
    const context = makeContext(request, 0);
    const observation = await adapter.observe(context);

    expect(observation).toEqual({
      status: 'settled',
      evidence: {
        schemaVersion:
          AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_HOST_SERVICE_CONVERGENCE_EVIDENCE_KIND,
        requestId: request.requestId,
        deploymentInstanceId: request.deploymentInstanceId,
        appId: request.appId,
        artifactId: request.artifactId,
        revisionId: request.revisionId,
        targetId: request.targetId,
        artifactPath: makeArtifactEvidence(request).artifactPath,
        runtimeUser: 'wharfie-runtime',
        runtimeGroup: 'wharfie-runtime',
        unitName: `wharfie-${request.appId}.service`,
        outcome: 'target-active',
        health: 'healthy',
        bootPersistent: true,
      },
    });
    expect(inspectExactService).toHaveBeenCalledWith(expectedPortInput(0));
    expectDeepFrozen(inspectExactService.mock.calls[0][0]);
    expectDeepFrozen(observation);
    expect(Object.keys(observation.evidence)).not.toContain('uid');
    expect(Object.keys(observation.evidence)).not.toContain('gid');

    expect(adapter.validateEvidence(observation.evidence, context)).toEqual(
      observation.evidence,
    );
    expect(
      validateAwsSingleNodeHostServiceConvergenceEvidence(
        observation.evidence,
        context,
        { root, testOnlyRoot: true },
      ),
    ).toEqual(observation.evidence);
  });

  it('classifies exact absence, a managed other release, and nonrollback progress as ready', async () => {
    const absent = makeAdapter(absentStatus(request));
    await expect(
      absent.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const interruptedFirstInstallStatus = absentStatus(request);
    interruptedFirstInstallStatus.health = 'degraded';
    interruptedFirstInstallStatus.integrity = { status: 'invalid' };
    interruptedFirstInstallStatus.activation = {
      phase: 'QUIESCING',
      action: 'install',
      desired: release(request),
      selected: null,
      rollback: null,
      lastOutcome: null,
    };
    interruptedFirstInstallStatus.desiredConvergence = desiredConvergence(
      request,
      'durable-install',
    );
    const interruptedFirstInstall = makeAdapter(interruptedFirstInstallStatus);
    await expect(
      interruptedFirstInstall.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const legacyFirstInstallTombstoneStatus = absentStatus(request);
    const legacyRelease = otherRelease();
    legacyFirstInstallTombstoneStatus.installation = {
      state: 'uninstalled',
      lastArtifactId: legacyRelease.artifactId,
      lastRevisionId: legacyRelease.revisionId,
    };
    legacyFirstInstallTombstoneStatus.health = 'degraded';
    legacyFirstInstallTombstoneStatus.integrity = { status: 'invalid' };
    legacyFirstInstallTombstoneStatus.activation = {
      phase: 'QUIESCENT',
      action: 'install',
      desired: release(request),
      selected: null,
      rollback: null,
      lastOutcome: null,
    };
    legacyFirstInstallTombstoneStatus.desiredConvergence = desiredConvergence(
      request,
      'durable-install',
    );
    const legacyFirstInstallTombstone = makeAdapter(
      legacyFirstInstallTombstoneStatus,
    );
    await expect(
      legacyFirstInstallTombstone.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const other = otherRelease();
    const managedOther = makeAdapter(healthyStatus(request, other));
    await expect(
      managedOther.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const progressingStatus = healthyStatus(request, other);
    progressingStatus.health = 'degraded';
    progressingStatus.activation = {
      phase: 'QUIESCING',
      action: 'update',
      desired: release(request),
      selected: other,
      rollback: other,
      lastOutcome: null,
    };
    progressingStatus.desiredConvergence = desiredConvergence(
      request,
      'durable-change',
    );
    const progressing = makeAdapter(progressingStatus);
    await expect(
      progressing.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const selectedTargetStatus = healthyStatus(request);
    const retainedSource = otherRelease();
    selectedTargetStatus.health = 'degraded';
    selectedTargetStatus.installation.previousArtifactId =
      retainedSource.artifactId;
    selectedTargetStatus.installation.previousRevisionId =
      retainedSource.revisionId;
    selectedTargetStatus.systemd = systemd(request, {
      activeState: 'inactive',
      subState: 'dead',
      mainPid: 0,
    });
    selectedTargetStatus.runtime = {
      status: 'STOPPED',
      artifactId: retainedSource.artifactId,
      revisionId: retainedSource.revisionId,
      generation: 4,
      session: 'absent',
      currentOwner: false,
    };
    selectedTargetStatus.activation = {
      phase: 'SELECTED',
      action: 'update',
      desired: release(request),
      selected: release(request),
      rollback: null,
      lastOutcome: null,
    };
    selectedTargetStatus.desiredConvergence = desiredConvergence(
      request,
      'durable-change',
    );
    const selectedTarget = makeAdapter(selectedTargetStatus);
    await expect(
      selectedTarget.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const restoredSourceStatus = healthyStatus(request, retainedSource);
    restoredSourceStatus.health = 'degraded';
    restoredSourceStatus.systemd = systemd(request, {
      activeState: 'inactive',
      subState: 'dead',
      mainPid: 0,
    });
    restoredSourceStatus.runtime = {
      status: 'STOPPED',
      artifactId: retainedSource.artifactId,
      revisionId: retainedSource.revisionId,
      generation: 5,
      session: 'absent',
      currentOwner: false,
    };
    restoredSourceStatus.activation = {
      phase: 'SELECTED',
      action: 'update',
      desired: retainedSource,
      selected: retainedSource,
      rollback: null,
      lastOutcome: null,
    };
    restoredSourceStatus.desiredConvergence = desiredConvergence(
      request,
      'durable-change',
    );
    const restoredSource = makeAdapter(restoredSourceStatus);
    await expect(
      restoredSource.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const failedStatus = healthyStatus(request);
    failedStatus.health = 'failed';
    failedStatus.systemd = systemd(request, {
      activeState: 'failed',
      subState: 'failed',
      result: 'failed',
      mainPid: 0,
    });
    failedStatus.runtime = {
      status: 'STOPPED',
      artifactId: request.artifactId,
      revisionId: request.revisionId,
      generation: 4,
      session: 'absent',
      currentOwner: false,
    };
    const failed = makeAdapter(failedStatus);
    await expect(
      failed.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const staleCacheStatus = healthyStatus(request);
    staleCacheStatus.health = 'degraded';
    staleCacheStatus.integrity = { status: 'invalid' };
    staleCacheStatus.wiring = {
      ...wiring(),
      state: 'conflicting',
      effectiveUnit: 'conflicting',
    };
    staleCacheStatus.systemd = systemd(request, {
      needDaemonReload: true,
    });
    const staleCache = makeAdapter(staleCacheStatus);
    await expect(
      staleCache.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });

    const missingUnitStatus = healthyStatus(request);
    missingUnitStatus.health = 'degraded';
    missingUnitStatus.integrity = { status: 'invalid' };
    missingUnitStatus.wiring = {
      ...wiring(),
      state: 'orphaned',
      unitFile: 'absent',
      effectiveUnit: 'absent',
    };
    missingUnitStatus.systemd = systemd(request, {
      loadState: 'not-found',
      unitFileState: '',
      activeState: 'inactive',
      subState: 'dead',
      mainPid: 0,
      fragmentPath: '',
    });
    missingUnitStatus.runtime = {
      status: 'STOPPED',
      artifactId: request.artifactId,
      revisionId: request.revisionId,
      generation: 4,
      session: 'absent',
      currentOwner: false,
    };
    const missingUnit = makeAdapter(missingUnitStatus);
    await expect(
      missingUnit.adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'ready' });
  });

  it.each([
    [
      'foreign app identity',
      () => ({ ...healthyStatus(request), appId: 'another-app' }),
    ],
    [
      'conflicting wiring',
      () => ({
        ...healthyStatus(request),
        wiring: {
          ...wiring(),
          state: 'conflicting',
          unitFile: 'conflicting',
        },
      }),
    ],
    [
      'ambiguous managed selector',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        integrity: { status: 'invalid' },
        wiring: {
          ...wiring(),
          state: 'conflicting',
          selection: 'conflicting',
        },
      }),
    ],
    [
      'rollback transition',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        activation: {
          phase: 'QUIESCING',
          action: 'rollback',
          desired: otherRelease(),
          selected: release(request),
          rollback: otherRelease(),
          lastOutcome: null,
        },
      }),
    ],
    [
      'active selection mismatch',
      () => ({
        ...healthyStatus(request),
        activation: {
          ...healthyStatus(request).activation,
          selected: otherRelease(),
        },
      }),
    ],
    [
      'active desired mismatch',
      () => ({
        ...healthyStatus(request),
        activation: {
          ...healthyStatus(request).activation,
          desired: otherRelease(),
        },
      }),
    ],
    [
      'runtime process mismatch',
      () => ({
        ...healthyStatus(request),
        runtime: { ...healthyStatus(request).runtime, processId: 732 },
      }),
    ],
    [
      'live manager process without runtime state',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: null,
      }),
    ],
    [
      'active manager state without a PID or runtime',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        systemd: systemd(request, { mainPid: 0 }),
        runtime: null,
      }),
    ],
    [
      'live manager process with a stopped runtime',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          status: 'STOPPED',
          artifactId: request.artifactId,
          revisionId: request.revisionId,
          generation: 4,
          session: 'absent',
          currentOwner: false,
        },
      }),
    ],
    [
      'live manager process with a stopping lifecycle',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          ...healthyStatus(request).runtime,
          status: 'STOPPING',
        },
      }),
    ],
    [
      'active runtime without a process identity',
      () => {
        const status = healthyStatus(request);
        delete status.runtime.processId;
        status.health = 'degraded';
        return status;
      },
    ],
    [
      'active runtime without current lifecycle ownership',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          ...healthyStatus(request).runtime,
          currentOwner: false,
        },
      }),
    ],
    [
      'active runtime without release identity',
      () => {
        const status = healthyStatus(request);
        delete status.runtime.artifactId;
        delete status.runtime.revisionId;
        status.health = 'degraded';
        return status;
      },
    ],
    [
      'active runtime outside the manager main process',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        systemd: {
          ...systemd(request),
          mainPid: 0,
        },
      }),
    ],
    [
      'live rollback-candidate runtime',
      () => {
        const rollback = otherRelease();
        const status = healthyStatus(request);
        status.installation.previousArtifactId = rollback.artifactId;
        status.installation.previousRevisionId = rollback.revisionId;
        status.activation.rollback = rollback;
        status.runtime = {
          ...status.runtime,
          artifactId: rollback.artifactId,
          revisionId: rollback.revisionId,
        };
        return status;
      },
    ],
    [
      'manual runtime owner',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          ...healthyStatus(request).runtime,
          ownerKind: 'manual',
        },
      }),
    ],
    [
      'manual runtime session without an owner kind',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          status: 'READY',
          artifactId: request.artifactId,
          revisionId: request.revisionId,
          generation: 4,
          session: 'manual',
          currentOwner: false,
        },
      }),
    ],
    [
      'active self rollback candidate',
      () => ({
        ...healthyStatus(request),
        installation: {
          ...healthyStatus(request).installation,
          previousArtifactId: request.artifactId,
          previousRevisionId: request.revisionId,
        },
        activation: {
          ...healthyStatus(request).activation,
          rollback: release(request),
        },
      }),
    ],
    [
      'active previous and rollback mismatch',
      () => ({
        ...healthyStatus(request),
        installation: {
          ...healthyStatus(request).installation,
          previousArtifactId: otherRelease().artifactId,
          previousRevisionId: otherRelease().revisionId,
        },
      }),
    ],
    [
      'inverted active receipt projection',
      () => {
        const current = release(request);
        const previous = otherRelease();
        const status = healthyStatus(request);
        status.installation = {
          state: 'installed',
          activeArtifactId: previous.artifactId,
          activeRevisionId: previous.revisionId,
          previousArtifactId: current.artifactId,
          previousRevisionId: current.revisionId,
        };
        status.activation = {
          ...status.activation,
          rollback: previous,
        };
        status.integrity = {
          status: 'verified',
          artifactId: previous.artifactId,
          revisionId: previous.revisionId,
        };
        return status;
      },
    ],
    [
      'foreign ACTIVE uninstall tombstone',
      () => ({
        ...absentStatus(request),
        installation: {
          state: 'uninstalled',
          lastArtifactId: otherRelease().artifactId,
          lastRevisionId: otherRelease().revisionId,
        },
        activation: healthyStatus(request).activation,
        desiredConvergence: desiredConvergence(request, 'durable-active'),
      }),
    ],
    [
      'foreign durable-change uninstall tombstone',
      () => {
        const source = otherRelease();
        const status = absentStatus(request);
        status.installation = {
          state: 'uninstalled',
          lastArtifactId: createSha256Id({
            prefix: 'waf1',
            payload: 'foreign uninstall tombstone artifact bytes',
          }),
          lastRevisionId: semanticId(
            'wrv1',
            'wharfie:test:foreign-uninstall-tombstone-revision:v1',
            { revision: 3 },
          ),
        };
        status.activation = {
          phase: 'SELECTED',
          action: 'update',
          desired: release(request),
          selected: release(request),
          rollback: source,
          lastOutcome: null,
        };
        status.desiredConvergence = desiredConvergence(
          request,
          'durable-change',
        );
        return status;
      },
    ],
    [
      'verified integrity for another release',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        integrity: {
          status: 'verified',
          ...otherRelease(),
        },
      }),
    ],
    [
      'foreign effective unit',
      () => ({
        ...healthyStatus(request),
        systemd: {
          ...systemd(request),
          fragmentPath: '/etc/systemd/user/foreign.service',
        },
      }),
    ],
    [
      'loaded unit without an effective fragment',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        systemd: systemd(request, { fragmentPath: '' }),
      }),
    ],
    [
      'live process behind a not-found unit',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        systemd: systemd(request, {
          loadState: 'not-found',
          fragmentPath: '',
        }),
      }),
    ],
    [
      'missing managed unit source',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        systemd: {
          ...systemd(request),
          loadState: 'not-found',
          unitFileState: '',
          activeState: 'inactive',
          subState: 'dead',
          mainPid: 0,
          fragmentPath: '',
        },
      }),
    ],
    [
      'disabled lingering on an installed service',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        persistence: {
          linger: false,
          unitEnabled: true,
          bootEnabled: false,
        },
      }),
    ],
  ])(
    'classifies positively %s state as conflict',
    async (_label, makeStatus) => {
      const { adapter } = makeAdapter(makeStatus());
      await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
        status: 'conflict',
      });
    },
  );

  it('maps the V3 decision directly and rejects internally inconsistent authorization', async () => {
    const conflictStatus = healthyStatus(request);
    conflictStatus.desiredConvergence = desiredConvergence(request, undefined, {
      disposition: 'conflict',
      basis: null,
    });
    await expect(
      makeAdapter(conflictStatus).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'conflict' });

    const unknownStatus = healthyStatus(request);
    unknownStatus.desiredConvergence = desiredConvergence(request, undefined, {
      disposition: 'unknown',
      basis: null,
    });
    await expect(
      makeAdapter(unknownStatus).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'unknown' });

    const wrongBasis = healthyStatus(request);
    wrongBasis.desiredConvergence = desiredConvergence(
      request,
      'durable-change',
    );
    await expect(
      makeAdapter(wrongBasis).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'unknown' });

    const falseAbsence = healthyStatus(request);
    falseAbsence.desiredConvergence = desiredConvergence(
      request,
      'physical-absence',
    );
    await expect(
      makeAdapter(falseAbsence).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'conflict' });

    const falseAbsenceHealth = absentStatus(request);
    falseAbsenceHealth.health = 'healthy';
    await expect(
      makeAdapter(falseAbsenceHealth).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'unknown' });

    const wrongDesired = healthyStatus(request);
    wrongDesired.desiredConvergence = {
      ...desiredConvergence(request),
      desired: otherRelease(),
    };
    await expect(
      makeAdapter(wrongDesired).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'unknown' });

    const extraProofField = healthyStatus(request);
    extraProofField.desiredConvergence = {
      ...desiredConvergence(request),
      command: 'forged',
    };
    await expect(
      makeAdapter(extraProofField).adapter.observe(makeContext(request, 0)),
    ).resolves.toEqual({ status: 'unknown' });

    const unavailableVerifiedRuntime = healthyStatus(request);
    unavailableVerifiedRuntime.health = 'degraded';
    unavailableVerifiedRuntime.runtime = {
      status: 'UNAVAILABLE',
      session: 'unknown',
    };
    await expect(
      makeAdapter(unavailableVerifiedRuntime).adapter.observe(
        makeContext(request, 0),
      ),
    ).resolves.toEqual({ status: 'unknown' });

    const unavailableInvalidRuntime = healthyStatus(request);
    unavailableInvalidRuntime.health = 'degraded';
    unavailableInvalidRuntime.integrity = { status: 'invalid' };
    unavailableInvalidRuntime.runtime = {
      status: 'UNAVAILABLE',
      session: 'unknown',
    };
    await expect(
      makeAdapter(unavailableInvalidRuntime).adapter.observe(
        makeContext(request, 0),
      ),
    ).resolves.toEqual({ status: 'unknown' });
  });

  it.each([
    ['null', () => null],
    [
      'legacy V2 schema',
      () => ({ ...healthyStatus(request), schemaVersion: 2 }),
    ],
    ['extra field', () => ({ ...healthyStatus(request), argv: [] })],
    [
      'unsupported health',
      () => ({ ...healthyStatus(request), health: 'forged' }),
    ],
    [
      'unsupported systemd load state',
      () => ({
        ...healthyStatus(request),
        systemd: systemd(request, { loadState: 'masked' }),
      }),
    ],
    [
      'malformed optional integrity',
      () => ({
        ...healthyStatus(request),
        integrity: { status: 'invalid', artifactId: request.artifactId },
      }),
    ],
    [
      'installed status without integrity',
      () => {
        const status = healthyStatus(request);
        delete status.integrity;
        return status;
      },
    ],
    [
      'installed status without persistence',
      () => {
        const status = healthyStatus(request);
        delete status.persistence;
        return status;
      },
    ],
    [
      'unavailable manager',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        wiring: { ...wiring(), state: 'unknown', effectiveUnit: 'unknown' },
        systemd: {
          ...systemd(request),
          loadState: 'unavailable',
          unitFileState: 'unknown',
          activeState: 'unknown',
          subState: 'unknown',
          result: 'unknown',
          mainPid: 0,
          fragmentPath: '',
          needDaemonReload: null,
        },
      }),
    ],
    [
      'active null outcome',
      () => ({
        ...healthyStatus(request),
        activation: {
          ...healthyStatus(request).activation,
          lastOutcome: null,
        },
      }),
    ],
    [
      'unsupported runtime session',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          ...healthyStatus(request).runtime,
          session: 'forged',
        },
      }),
    ],
    [
      'install transition with a foreign selected reference',
      () => {
        const status = absentStatus(request);
        status.health = 'degraded';
        status.integrity = { status: 'invalid' };
        status.activation = {
          phase: 'QUIESCENT',
          action: 'install',
          desired: release(request),
          selected: otherRelease(),
          rollback: null,
          lastOutcome: null,
        };
        status.desiredConvergence = desiredConvergence(
          request,
          'durable-install',
        );
        return status;
      },
    ],
    [
      'stale manager cache during an ambiguous transition',
      () => {
        /** @type {AnyRecord} */
        const status = {
          ...healthyStatus(request),
          health: 'degraded',
          integrity: { status: 'invalid' },
          wiring: {
            ...wiring(),
            state: 'conflicting',
            effectiveUnit: 'conflicting',
          },
          systemd: systemd(request, { needDaemonReload: true }),
          activation: {
            phase: 'QUIESCING',
            action: 'update',
            desired: release(request),
            selected: otherRelease(),
            rollback: null,
            lastOutcome: null,
          },
        };
        status.desiredConvergence = desiredConvergence(request, undefined, {
          disposition: 'unknown',
          basis: null,
        });
        return status;
      },
    ],
    [
      'absent runtime session with a live process',
      () => ({
        ...healthyStatus(request),
        health: 'degraded',
        runtime: {
          ...healthyStatus(request).runtime,
          session: 'absent',
          currentOwner: false,
        },
      }),
    ],
  ])(
    'classifies malformed or %s status as unknown',
    async (_label, makeStatus) => {
      const { adapter } = makeAdapter(makeStatus());
      await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
        status: 'unknown',
      });
    },
  );

  it('maps inspection failure to unknown without weakening context validation', async () => {
    const { adapter, inspectExactService } = makeAdapter(
      healthyStatus(request),
    );
    inspectExactService.mockImplementationOnce(async () => {
      throw new Error('manager unavailable');
    });
    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'unknown',
    });

    const invalid = clone(makeContext(request, 0));
    invalid.step.intentId = getAwsSingleNodeHostActivationIntentId(
      request,
      'artifact-projection',
    );
    await expect(adapter.observe(invalid)).rejects.toThrow(
      /intentId does not match/u,
    );
    expect(inspectExactService).toHaveBeenCalledTimes(1);
  });

  it('converges only a positive generation through the same exact frozen port input and ignores its result', async () => {
    const { adapter, convergeExactService } = makeAdapter(
      absentStatus(request),
    );
    const context = makeContext(request, 3);

    await expect(adapter.converge(context)).resolves.toBeUndefined();
    expect(convergeExactService).toHaveBeenCalledWith(expectedPortInput(3));
    const convergeInput = /** @type {AnyRecord} */ (
      convergeExactService.mock.calls[0][0]
    );
    expectDeepFrozen(convergeInput);
    expect(Object.keys(convergeInput).sort()).toEqual(
      Object.keys(expectedPortInput(3)).sort(),
    );
    expect(convergeInput).not.toHaveProperty('action');
    expect(convergeInput).not.toHaveProperty('argv');
    expect(convergeInput).not.toHaveProperty('env');
    expect(convergeInput).not.toHaveProperty('user');

    await expect(adapter.converge(makeContext(request, 0))).rejects.toThrow(
      /positive safe integer/u,
    );
    expect(convergeExactService).toHaveBeenCalledTimes(1);
  });

  it('snapshots own data-property command methods and rejects broader ports', async () => {
    const made = makeAdapter(healthyStatus(request));
    made.command.inspectExactService = jest.fn(async () => {
      throw new Error('late mutation reached');
    });
    await expect(
      made.adapter.observe(makeContext(request, 0)),
    ).resolves.toMatchObject({ status: 'settled' });
    expect(made.inspectExactService).toHaveBeenCalledTimes(1);

    const getterPort = {
      convergeExactService: jest.fn(),
    };
    Object.defineProperty(getterPort, 'inspectExactService', {
      enumerable: true,
      get() {
        throw new Error('getter must not execute');
      },
    });
    expect(() =>
      createAwsSingleNodeHostServiceConvergenceAdapter({
        command: getterPort,
        root,
        testOnlyRoot: true,
      }),
    ).toThrow(/own data property/u);
    expect(() =>
      createAwsSingleNodeHostServiceConvergenceAdapter({
        command: {
          inspectExactService: jest.fn(),
          convergeExactService: jest.fn(),
          exec: jest.fn(),
        },
        root,
        testOnlyRoot: true,
      }),
    ).toThrow(/exec is not supported/u);
  });

  it('binds evidence to strict V71 artifact proof and rejects evidence drift', async () => {
    const { adapter, inspectExactService } = makeAdapter(
      healthyStatus(request),
    );
    const forgedContext = clone(makeContext(request, 0));
    forgedContext.priorEvidence['artifact-projection'].artifactPath = path.join(
      root,
      'forged',
      'app',
    );
    await expect(adapter.observe(forgedContext)).rejects.toThrow(
      /does not match the exact request/u,
    );
    expect(inspectExactService).not.toHaveBeenCalled();

    const observation = await adapter.observe(makeContext(request, 0));
    const forgedEvidence = {
      ...clone(observation.evidence),
      runtimeUser: 'root',
    };
    expect(() =>
      adapter.validateEvidence(forgedEvidence, makeContext(request, 0)),
    ).toThrow(/does not match the exact request/u);
    expect(() =>
      adapter.validateEvidence(
        { ...clone(observation.evidence), pid: 731 },
        makeContext(request, 0),
      ),
    ).toThrow(/pid is not supported/u);
  });

  it('admits custom projection roots only through the explicit temporary test seam', () => {
    const command = {
      inspectExactService: jest.fn(),
      convergeExactService: jest.fn(),
    };
    expect(() =>
      createAwsSingleNodeHostServiceConvergenceAdapter({ command, root }),
    ).toThrow(/testOnlyRoot must be true/u);
    expect(() =>
      createAwsSingleNodeHostServiceConvergenceAdapter({
        command,
        root: '/opt/wharfie-test',
        testOnlyRoot: true,
      }),
    ).toThrow(/strictly beneath/u);
    expect(() =>
      createAwsSingleNodeHostServiceConvergenceAdapter({
        command,
        testOnlyRoot: true,
      }),
    ).toThrow(/not supported with the production root/u);

    const adapter = createAwsSingleNodeHostServiceConvergenceAdapter({
      command,
      root,
      testOnlyRoot: true,
    });
    expect(Object.isFrozen(adapter)).toBe(true);
  });
});
