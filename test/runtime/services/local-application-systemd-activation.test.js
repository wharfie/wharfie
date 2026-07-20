/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import {
  LocalApplicationActivationOutcome,
  LocalApplicationActivationPhase,
  createLocalApplicationActivation,
} from '../../../src/core/lib/db/tables/local-application-activation.js';
import {
  LOCAL_APPLICATION_SYSTEMD_ACTIVATION_RESULT_KIND,
  LocalApplicationSystemdActivationRequestStatus,
  LocalApplicationSystemdActivationSettledOutcome,
  createLocalApplicationSystemdActivation,
} from '../../../src/core/runtime/services/local-application-systemd-activation.js';

const APP_ID = 'systemd-activation-app';
const TABLE_NAME = 'systemd-activation-test';
const RELEASE_A = Object.freeze({
  artifactId: `waf1_${'A'.repeat(43)}`,
  revisionId: `wrv1_${'A'.repeat(43)}`,
});
const RELEASE_B = Object.freeze({
  artifactId: `waf1_${'B'.repeat(42)}A`,
  revisionId: `wrv1_${'B'.repeat(42)}A`,
});
const RELEASE_C = Object.freeze({
  artifactId: `waf1_${'C'.repeat(42)}A`,
  revisionId: `wrv1_${'C'.repeat(42)}A`,
});
/** @typedef {Readonly<{artifactId: string, revisionId: string}>} Release */
/** @type {string[]} */
const roots = [];

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

/** @param {Release | null} left @param {Release | null} right */
function sameRelease(left, right) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.artifactId === right.artifactId &&
      left.revisionId === right.revisionId)
  );
}

