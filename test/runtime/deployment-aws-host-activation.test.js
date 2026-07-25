import { beforeAll, describe, expect, it } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS,
  createAwsSingleNodeHostActivationKernel,
  validateAwsSingleNodeHostActivationFence,
  validateAwsSingleNodeHostActivationState,
} from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationReceiptContext,
} from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getDeploymentServiceHealthObjectLocation } from '../../src/core/runtime/deployment-service-health.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  makeHealthReceipt,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */
/** @typedef {'success'|'throw-before'|'throw-after'} EffectMode */
/**
 * @typedef StepHarnessOptions
 * @property {Readonly<AnyRecord>} request - Exact activation request.
 * @property {Readonly<AnyRecord>} healthFixture - Matching health fixture.
 * @property {AnyRecord[]} [events] - Optional cross-surface event ledger.
 */
/**
 * @typedef MemoryStoreHooks
 * @property {AnyRecord[]} [events] - Optional cross-surface event ledger.
 * @property {(input: AnyRecord, current: AnyRecord|null, call: number) => boolean|void} [beforeStateWrite] - Hook before a state CAS commits.
 * @property {(input: AnyRecord, current: AnyRecord|null, call: number) => void} [afterStateWrite] - Hook after a state CAS commits.
 * @property {(input: AnyRecord, current: AnyRecord|null, call: number) => boolean|void} [beforeFenceWrite] - Hook before a fence CAS commits.
 * @property {(input: AnyRecord, current: AnyRecord|null, call: number) => void} [afterFenceWrite] - Hook after a fence CAS commits.
 */

const STEP_KEYS = Object.freeze([
  'runtimeIdentity',
  'applicationStorage',
  'controlStorage',
  'artifactProjection',
  'serviceConvergence',
  'healthPublication',
]);
const MUTATING_STEP_KEYS = Object.freeze(STEP_KEYS.slice(1));

/** @type {Readonly<AnyRecord>} */
let fixture;
/** @type {Readonly<AnyRecord>} */
let request;

beforeAll(() => {
  fixture = makeFixture();
  request = createAwsSingleNodeHostActivationRequest(fixture.requestContext);
});

/** @template T @param {T} value @returns {T} */
function frozenClone(value) {
  const copy = clone(value);
  /** @param {any} candidate @returns {any} */
  function freeze(candidate) {
    if (candidate === null || typeof candidate !== 'object') return candidate;
    for (const child of Object.values(candidate)) freeze(child);
    return Object.freeze(candidate);
  }
  return freeze(copy);
}