/** @returns {Record<string, any>} */
function blocker(runId = 'running-work') {
  return {
    runId,
    appId: APP_ID,
    revisionId: RELEASE_A.revisionId,
    kind: 'workflow',
    status: 'RUNNING',
    version: 1,
    lastSequence: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** @returns {Promise<Record<string, any>>} */
async function createHarness() {
  const root = await fsp.mkdtemp(
    path.join(tmpdir(), 'wharfie-systemd-activation-'),
  );
  roots.push(root);
  let clock = 100;
  const activation = createLocalApplicationActivation({
    db: createVanillaDB({ path: root }),
    tableName: TABLE_NAME,
    now: () => clock++,
  });
  /**
   * @type {{held: boolean, staged: Set<string>, selected: Release | null, previous: Release | null, active: Release | null, failedArtifacts: Set<string>, quiescencePages: Array<Array<Record<string, any>>>, calls: string[]}}
   */
  const state = {
    held: false,
    staged: new Set(),
    selected: null,
    previous: null,
    active: null,
    failedArtifacts: new Set(),
    quiescencePages: [],
    calls: [],
  };

  const assertLocked = () => {
    if (!state.held) throw new Error('driver effect escaped operation lock');
  };
  const acquireOperationLock = jest.fn(async ({ operation }) => {
    if (state.held) throw new Error('operation lock was acquired recursively');
    state.held = true;
    state.calls.push(`lock:${operation}`);
    return async () => {
      if (!state.held) throw new Error('operation lock was released twice');
      state.calls.push(`unlock:${operation}`);
      state.held = false;
    };
  });
  const stageRelease = jest.fn(async ({ release }) => {
    assertLocked();
    const durable = await activation.get({ appId: APP_ID });
    state.calls.push(
      `stage:${release.artifactId}:${durable?.phase ?? 'absent'}`,
    );
    state.staged.add(release.artifactId);
  });
  const verifyRelease = jest.fn(async ({ release }) => {
    assertLocked();
    const durable = await activation.get({ appId: APP_ID });
    state.calls.push(
      `verify:${release.artifactId}:${durable?.phase ?? 'absent'}`,
    );
    if (!state.staged.has(release.artifactId)) {
      throw new Error('immutable release was not staged');
    }
  });
  const stopService = jest.fn(async () => {
    assertLocked();
    state.calls.push('stop');
    state.active = null;
  });
  const proveServiceInactive = jest.fn(async () => {
    assertLocked();
    state.calls.push('inactive');
    if (state.active !== null) throw new Error('service remained active');
  });
  const selectRelease = jest.fn(
    async (/** @type {Record<string, any>} */ projection) => {
      assertLocked();
      if (state.active !== null) {
        throw new Error('selector changed while a service was active');
      }
      state.calls.push(
        `select:${projection.current.artifactId}:${projection.destination}`,
      );
      state.selected = projection.current;
      state.previous = projection.previous;
    },
  );
  const verifySelection = jest.fn(
    async (/** @type {Record<string, any>} */ projection) => {
      assertLocked();
      state.calls.push(`selection:${projection.current.artifactId}`);
      if (
        !sameRelease(state.selected, projection.current) ||
        !sameRelease(state.previous, projection.previous)
      ) {
        throw new Error('selection projection drifted');
      }
    },
  );
  const activateRelease = jest.fn(async ({ release }) => {
    assertLocked();
    state.calls.push(`activate:${release.artifactId}`);
    if (state.failedArtifacts.has(release.artifactId)) {
      return { status: 'failed' };
    }
    if (state.active !== null && !sameRelease(state.active, release)) {
      throw new Error('a different release remained active');
    }
    state.active = release;
    return { status: 'healthy' };
  });
  const verifyActiveRelease = jest.fn(async ({ release }) => {
    assertLocked();
    state.calls.push(`active:${release.artifactId}`);
    if (!sameRelease(state.active, release)) {
      throw new Error('active runtime drifted');
    }
  });
  const verifyAbsent = jest.fn(async () => {
    assertLocked();
    state.calls.push('absent');
    if (
      state.selected !== null ||
      state.previous !== null ||
      state.active !== null
    ) {
      throw new Error(
        'physical service state exists without durable activation',
      );
    }
  });
  const ledger = {
    listRuns: jest.fn(async () => ({
      items: state.quiescencePages.length ? state.quiescencePages.shift() : [],
    })),
  };

  const createService = (activationStore = activation) =>
    createLocalApplicationSystemdActivation({
      activation: activationStore,
      ledger,
      acquireOperationLock,
      stageRelease,
      verifyRelease,
      stopService,
      proveServiceInactive,
      selectRelease,
      verifySelection,
      activateRelease,
      verifyActiveRelease,
      verifyAbsent,
    });

  return {
    activation,
    state,
    ledger,
    createService,
    driver: {
      acquireOperationLock,
      stageRelease,
      verifyRelease,
      stopService,
      proveServiceInactive,
      selectRelease,
      verifySelection,
      activateRelease,
      verifyActiveRelease,
      verifyAbsent,
    },
  };
}

/**
 * @param {Record<string, Function>} activation - Activation store.
 * @param {string} method - Method after which to fail once.
 * @returns {Readonly<Record<string, Function>>}
 */
function crashAfter(activation, method) {
  let crashPending = true;
  /** @param {...any} args */
  async function failAfter(...args) {
    const result = await activation[method](...args);
    if (crashPending) {
      crashPending = false;
      throw new Error(`simulated crash after ${method}`);
    }
    return result;
  }
  return Object.freeze({
    ...activation,
    [method]: failAfter,
  });
}

/**
 * @param {Record<string, Function>} activation - Activation store.
 * @param {string} method - Method before which to fail once.
 * @returns {Readonly<Record<string, Function>>}
 */
function crashBefore(activation, method) {
  let crashPending = true;
  /** @param {...any} args */
  async function failBefore(...args) {
    if (crashPending) {
      crashPending = false;
      throw new Error(`simulated crash before ${method}`);
    }
    return await activation[method](...args);
  }
  return Object.freeze({
    ...activation,
    [method]: failBefore,
  });
}

/** @param {Record<string, any>} harness @param {Release} [release] */
async function install(harness, release = RELEASE_A) {
  return await harness
    .createService()
    .install({ appId: APP_ID, target: release });
}

describe('local application systemd activation convergence', () => {
  it.each([
    'beginInstall',
    'markQuiescent',
    'markSelected',
    'markActivating',
    'completeActivation',
  ])('recovers a crash after durable %s', async (method) => {
    const harness = await createHarness();
    const crashing = harness.createService(
      crashAfter(harness.activation, method),
    );

    await expect(
      crashing.install({ appId: APP_ID, target: RELEASE_A }),
    ).rejects.toThrow(`simulated crash after ${method}`);
    expect(harness.state.held).toBe(false);

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered).toMatchObject({
      kind: LOCAL_APPLICATION_SYSTEMD_ACTIVATION_RESULT_KIND,
      operation: 'recover',
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVE,
        selected: RELEASE_A,
      },
    });
    expect(harness.state.selected).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_A);
    expect(harness.state.held).toBe(false);
  });

  it('installs the first resident while durable work is already queued', async () => {
    const harness = await createHarness();
    harness.state.quiescencePages.push([blocker('offline-work')]);

    const result = await harness
      .createService()
      .install({ appId: APP_ID, target: RELEASE_A });

    expect(result).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: { selected: RELEASE_A },
    });
    expect(harness.ledger.listRuns).not.toHaveBeenCalled();
    expect(harness.state.active).toEqual(RELEASE_A);
    expect(harness.state.quiescencePages).toHaveLength(1);
  });

  it('recovers when stop took effect before the inactive proof failed', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.driver.proveServiceInactive.mockRejectedValueOnce(
      new Error('simulated inactive-proof interruption'),
    );

    await expect(
      harness.createService().update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('simulated inactive-proof interruption');
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.QUIESCING,
      selected: RELEASE_A,
      desired: RELEASE_B,
    });
    expect(harness.state.active).toBeNull();
    expect(harness.state.selected).toEqual(RELEASE_A);
    expect(harness.state.held).toBe(false);

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: { selected: RELEASE_B },
    });
    expect(harness.state.active).toEqual(RELEASE_B);
  });

  it('repeats quiescence after crashing between the second scan and its durable marker', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.ledger.listRuns.mockClear();
    const crashing = harness.createService(
      crashBefore(harness.activation, 'markQuiescent'),
    );

    await expect(
      crashing.update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('simulated crash before markQuiescent');
    expect(harness.ledger.listRuns).toHaveBeenCalledTimes(2);
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.QUIESCING,
      selected: RELEASE_A,
      desired: RELEASE_B,
    });
    expect(harness.state.active).toBeNull();

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered.settledOutcome).toBe(
      LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
    );
    expect(harness.ledger.listRuns).toHaveBeenCalledTimes(4);
    expect(harness.state.selected).toEqual(RELEASE_B);
    expect(harness.state.active).toEqual(RELEASE_B);
  });

  it('repairs a partial selector projection before marking it selected', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.driver.selectRelease.mockClear();
    harness.driver.selectRelease.mockImplementationOnce(
      async (/** @type {Record<string, any>} */ projection) => {
        if (!harness.state.held) {
          throw new Error('driver effect escaped operation lock');
        }
        harness.state.calls.push(
          `select-partial:${projection.current.artifactId}:${projection.destination}`,
        );
        harness.state.selected = projection.current;
        throw new Error('simulated crash after selector replacement');
      },
    );

    await expect(
      harness.createService().update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('simulated crash after selector replacement');
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.QUIESCENT,
      selected: RELEASE_A,
      desired: RELEASE_B,
    });
    expect(harness.state.selected).toEqual(RELEASE_B);
    expect(harness.state.previous).toBeNull();
    expect(harness.state.active).toBeNull();

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered.settledOutcome).toBe(
      LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
    );
    expect(harness.driver.selectRelease).toHaveBeenCalledTimes(2);
    expect(harness.state.selected).toEqual(RELEASE_B);
    expect(harness.state.previous).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_B);
  });

  it('recovers when exact active health was proven before completion crashed', async () => {
    const harness = await createHarness();
    const crashing = harness.createService(
      crashBefore(harness.activation, 'completeActivation'),
    );

    await expect(
      crashing.install({ appId: APP_ID, target: RELEASE_A }),
    ).rejects.toThrow('simulated crash before completeActivation');
    expect(harness.driver.verifyActiveRelease).toHaveBeenCalledWith({
      appId: APP_ID,
      release: RELEASE_A,
    });
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.ACTIVATING,
      selected: RELEASE_A,
    });
    expect(harness.state.active).toEqual(RELEASE_A);

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: { selected: RELEASE_A },
    });
    expect(harness.state.active).toEqual(RELEASE_A);
  });

  it('stops a source start that races the durable QUIESCENT barrier', async () => {
    const harness = await createHarness();
    await install(harness);
    const markQuiescent = async (/** @type {any} */ input) => {
      const result = await harness.activation.markQuiescent(input);
      harness.state.active = RELEASE_A;
      return result;
    };
    const service = harness.createService(
      Object.freeze({ ...harness.activation, markQuiescent }),
    );

    const result = await service.update({ appId: APP_ID, target: RELEASE_B });

    expect(result.settledOutcome).toBe(
      LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
    );
    expect(harness.state.selected).toEqual(RELEASE_B);
    expect(harness.state.active).toEqual(RELEASE_B);
  });

  it('proves inactivity again when recovery resumes from SELECTED', async () => {
    const harness = await createHarness();
    await install(harness);
    const crashing = harness.createService(
      crashAfter(harness.activation, 'markSelected'),
    );
    await expect(
      crashing.update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('simulated crash after markSelected');
    harness.state.active = RELEASE_A;

    const result = await harness.createService().recover({ appId: APP_ID });

    expect(result.settledOutcome).toBe(
      LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
    );
    expect(harness.state.active).toEqual(RELEASE_B);
  });

  it('stages and verifies before closing admission, then updates successfully', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.state.calls.length = 0;

    const result = await harness
      .createService()
      .update({ appId: APP_ID, target: RELEASE_B });

    expect(result).toMatchObject({
      operation: 'update',
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVE,
        selected: RELEASE_B,
        rollbackCandidate: RELEASE_A,
        lastTransition: {
          outcome: LocalApplicationActivationOutcome.TARGET_ACTIVE,
        },
      },
    });
    expect(harness.state.calls.slice(0, 3)).toEqual([
      'lock:update',
      `stage:${RELEASE_B.artifactId}:ACTIVE`,
      `verify:${RELEASE_B.artifactId}:ACTIVE`,
    ]);
    expect(harness.state.selected).toEqual(RELEASE_B);
    expect(harness.state.previous).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_B);
    expect(harness.state.held).toBe(false);
  });

  it('verifies an in-flight target against its source, not older rollback history', async () => {
    const harness = await createHarness();
    const service = harness.createService();
    await service.install({ appId: APP_ID, target: RELEASE_A });
    await service.update({ appId: APP_ID, target: RELEASE_B });

    const result = await service.update({ appId: APP_ID, target: RELEASE_C });

    expect(result).toMatchObject({
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: {
        selected: RELEASE_C,
        rollbackCandidate: RELEASE_B,
      },
    });
    expect(harness.state.previous).toEqual(RELEASE_B);
    expect(harness.state.selected).toEqual(RELEASE_C);
  });

  it('leaves admission open when the ACTIVE source projection has drifted', async () => {
    const harness = await createHarness();
    await install(harness);
    const beginChange = jest.fn(harness.activation.beginChange);
    const service = harness.createService(
      Object.freeze({ ...harness.activation, beginChange }),
    );
    harness.state.selected = null;

    await expect(
      service.update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('selection projection drifted');

    expect(beginChange).not.toHaveBeenCalled();
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.ACTIVE,
      selected: RELEASE_A,
    });
    expect(harness.state.held).toBe(false);
  });

  it('refuses an update with durable work without stopping its source', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.state.calls.length = 0;
    harness.driver.stopService.mockClear();
    harness.state.quiescencePages.push([blocker()]);

    const result = await harness
      .createService()
      .update({ appId: APP_ID, target: RELEASE_B });

    expect(result).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.REFUSED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.SOURCE_RETAINED,
      reason: 'durable-work',
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVE,
        selected: RELEASE_A,
        lastTransition: {
          outcome: LocalApplicationActivationOutcome.SOURCE_RETAINED,
        },
      },
      quiescence: { blockerCount: 1, quiescent: false },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(harness.driver.stopService).not.toHaveBeenCalled();
    expect(harness.state.active).toEqual(RELEASE_A);
    expect(harness.state.held).toBe(false);
  });

  it('recovers source-retained settlement after abort committed before the caller crashed', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.state.quiescencePages.push([blocker()]);
    const crashing = harness.createService(
      crashAfter(harness.activation, 'abortChange'),
    );

    await expect(
      crashing.update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('simulated crash after abortChange');
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.ACTIVE,
      selected: RELEASE_A,
      desired: RELEASE_A,
      lastTransition: {
        outcome: LocalApplicationActivationOutcome.SOURCE_RETAINED,
      },
    });
    expect(harness.state.selected).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_A);

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered).toMatchObject({
      operation: 'recover',
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.SOURCE_RETAINED,
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVE,
        selected: RELEASE_A,
      },
    });
  });

  it('reactivates and retains the source if the post-stop proof finds work', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.state.calls.length = 0;
    harness.driver.stopService.mockClear();
    harness.state.quiescencePages.push([], [blocker('late-work')]);

    const result = await harness
      .createService()
      .update({ appId: APP_ID, target: RELEASE_B });

    expect(result.requestStatus).toBe(
      LocalApplicationSystemdActivationRequestStatus.REFUSED,
    );
    expect(harness.driver.stopService).toHaveBeenCalledTimes(1);
    expect(harness.state.calls).toContain(`activate:${RELEASE_A.artifactId}`);
    expect(harness.state.active).toEqual(RELEASE_A);
    expect(result.activation.phase).toBe(
      LocalApplicationActivationPhase.ACTIVE,
    );
  });

  it('restores the source after a target failure without blocking on old work', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.ledger.listRuns.mockClear();
    harness.state.failedArtifacts.add(RELEASE_B.artifactId);
    harness.state.quiescencePages.push([], [], [blocker('old-source-work')]);

    const result = await harness
      .createService()
      .update({ appId: APP_ID, target: RELEASE_B });

    expect(result).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FAILED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.SOURCE_RESTORED,
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVE,
        selected: RELEASE_A,
        rollbackCandidate: null,
        lastTransition: {
          outcome: LocalApplicationActivationOutcome.SOURCE_RESTORED,
        },
      },
    });
    expect(harness.ledger.listRuns).toHaveBeenCalledTimes(2);
    expect(harness.state.quiescencePages).toHaveLength(1);
    expect(harness.state.calls).toContain(
      `select:${RELEASE_B.artifactId}:target`,
    );
    expect(harness.state.calls).toContain(
      `select:${RELEASE_A.artifactId}:source`,
    );
    expect(harness.state.selected).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_A);
  });

  it.each([
    {
      label: 'throws',
      fail: async () => {
        throw new Error('simulated indeterminate activation');
      },
      message: 'simulated indeterminate activation',
    },
    {
      label: 'returns an unknown status',
      fail: async () => ({ status: 'unknown' }),
      message: "must be 'healthy' or 'failed'",
    },
  ])(
    'leaves the target ACTIVATING without source restoration when activateRelease $label',
    async ({ fail, message }) => {
      const harness = await createHarness();
      await install(harness);
      const beginSourceRestore = jest.fn(harness.activation.beginSourceRestore);
      const activationStore = Object.freeze({
        ...harness.activation,
        beginSourceRestore,
      });
      harness.driver.activateRelease.mockImplementationOnce(fail);

      await expect(
        harness
          .createService(activationStore)
          .update({ appId: APP_ID, target: RELEASE_B }),
      ).rejects.toThrow(message);
      expect(beginSourceRestore).not.toHaveBeenCalled();
      await expect(
        harness.activation.get({ appId: APP_ID }),
      ).resolves.toMatchObject({
        phase: LocalApplicationActivationPhase.ACTIVATING,
        selected: RELEASE_B,
        desired: RELEASE_B,
        transition: { source: RELEASE_A, target: RELEASE_B },
      });
      expect(harness.state.active).toBeNull();
      expect(harness.state.held).toBe(false);

      const recovered = await harness
        .createService()
        .recover({ appId: APP_ID });
      expect(recovered).toMatchObject({
        requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
        settledOutcome:
          LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
        activation: { selected: RELEASE_B },
      });
      expect(harness.state.active).toEqual(RELEASE_B);
    },
  );

  it('recovers a crash immediately after source restoration becomes durable', async () => {
    const harness = await createHarness();
    await install(harness);
    harness.state.failedArtifacts.add(RELEASE_B.artifactId);
    const crashing = harness.createService(
      crashAfter(harness.activation, 'beginSourceRestore'),
    );

    await expect(
      crashing.update({ appId: APP_ID, target: RELEASE_B }),
    ).rejects.toThrow('simulated crash after beginSourceRestore');
    harness.state.failedArtifacts.delete(RELEASE_B.artifactId);

    const recovered = await harness.createService().recover({ appId: APP_ID });
    expect(recovered.settledOutcome).toBe(
      LocalApplicationSystemdActivationSettledOutcome.SOURCE_RESTORED,
    );
    expect(recovered.activation.selected).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_A);
  });

  it('rolls back to the retained exact release and swaps the candidate', async () => {
    const harness = await createHarness();
    const service = harness.createService();
    await service.install({ appId: APP_ID, target: RELEASE_A });
    await service.update({ appId: APP_ID, target: RELEASE_B });
    harness.driver.stageRelease.mockClear();

    const result = await service.rollback({ appId: APP_ID });

    expect(result).toMatchObject({
      operation: 'rollback',
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: {
        selected: RELEASE_A,
        rollbackCandidate: RELEASE_B,
      },
    });
    expect(harness.state.selected).toEqual(RELEASE_A);
    expect(harness.state.previous).toEqual(RELEASE_B);
    expect(harness.state.active).toEqual(RELEASE_A);
    expect(harness.driver.stageRelease).not.toHaveBeenCalled();
  });

  it('leaves a failed first install resumable and completes it on recovery', async () => {
    const harness = await createHarness();
    harness.state.failedArtifacts.add(RELEASE_A.artifactId);
    const service = harness.createService();

    const failed = await service.install({ appId: APP_ID, target: RELEASE_A });
    expect(failed).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.PENDING,
      settledOutcome: LocalApplicationSystemdActivationSettledOutcome.IN_FLIGHT,
      reason: 'activation-failed',
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVATING,
        selected: RELEASE_A,
      },
    });
    expect(harness.state.active).toBeNull();

    harness.state.failedArtifacts.delete(RELEASE_A.artifactId);
    harness.driver.stageRelease.mockClear();
    const recovered = await service.recover({ appId: APP_ID });
    expect(recovered.settledOutcome).toBe(
      LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
    );
    expect(recovered.activation.selected).toEqual(RELEASE_A);
    expect(harness.state.active).toEqual(RELEASE_A);
    expect(harness.driver.stageRelease).not.toHaveBeenCalled();
  });

  it('replaces a failed first-install target after staging its new bytes', async () => {
    const harness = await createHarness();
    harness.state.failedArtifacts.add(RELEASE_A.artifactId);
    const service = harness.createService();
    await service.install({ appId: APP_ID, target: RELEASE_A });
    harness.state.failedArtifacts.delete(RELEASE_A.artifactId);

    const result = await service.install({ appId: APP_ID, target: RELEASE_B });

    expect(result).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: {
        phase: LocalApplicationActivationPhase.ACTIVE,
        selected: RELEASE_B,
        rollbackCandidate: null,
      },
    });
    expect(harness.state.staged).toContain(RELEASE_B.artifactId);
    expect(harness.state.active).toEqual(RELEASE_B);
  });

  it('requires exact active-runtime proof before completing activation', async () => {
    const harness = await createHarness();
    const service = harness.createService();
    harness.driver.verifyActiveRelease.mockRejectedValueOnce(
      new Error('runtime identity unavailable'),
    );

    await expect(
      service.install({ appId: APP_ID, target: RELEASE_A }),
    ).rejects.toThrow('runtime identity unavailable');
    await expect(
      harness.activation.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      phase: LocalApplicationActivationPhase.ACTIVATING,
      selected: RELEASE_A,
    });

    await expect(service.recover({ appId: APP_ID })).resolves.toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: { selected: RELEASE_A },
    });
  });

  it('fails closed when physical service state exists without durable activation', async () => {
    const harness = await createHarness();
    harness.state.selected = RELEASE_A;

    await expect(
      harness.createService().status({ appId: APP_ID }),
    ).rejects.toThrow(
      'physical service state exists without durable activation',
    );
    expect(harness.driver.verifyAbsent).toHaveBeenCalledTimes(1);
    expect(harness.state.held).toBe(false);
  });

  it('locks status, verifies ACTIVE projections, and rejects extra input', async () => {
    const harness = await createHarness();
    const service = harness.createService();
    await expect(service.status({ appId: APP_ID })).resolves.toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome: LocalApplicationSystemdActivationSettledOutcome.ABSENT,
    });
    await service.install({ appId: APP_ID, target: RELEASE_A });
    harness.driver.verifyActiveRelease.mockClear();

    const status = await service.status({ appId: APP_ID });
    expect(status).toMatchObject({
      requestStatus: LocalApplicationSystemdActivationRequestStatus.FULFILLED,
      settledOutcome:
        LocalApplicationSystemdActivationSettledOutcome.TARGET_ACTIVE,
      activation: { selected: RELEASE_A },
    });
    expect(harness.driver.verifyActiveRelease).toHaveBeenCalledTimes(1);
    await expect(
      service.install({ appId: APP_ID, target: RELEASE_A, extra: true }),
    ).rejects.toThrow('systemd install.extra is unsupported');
    expect(harness.state.held).toBe(false);
  });
});