/** @param {unknown} value @param {Readonly<string[]>} keys @param {string} path @returns {AnyRecord} */
function exactTestObject(value, keys, path) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  const candidate = /** @type {AnyRecord} */ (value);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${path} must contain exactly ${expected.join(', ')}.`);
  }
  return candidate;
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameCanonicalJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * @param {Readonly<AnyRecord>} activationRequest
 * @param {Readonly<AnyRecord>} healthFixture
 * @returns {Readonly<AnyRecord>}
 */
function healthEvidence(activationRequest, healthFixture) {
  const receipt = makeHealthReceipt(healthFixture, {
    providerScopeId: activationRequest.providerScope.providerScopeId,
    providerSpecId: activationRequest.providerSpecId,
    deploymentInstanceId: activationRequest.deploymentInstanceId,
    incarnationId: activationRequest.incarnationId,
    deploymentOperationId: activationRequest.deploymentOperationId,
    authorizedHeadId: activationRequest.authorizedHeadId,
    authorizedHeadGeneration: activationRequest.authorizedHeadGeneration,
    nodeBindingId: activationRequest.nodeBindingId,
    nodeProviderResourceId: activationRequest.nodeProviderResourceId,
    runtimeRoleBindingId: activationRequest.runtimeRoleBindingId,
    runtimeRoleId: activationRequest.runtimeRoleId,
    deploymentRevisionId: activationRequest.deploymentRevisionId,
    appId: activationRequest.appId,
    artifactId: activationRequest.artifactId,
    revisionId: activationRequest.revisionId,
  });
  const location = getDeploymentServiceHealthObjectLocation(
    activationRequest.providerScope,
    receipt,
  );
  return frozenClone({
    receipt,
    object: {
      bucketName: location.bucketName,
      key: location.key,
      versionId: 'health-version-1',
      etag: '"health-etag-1"',
      lastModifiedAt: 1_735_689_600_000,
    },
  });
}

/**
 * @param {string} key
 * @param {Readonly<AnyRecord>} activationRequest
 * @param {Readonly<AnyRecord>} healthFixture
 * @param {number} [version]
 * @returns {Readonly<AnyRecord>}
 */
function stepEvidence(key, activationRequest, healthFixture, version = 1) {
  if (key === 'healthPublication') {
    return healthEvidence(activationRequest, healthFixture);
  }
  return frozenClone({
    schemaVersion: 1,
    kind: 'testAwsSingleNodeHostActivationStepEvidence',
    requestId: activationRequest.requestId,
    step: key,
    proof: version === 1 ? 'settled' : `settled-${version}`,
  });
}

/**
 * @param {StepHarnessOptions} options
 * @returns {{steps: Readonly<AnyRecord>, calls: AnyRecord[], converged: Map<string, boolean>, setObservation: (key: string, observation: AnyRecord|((input: AnyRecord) => AnyRecord|Promise<AnyRecord>)) => void, setEffectMode: (key: string, mode: EffectMode) => void, setEffectAction: (key: string, action: (input: AnyRecord) => void|Promise<void>) => void, setEvidenceVersion: (key: string, version: number) => void}}
 */
function createStepHarness(options) {
  const activationRequest = options.request;
  const healthFixture = options.healthFixture;
  const events = options.events ?? [];
  /** @type {AnyRecord[]} */
  const calls = [];
  /** @type {Map<string, boolean>} */
  const converged = new Map(MUTATING_STEP_KEYS.map((key) => [key, false]));
  /** @type {Map<string, AnyRecord|((input: AnyRecord) => AnyRecord|Promise<AnyRecord>)>} */
  const observations = new Map();
  /** @type {Map<string, EffectMode>} */
  const effectModes = new Map();
  /** @type {Map<string, (input: AnyRecord) => void|Promise<void>>} */
  const effectActions = new Map();
  /** @type {Map<string, number>} */
  const evidenceVersions = new Map();

  /** @param {string} key @param {unknown} value @returns {Readonly<AnyRecord>} */
  function validateEvidence(key, value) {
    calls.push({ method: 'validateEvidence', key });
    const evidence = /** @type {AnyRecord} */ (frozenClone(value));
    if (key === 'healthPublication') {
      const expected = stepEvidence(key, activationRequest, healthFixture);
      exactTestObject(
        evidence,
        ['object', 'receipt'],
        'health publication evidence',
      );
      exactTestObject(
        evidence.object,
        ['bucketName', 'etag', 'key', 'lastModifiedAt', 'versionId'],
        'health publication projection',
      );
      if (!sameCanonicalJson(evidence, expected)) {
        throw new TypeError(
          `${key} evidence does not match its exact request.`,
        );
      }
      return evidence;
    }
    exactTestObject(
      evidence,
      ['schemaVersion', 'kind', 'requestId', 'step', 'proof'],
      `${key} evidence`,
    );
    if (
      evidence.schemaVersion !== 1 ||
      evidence.kind !== 'testAwsSingleNodeHostActivationStepEvidence' ||
      evidence.requestId !== activationRequest.requestId ||
      evidence.step !== key ||
      typeof evidence.proof !== 'string' ||
      !/^settled(?:-[2-9][0-9]*)?$/.test(evidence.proof)
    ) {
      throw new TypeError(`${key} evidence does not match its exact request.`);
    }
    return evidence;
  }

  /** @param {string} key @param {AnyRecord} input @returns {Promise<Readonly<AnyRecord>>} */
  async function observe(key, input) {
    calls.push({ method: 'observe', key, input });
    events.push({
      surface: 'step',
      action: 'observe',
      key,
      phase: converged.get(key) === true ? 'post-effect' : 'pre-effect',
    });
    const override = observations.get(key);
    if (override !== undefined) {
      return /** @type {Readonly<AnyRecord>} */ (
        frozenClone(
          typeof override === 'function' ? await override(input) : override,
        )
      );
    }
    if (key === 'runtimeIdentity' || converged.get(key) === true) {
      return frozenClone({
        status: 'settled',
        evidence: stepEvidence(
          key,
          activationRequest,
          healthFixture,
          evidenceVersions.get(key) ?? 1,
        ),
      });
    }
    return Object.freeze({ status: 'ready' });
  }

  /** @param {string} key @param {AnyRecord} input @returns {Promise<AnyRecord>} */
  async function converge(key, input) {
    calls.push({ method: 'converge', key, input });
    events.push({ surface: 'step', action: 'converge', key });
    const mode = effectModes.get(key) ?? 'success';
    if (mode === 'throw-before') {
      throw new Error(`simulated ${key} failure before mutation`);
    }
    converged.set(key, true);
    await effectActions.get(key)?.(input);
    if (mode === 'throw-after') {
      throw new Error(`simulated ${key} response loss after mutation`);
    }
    // Deliberately forged: mutation return values are not settlement evidence.
    return {
      status: 'settled',
      evidence: { forgedFromMutationResponse: key },
    };
  }

  /** @type {AnyRecord} */
  const steps = {
    runtimeIdentity: {
      observe: (/** @type {AnyRecord} */ input) =>
        observe('runtimeIdentity', input),
      validateEvidence: (/** @type {unknown} */ value) =>
        validateEvidence('runtimeIdentity', value),
    },
  };
  for (const key of MUTATING_STEP_KEYS) {
    steps[key] = {
      observe: (/** @type {AnyRecord} */ input) => observe(key, input),
      converge: (/** @type {AnyRecord} */ input) => converge(key, input),
      validateEvidence: (/** @type {unknown} */ value) =>
        validateEvidence(key, value),
    };
  }

  return {
    steps: Object.freeze(steps),
    calls,
    converged,
    setObservation(key, observation) {
      observations.set(key, observation);
    },
    setEffectMode(key, mode) {
      effectModes.set(key, mode);
    },
    setEffectAction(key, action) {
      effectActions.set(key, action);
    },
    setEvidenceVersion(key, version) {
      evidenceVersions.set(key, version);
    },
  };
}

/**
 * @param {MemoryStoreHooks} [hooks]
 * @returns {Readonly<{store: Readonly<AnyRecord>, calls: AnyRecord[], fences: Map<string, AnyRecord>, states: Map<string, AnyRecord>}>}
 */
function createMemoryStore(hooks = {}) {
  const events = hooks.events ?? [];
  /** @type {Map<string, AnyRecord>} */
  const fences = new Map();
  /** @type {Map<string, AnyRecord>} */
  const states = new Map();
  /** @type {AnyRecord[]} */
  const calls = [];
  let stateCasCalls = 0;
  let fenceCasCalls = 0;
  const store = Object.freeze({
    async readActivationFence(/** @type {string} */ deploymentInstanceId) {
      calls.push({ method: 'readActivationFence', deploymentInstanceId });
      return fences.has(deploymentInstanceId)
        ? frozenClone(fences.get(deploymentInstanceId))
        : null;
    },
    async compareAndSetActivationFence(/** @type {AnyRecord} */ input) {
      fenceCasCalls += 1;
      calls.push({
        method: 'compareAndSetActivationFence',
        input: frozenClone(input),
      });
      const current = fences.get(input.deploymentInstanceId) ?? null;
      if ((current?.fenceId ?? null) !== input.expectedFenceId) return false;
      if (hooks.beforeFenceWrite?.(input, current, fenceCasCalls) === false) {
        return false;
      }
      fences.set(input.deploymentInstanceId, frozenClone(input.nextFence));
      events.push({
        surface: 'store',
        action: 'fence-cas-commit',
        current,
        next: input.nextFence,
      });
      hooks.afterFenceWrite?.(input, current, fenceCasCalls);
      return true;
    },
    async readActivationState(/** @type {string} */ requestId) {
      calls.push({ method: 'readActivationState', requestId });
      return states.has(requestId) ? frozenClone(states.get(requestId)) : null;
    },
    async compareAndSetActivationState(/** @type {AnyRecord} */ input) {
      stateCasCalls += 1;
      calls.push({
        method: 'compareAndSetActivationState',
        input: frozenClone(input),
      });
      const current = states.get(input.requestId) ?? null;
      if ((current?.stateId ?? null) !== input.expectedStateId) return false;
      if (hooks.beforeStateWrite?.(input, current, stateCasCalls) === false) {
        return false;
      }
      states.set(input.requestId, frozenClone(input.nextState));
      events.push({
        surface: 'store',
        action: 'state-cas-commit',
        current,
        next: input.nextState,
      });
      hooks.afterStateWrite?.(input, current, stateCasCalls);
      return true;
    },
  });
  return Object.freeze({ store, calls, fences, states });
}

/** @returns {{withHostLock: Function, calls: AnyRecord[]}} */
function createHostLock() {
  /** @type {AnyRecord[]} */
  const calls = [];
  /**
   * @param {AnyRecord} identity
   * @param {() => Promise<any>} operation
   * @returns {Promise<any>}
   */
  async function withHostLock(identity, operation) {
    calls.push([identity]);
    return await operation();
  }
  return {
    calls,
    withHostLock,
  };
}

/**
 * @param {Readonly<AnyRecord>} authorizedRequest
 * @param {boolean} [initiallyAuthorized]
 * @returns {{authorizeRequest: Function, calls: AnyRecord[], setAuthorized: (value: boolean) => void}}
 */
function createAuthorityHarness(authorizedRequest, initiallyAuthorized = true) {
  /** @type {AnyRecord[]} */
  const calls = [];
  let authorized = initiallyAuthorized;

  /** @param {unknown} value @returns {Promise<boolean>} */
  async function authorizeRequest(value) {
    const input = exactTestObject(
      value,
      ['purpose', 'receipt', 'request', 'step'],
      'activation authorization input',
    );
    if (
      !Object.isFrozen(input) ||
      !Object.isFrozen(input.request) ||
      !['claim', 'dispatch', 'settle', 'replay'].includes(input.purpose) ||
      (input.purpose === 'dispatch'
        ? !Object.values(AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS).includes(
            input.step,
          )
        : input.step !== null) ||
      (input.purpose === 'replay'
        ? input.receipt?.requestId !== input.request.requestId
        : input.receipt !== null)
    ) {
      throw new TypeError('activation authorization input is not exact.');
    }
    calls.push(frozenClone(input));
    return authorized && sameCanonicalJson(input.request, authorizedRequest);
  }

  return {
    authorizeRequest,
    calls,
    setAuthorized(value) {
      authorized = value;
    },
  };
}

/**
 * @param {Readonly<AnyRecord>} store
 * @param {Readonly<AnyRecord>} steps
 * @param {Readonly<AnyRecord>} authorizedRequest
 * @param {ReturnType<typeof createHostLock>} [lock]
 * @param {ReturnType<typeof createAuthorityHarness>} [authority]
 */
function createKernel(
  store,
  steps,
  authorizedRequest,
  lock = createHostLock(),
  authority = createAuthorityHarness(authorizedRequest),
) {
  return {
    kernel: createAwsSingleNodeHostActivationKernel({
      store,
      withHostLock: lock.withHostLock,
      authorizeRequest: authority.authorizeRequest,
      steps,
    }),
    lock,
    authority,
  };
}

/**
 * Rehash one generic stored observation and its enclosing state. This makes
 * the generic content-addressed validators pass so the configured step's
 * stricter semantic validator remains the boundary under test.
 * @param {Readonly<AnyRecord>} value
 * @param {number} stepIndex
 * @param {Readonly<AnyRecord>} evidenceValue
 * @returns {Readonly<AnyRecord>}
 */
function reidentifyStateEvidence(value, stepIndex, evidenceValue) {
  const state = /** @type {AnyRecord} */ (clone(value));
  const step = state.steps[stepIndex];
  step.evidence.value = clone(evidenceValue);
  step.evidence.observationId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_PREFIX,
    value: {
      requestId: state.request.requestId,
      intentId: step.intentId,
      value: step.evidence.value,
    },
  });
  delete state.stateId;
  state.stateId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
    value: state,
  });
  return frozenClone(state);
}

describe('AWS single-node durable host activation', () => {
  it('settles every step in order from observations and ignores mutation returns', async () => {
    /** @type {AnyRecord[]} */
    const events = [];
    const memory = createMemoryStore({ events });
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
      events,
    });
    const { kernel, lock } = createKernel(memory.store, harness.steps, request);

    const result = await kernel.converge(request);
    const state = await kernel.inspect({ requestId: request.requestId });

    expect(result.status).toBe('succeeded');
    expect(result.requestId).toBe(request.requestId);
    expect(result.receipt.requestId).toBe(request.requestId);
    expect(state.status).toBe('succeeded');
    expect(state.receipt).toEqual(result.receipt);
    expect(state.steps).toHaveLength(STEP_KEYS.length);
    expect(
      state.steps.map((/** @type {AnyRecord} */ step) => step.kind),
    ).toEqual(Object.values(AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS));
    expect(
      state.steps.every(
        (/** @type {AnyRecord} */ step) => step.status === 'settled',
      ),
    ).toBe(true);
    expect(
      harness.calls
        .filter((call) => call.method === 'converge')
        .map((call) => call.key),
    ).toEqual(MUTATING_STEP_KEYS);
    for (const key of STEP_KEYS) {
      expect(
        harness.calls.some(
          (call) => call.method === 'validateEvidence' && call.key === key,
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(state).includes('forgedFromMutationResponse')).toBe(
      false,
    );
    expect(lock.calls).toHaveLength(1);
    expectDeepFrozen(result);
    expectDeepFrozen(state);
    validateAwsSingleNodeHostActivationState(state);
    validateAwsSingleNodeHostActivationFence(
      memory.fences.get(request.deploymentInstanceId),
    );
    for (const currentHead of [fixture.head, fixture.readyHead]) {
      expect(
        validateAwsSingleNodeHostActivationReceiptContext(result.receipt, {
          request,
          requestContext: fixture.requestContext,
          currentHead,
        }).receiptId,
      ).toBe(result.receipt.receiptId);
    }

    const intendedIndex = events.findIndex(
      (event) =>
        event.action === 'state-cas-commit' &&
        event.current?.steps?.[1]?.status === 'pending' &&
        event.next?.steps?.[1]?.status === 'intended',
    );
    const effectIndex = events.findIndex(
      (event) =>
        event.action === 'converge' && event.key === 'applicationStorage',
    );
    const postObserveIndex = events.findIndex(
      (event) =>
        event.action === 'observe' &&
        event.key === 'applicationStorage' &&
        event.phase === 'post-effect',
    );
    const settlementIndex = events.findIndex(
      (event) =>
        event.action === 'state-cas-commit' &&
        event.current?.steps?.[1]?.status === 'intended' &&
        event.next?.steps?.[1]?.status === 'settled',
    );
    expect(intendedIndex).toBeGreaterThanOrEqual(0);
    expect(effectIndex).toBeGreaterThan(intendedIndex);
    expect(postObserveIndex).toBeGreaterThan(effectIndex);
    expect(settlementIndex).toBeGreaterThan(postObserveIndex);
  });

  it('settles across mutation and settlement-CAS response loss', async () => {
    let lostSettlementResponse = false;
    const memory = createMemoryStore({
      afterStateWrite(input, current) {
        if (
          !lostSettlementResponse &&
          current?.steps?.[3]?.status === 'intended' &&
          input.nextState.steps[3]?.status === 'settled'
        ) {
          lostSettlementResponse = true;
          throw new Error('simulated settlement CAS response loss');
        }
      },
    });
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setEffectMode('artifactProjection', 'throw-after');
    const { kernel } = createKernel(memory.store, harness.steps, request);

    const result = await kernel.converge(request);

    expect(result.status).toBe('succeeded');
    expect(lostSettlementResponse).toBe(true);
    expect(
      harness.calls.filter(
        (call) =>
          call.method === 'converge' && call.key === 'artifactProjection',
      ),
    ).toHaveLength(1);
    expect(
      harness.calls.filter(
        (call) =>
          call.method === 'observe' && call.key === 'artifactProjection',
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('keeps a throw-before effect intended and uses a later attempt to recover', async () => {
    const memory = createMemoryStore();
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setEffectMode('applicationStorage', 'throw-before');
    const { kernel } = createKernel(memory.store, harness.steps, request);

    await expect(kernel.converge(request)).rejects.toMatchObject({
      name: 'AwsSingleNodeHostActivationEffectError',
      step: 'application-storage',
    });
    const interrupted = await kernel.inspect({
      requestId: request.requestId,
    });
    expect(interrupted.steps[1]).toMatchObject({
      kind: 'application-storage',
      status: 'intended',
      attemptGeneration: 1,
    });
    expect(harness.converged.get('applicationStorage')).toBe(false);

    harness.setEffectMode('applicationStorage', 'success');
    const recovered = await kernel.resume({ requestId: request.requestId });

    expect(recovered.status).toBe('succeeded');
    const applicationEffects = harness.calls.filter(
      (call) => call.method === 'converge' && call.key === 'applicationStorage',
    );
    expect(applicationEffects).toHaveLength(2);
    expect(
      applicationEffects.map((call) => call.input.step.attemptGeneration),
    ).toEqual([1, 2]);
  });

  it('keeps an intended step pending on unknown evidence without mutating', async () => {
    const memory = createMemoryStore();
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setObservation('applicationStorage', { status: 'unknown' });
    const { kernel } = createKernel(memory.store, harness.steps, request);

    const result = await kernel.converge(request);
    const state = await kernel.inspect({ requestId: request.requestId });

    expect(result.status).toBe('pending');
    expect(result.step).toBe('application-storage');
    expect(state.status).toBe('running');
    expect(state.steps[1]).toMatchObject({
      kind: 'application-storage',
      status: 'intended',
    });
    expect(
      harness.calls.some(
        (call) =>
          call.method === 'converge' && call.key === 'applicationStorage',
      ),
    ).toBe(false);
  });

  it('durably blocks conflict evidence and never mutates through it', async () => {
    const memory = createMemoryStore();
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setObservation('controlStorage', { status: 'conflict' });
    const { kernel } = createKernel(memory.store, harness.steps, request);

    const result = await kernel.converge(request);
    const state = await kernel.inspect({ requestId: request.requestId });

    expect(result.status).toBe('blocked');
    expect(result.step).toBe('control-storage');
    expect(state.status).toBe('blocked');
    expect(state.steps[2]).toMatchObject({
      kind: 'control-storage',
      status: 'intended',
    });
    expect(state.block).toEqual({
      reason: 'observation-conflict',
      step: 'control-storage',
    });
    expect(
      harness.calls.some(
        (call) => call.method === 'converge' && call.key === 'controlStorage',
      ),
    ).toBe(false);
  });

  it('uses a fresh definite attempt after an intent CAS response is lost', async () => {
    let threw = false;
    const memory = createMemoryStore({
      afterStateWrite(input, current) {
        if (
          !threw &&
          current !== null &&
          current.steps[1]?.status === 'pending' &&
          input.nextState.steps[1]?.status === 'intended'
        ) {
          threw = true;
          throw new Error('simulated intent CAS response loss');
        }
      },
    });
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    const { kernel } = createKernel(memory.store, harness.steps, request);

    const result = await kernel.converge(request);

    expect(threw).toBe(true);
    expect(result.status).toBe('succeeded');
    const applicationEffects = harness.calls.filter(
      (call) => call.method === 'converge' && call.key === 'applicationStorage',
    );
    expect(applicationEffects).toHaveLength(1);
    expect(applicationEffects[0].input.step).toMatchObject({
      kind: 'application-storage',
      attemptGeneration: 1,
    });
    const state = await kernel.inspect({ requestId: request.requestId });
    expect(state.steps[1]).toMatchObject({
      kind: 'application-storage',
      status: 'settled',
      attemptGeneration: 1,
    });
    expect(
      memory.calls.some(
        (call) =>
          call.method === 'compareAndSetActivationState' &&
          call.input.nextState.steps[1]?.attemptGeneration === 1,
      ),
    ).toBe(true);
  });

  it('requires a definite recovery-attempt CAS before replay dispatch', async () => {
    let loseNextStateWrite = false;
    const memory = createMemoryStore({
      afterStateWrite() {
        if (loseNextStateWrite) {
          loseNextStateWrite = false;
          throw new Error('simulated recovery-attempt CAS response loss');
        }
      },
    });
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setObservation('applicationStorage', { status: 'unknown' });
    const { kernel } = createKernel(memory.store, harness.steps, request);
    expect((await kernel.converge(request)).status).toBe('pending');

    harness.setObservation('applicationStorage', (input) =>
      harness.converged.get('applicationStorage')
        ? {
            status: 'settled',
            evidence: stepEvidence('applicationStorage', request, fixture),
          }
        : { status: 'ready' },
    );
    loseNextStateWrite = true;
    const lostClaim = await kernel.resume({ requestId: request.requestId });

    expect(lostClaim.status).toBe('succeeded');
    const effects = harness.calls.filter(
      (call) => call.method === 'converge' && call.key === 'applicationStorage',
    );
    expect(effects).toHaveLength(1);
    expect(effects[0].input.step.attemptGeneration).toBe(2);
  });

  it('never dispatches after a rejected or failed pre-commit intent CAS', async () => {
    for (const mode of /** @type {const} */ (['reject', 'throw'])) {
      let intercepted = false;
      const memory = createMemoryStore({
        beforeStateWrite(input, current) {
          if (
            !intercepted &&
            current?.steps?.[1]?.status === 'pending' &&
            input.nextState.steps[1]?.status === 'intended'
          ) {
            intercepted = true;
            if (mode === 'throw') {
              throw new Error('simulated pre-commit store failure');
            }
            return false;
          }
        },
      });
      const harness = createStepHarness({
        request,
        healthFixture: fixture,
      });
      const { kernel } = createKernel(memory.store, harness.steps, request);

      await expect(kernel.converge(request)).rejects.toBeDefined();

      expect(intercepted).toBe(true);
      expect(
        harness.calls.some(
          (call) =>
            call.method === 'converge' && call.key === 'applicationStorage',
        ),
      ).toBe(false);
      const state = await kernel.inspect({ requestId: request.requestId });
      expect(state.steps[1]).toMatchObject({
        kind: 'application-storage',
        status: 'pending',
        attemptGeneration: 0,
      });
    }
  });

  it('resumes a durable request after the first fence CAS fails before commit', async () => {
    let rejectFence = true;
    const memory = createMemoryStore({
      beforeFenceWrite() {
        if (rejectFence) {
          throw new Error('simulated pre-commit fence store failure');
        }
      },
    });
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    const { kernel, authority } = createKernel(
      memory.store,
      harness.steps,
      request,
    );

    await expect(kernel.converge(request)).rejects.toThrow(
      'simulated pre-commit fence store failure',
    );

    const durable = memory.states.get(request.requestId);
    expect(durable?.request).toEqual(request);
    expect(durable?.status).toBe('running');
    expect(memory.fences.has(request.deploymentInstanceId)).toBe(false);
    expect(
      harness.calls.some(
        (call) => call.method === 'observe' || call.method === 'converge',
      ),
    ).toBe(false);
    expect(authority.calls.map((call) => call.purpose)).toEqual(['claim']);

    rejectFence = false;
    const result = await kernel.resume({ requestId: request.requestId });

    expect(result.status).toBe('succeeded');
    expect(memory.fences.get(request.deploymentInstanceId)?.requestId).toBe(
      request.requestId,
    );
    expect(authority.calls.map((call) => call.purpose)).toEqual([
      'claim',
      'claim',
      ...MUTATING_STEP_KEYS.map(() => 'dispatch'),
      'settle',
    ]);
  });

  it('freshly observes settled prerequisites on resume without reconverging them', async () => {
    const memory = createMemoryStore();
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setObservation('controlStorage', { status: 'unknown' });
    const { kernel } = createKernel(memory.store, harness.steps, request);
    expect((await kernel.converge(request)).status).toBe('pending');
    const applicationObservationsBefore = harness.calls.filter(
      (call) => call.method === 'observe' && call.key === 'applicationStorage',
    ).length;
    expect(
      harness.calls.filter(
        (call) =>
          call.method === 'converge' && call.key === 'applicationStorage',
      ),
    ).toHaveLength(1);

    harness.setObservation('controlStorage', (input) =>
      harness.converged.get('controlStorage')
        ? {
            status: 'settled',
            evidence: stepEvidence('controlStorage', request, fixture),
          }
        : { status: 'ready' },
    );
    const resumed = await kernel.resume({ requestId: request.requestId });

    expect(resumed.status).toBe('succeeded');
    expect(
      harness.calls.filter(
        (call) =>
          call.method === 'observe' && call.key === 'applicationStorage',
      ).length,
    ).toBeGreaterThan(applicationObservationsBefore);
    expect(
      harness.calls.filter(
        (call) =>
          call.method === 'converge' && call.key === 'applicationStorage',
      ),
    ).toHaveLength(1);
  });

  it('reobserves and repairs upstream evidence invalidated by a later mutator', async () => {
    const memory = createMemoryStore();
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    let invalidated = false;
    harness.setEffectAction('controlStorage', () => {
      if (!invalidated) {
        invalidated = true;
        harness.converged.set('applicationStorage', false);
      }
    });
    const { kernel } = createKernel(memory.store, harness.steps, request);

    const result = await kernel.converge(request);

    expect(result.status).toBe('succeeded');
    expect(invalidated).toBe(true);
    const applicationAttempts = harness.calls
      .filter(
        (call) =>
          call.method === 'converge' && call.key === 'applicationStorage',
      )
      .map((call) => call.input.step.attemptGeneration);
    const controlAttempts = harness.calls
      .filter(
        (call) => call.method === 'converge' && call.key === 'controlStorage',
      )
      .map((call) => call.input.step.attemptGeneration);
    expect(applicationAttempts).toEqual([1, 2]);
    expect(controlAttempts).toEqual([1]);
    const state = await kernel.inspect({ requestId: request.requestId });
    expect(state.status).toBe('succeeded');
    expect(
      state.steps.every(
        (/** @type {AnyRecord} */ step) => step.status === 'settled',
      ),
    ).toBe(true);
  });

  it('preserves downstream attempt generation when changed upstream evidence resets the suffix', async () => {
    const memory = createMemoryStore();
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    harness.setEffectMode('controlStorage', 'throw-before');
    const { kernel } = createKernel(memory.store, harness.steps, request);
    await expect(kernel.converge(request)).rejects.toMatchObject({
      name: 'AwsSingleNodeHostActivationEffectError',
      step: 'control-storage',
    });
    const interrupted = await kernel.inspect({
      requestId: request.requestId,
    });
    expect(interrupted.steps[2].attemptGeneration).toBe(1);

    harness.setEffectMode('controlStorage', 'success');
    harness.setEvidenceVersion('applicationStorage', 2);
    const result = await kernel.resume({ requestId: request.requestId });

    expect(result.status).toBe('succeeded');
    const attempts = harness.calls
      .filter(
        (call) => call.method === 'converge' && call.key === 'controlStorage',
      )
      .map((call) => call.input.step.attemptGeneration);
    expect(attempts).toEqual([1, 2]);
    expect(attempts.filter((generation) => generation === 1)).toHaveLength(1);
  });

  it('resumes by request ID and replays one terminal receipt without effects', async () => {
    let lostTerminalResponse = false;
    const memory = createMemoryStore({
      afterStateWrite(input) {
        if (!lostTerminalResponse && input.nextState.status === 'succeeded') {
          lostTerminalResponse = true;
          throw new Error('simulated terminal CAS response loss');
        }
      },
    });
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    const { kernel } = createKernel(memory.store, harness.steps, request);
    const completed = await kernel.converge(request);
    const effectCallCount = harness.calls.filter(
      (call) => call.method === 'observe' || call.method === 'converge',
    ).length;

    expect(lostTerminalResponse).toBe(true);
    const inspected = await kernel.inspect({ requestId: request.requestId });
    const resumed = await kernel.resume({ requestId: request.requestId });
    const replayed = await kernel.converge(request);

    expect(inspected.status).toBe('succeeded');
    expect(inspected.stateId).toBe(completed.stateId);
    expect(inspected.receipt).toEqual(completed.receipt);
    expect(resumed).toEqual(completed);
    expect(replayed).toEqual(completed);
    expect(
      harness.calls.filter(
        (call) => call.method === 'observe' || call.method === 'converge',
      ),
    ).toHaveLength(effectCallCount);
  });

  it('requires current authority before a higher generation supersedes an active or blocked request', async () => {
    for (const currentStatus of /** @type {const} */ (['pending', 'blocked'])) {
      const memory = createMemoryStore();
      const currentHarness = createStepHarness({
        request,
        healthFixture: fixture,
      });
      currentHarness.setObservation(
        'applicationStorage',
        currentStatus === 'pending'
          ? { status: 'unknown' }
          : { status: 'conflict' },
      );
      const currentKernel = createKernel(
        memory.store,
        currentHarness.steps,
        request,
      ).kernel;
      expect((await currentKernel.converge(request)).status).toBe(
        currentStatus,
      );

      const reconcile = makeReconcileFixture(fixture);
      const successorRequest = createAwsSingleNodeHostActivationRequest(
        reconcile.requestContext,
      );
      const successorHarness = createStepHarness({
        request: successorRequest,
        healthFixture: Object.freeze({ ...fixture, head: reconcile.head }),
      });
      const successorAuthority = createAuthorityHarness(
        successorRequest,
        false,
      );
      const successorKernel = createKernel(
        memory.store,
        successorHarness.steps,
        successorRequest,
        createHostLock(),
        successorAuthority,
      ).kernel;

      await expect(
        successorKernel.converge(successorRequest),
      ).rejects.toMatchObject({
        name: 'AwsSingleNodeHostActivationConflictError',
        reason: 'request-not-authorized',
      });
      expect(successorAuthority.calls).toHaveLength(1);
      expect(successorAuthority.calls[0]).toMatchObject({
        purpose: 'claim',
        request: { requestId: successorRequest.requestId },
        step: null,
      });
      expect(
        successorHarness.calls.some(
          (call) => call.method === 'observe' || call.method === 'converge',
        ),
      ).toBe(false);
      expect(memory.fences.get(request.deploymentInstanceId)?.requestId).toBe(
        request.requestId,
      );

      successorAuthority.setAuthorized(true);
      expect((await successorKernel.converge(successorRequest)).status).toBe(
        'succeeded',
      );
      expect(memory.fences.get(request.deploymentInstanceId)?.requestId).toBe(
        successorRequest.requestId,
      );
      const oldEffectCalls = currentHarness.calls.filter(
        (call) => call.method === 'observe' || call.method === 'converge',
      ).length;
      await expect(
        currentKernel.resume({ requestId: request.requestId }),
      ).rejects.toMatchObject({
        name: 'AwsSingleNodeHostActivationConflictError',
        reason: 'stale-or-ambiguous-request',
      });
      expect(
        currentHarness.calls.filter(
          (call) => call.method === 'observe' || call.method === 'converge',
        ),
      ).toHaveLength(oldEffectCalls);
    }
  });

  it('lets a higher-generation succeeded request fence an older terminal replay', async () => {
    const memory = createMemoryStore();
    const firstHarness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    const firstKernel = createKernel(
      memory.store,
      firstHarness.steps,
      request,
    ).kernel;
    expect((await firstKernel.converge(request)).status).toBe('succeeded');

    const reconcile = makeReconcileFixture(fixture);
    const successorRequest = createAwsSingleNodeHostActivationRequest(
      reconcile.requestContext,
    );
    expect(successorRequest.authorizedHeadGeneration).toBeGreaterThan(
      request.authorizedHeadGeneration,
    );
    const successorHarness = createStepHarness({
      request: successorRequest,
      healthFixture: Object.freeze({ ...fixture, head: reconcile.head }),
    });
    const successorKernel = createKernel(
      memory.store,
      successorHarness.steps,
      successorRequest,
    ).kernel;
    expect((await successorKernel.converge(successorRequest)).status).toBe(
      'succeeded',
    );
    const oldEffectCalls = firstHarness.calls.filter(
      (call) => call.method === 'observe' || call.method === 'converge',
    ).length;

    await expect(
      firstKernel.resume({ requestId: request.requestId }),
    ).rejects.toMatchObject({
      name: 'AwsSingleNodeHostActivationConflictError',
      reason: 'stale-or-ambiguous-request',
    });
    expect(
      firstHarness.calls.filter(
        (call) => call.method === 'observe' || call.method === 'converge',
      ),
    ).toHaveLength(oldEffectCalls);
    expect(memory.fences.get(request.deploymentInstanceId)?.requestId).toBe(
      successorRequest.requestId,
    );
  });

  it('rejects malformed factories, states, fences, and observer envelopes', async () => {
    const memory = createMemoryStore();
    const store = memory.store;
    const harness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    const validHostLock = createHostLock().withHostLock;
    const validAuthorizeRequest =
      createAuthorityHarness(request).authorizeRequest;
    expect(() =>
      createAwsSingleNodeHostActivationKernel({
        store: {},
        withHostLock: validHostLock,
        authorizeRequest: validAuthorizeRequest,
        steps: harness.steps,
      }),
    ).toThrow();
    expect(() =>
      createAwsSingleNodeHostActivationKernel({
        store,
        withHostLock: null,
        authorizeRequest: validAuthorizeRequest,
        steps: harness.steps,
      }),
    ).toThrow();
    expect(() =>
      createAwsSingleNodeHostActivationKernel({
        store,
        withHostLock: validHostLock,
        authorizeRequest: null,
        steps: harness.steps,
      }),
    ).toThrow();
    expect(() =>
      createAwsSingleNodeHostActivationKernel({
        store,
        withHostLock: validHostLock,
        authorizeRequest: validAuthorizeRequest,
        steps: { ...harness.steps, extra: harness.steps.runtimeIdentity },
      }),
    ).toThrow();
    expect(() =>
      createAwsSingleNodeHostActivationKernel({
        store,
        withHostLock: validHostLock,
        authorizeRequest: validAuthorizeRequest,
        steps: {
          ...harness.steps,
          runtimeIdentity: {
            ...harness.steps.runtimeIdentity,
            converge() {},
          },
        },
      }),
    ).toThrow();

    const { kernel } = createKernel(store, harness.steps, request);
    await kernel.converge(request);
    const state = await kernel.inspect({ requestId: request.requestId });
    expect(() =>
      validateAwsSingleNodeHostActivationState({
        ...clone(state),
        unsupported: true,
      }),
    ).toThrow();
    expect(() =>
      validateAwsSingleNodeHostActivationState({
        ...clone(state),
        recordVersion: state.recordVersion + 1,
      }),
    ).toThrow(/stateId/);
    const fence = memory.fences.get(request.deploymentInstanceId);
    expect(fence).toBeDefined();
    const exactFence = /** @type {AnyRecord} */ (fence);
    expect(() =>
      validateAwsSingleNodeHostActivationFence({
        ...clone(exactFence),
        unsupported: true,
      }),
    ).toThrow();
    expect(() =>
      validateAwsSingleNodeHostActivationFence({
        ...clone(exactFence),
        recordVersion: exactFence.recordVersion + 1,
      }),
    ).toThrow(/fenceId/);
    await expect(
      kernel.inspect({ requestId: request.requestId, unsupported: true }),
    ).rejects.toThrow();
    await expect(
      kernel.resume({ requestId: request.requestId, unsupported: true }),
    ).rejects.toThrow();

    const corrupted = reidentifyStateEvidence(state, 0, {
      ...state.steps[0].evidence.value,
      unsupported: true,
    });
    expect(() =>
      validateAwsSingleNodeHostActivationState(corrupted),
    ).not.toThrow();
    memory.states.set(request.requestId, clone(corrupted));
    await expect(
      kernel.inspect({ requestId: request.requestId }),
    ).rejects.toThrow(/must contain exactly/);

    const extraEvidenceMemory = createMemoryStore();
    const extraEvidenceHarness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    extraEvidenceHarness.setObservation('runtimeIdentity', {
      status: 'settled',
      evidence: {
        ...stepEvidence('runtimeIdentity', request, fixture),
        unsupported: true,
      },
    });
    const extraEvidenceKernel = createKernel(
      extraEvidenceMemory.store,
      extraEvidenceHarness.steps,
      request,
    ).kernel;
    await expect(extraEvidenceKernel.converge(request)).rejects.toThrow(
      /must contain exactly/,
    );

    const invalidMemory = createMemoryStore();
    const invalidHarness = createStepHarness({
      request,
      healthFixture: fixture,
    });
    invalidHarness.setObservation('applicationStorage', {
      status: 'ready',
      evidence: stepEvidence('applicationStorage', request, fixture),
    });
    const invalidKernel = createKernel(
      invalidMemory.store,
      invalidHarness.steps,
      request,
    ).kernel;
    await expect(invalidKernel.converge(request)).rejects.toThrow();
    expect(
      invalidHarness.calls.some(
        (call) =>
          call.method === 'converge' && call.key === 'applicationStorage',
      ),
    ).toBe(false);
  });
});
