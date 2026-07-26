import { describe, expect, it } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationRequest,
} from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  createAwsSingleNodeHostActivationKernel,
  getAwsSingleNodeHostActivationIntentId,
} from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
  createAwsSingleNodeHostControlStorageAdapter,
  validateAwsSingleNodeHostApplicationStorageEvidence,
  validateAwsSingleNodeHostControlStorageEvidence,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
  validateAwsSingleNodeHostRuntimeIdentityEvidence,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import { getDeploymentServiceHealthObjectLocation } from '../../src/core/runtime/deployment-service-health.js';
import { validateDeploymentServiceHealthObservation } from '../../src/core/runtime/deployment-service-health-s3.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  makeHealthReceipt,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const CONTEXT_KEYS = Object.freeze(['priorEvidence', 'request', 'step']);
const STEP_KEYS = Object.freeze(['attemptGeneration', 'intentId', 'kind']);

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {ReadonlyArray<string>} keys @param {string} valuePath @returns {AnyRecord} */
function exactObject(value, keys, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  const object = /** @type {AnyRecord} */ (value);
  if (
    JSON.stringify(Object.keys(object).sort()) !==
    JSON.stringify([...keys].sort())
  ) {
    throw new TypeError(`${valuePath} does not have its exact keys.`);
  }
  return object;
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
function runtimeEvidence(request) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: request.requestId,
    accountId: request.providerScope.accountId,
    userId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
    arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
  });
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
function runtimeContext(request) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        'runtime-identity',
      ),
      kind: 'runtime-identity',
      attemptGeneration: 0,
    },
    priorEvidence: {},
  });
}

/**
 * @param {Readonly<AnyRecord>} desired
 * @returns {Readonly<AnyRecord>}
 */
function storageEvidence(desired) {
  const application = desired.capabilityKind === 'application-state';
  const device = {
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: desired.volumeProviderResourceId,
    path: application ? '/dev/nvme1n1' : '/dev/nvme2n1',
    major: 259,
    minor: application ? 1 : 2,
  };
  return deepFreeze({
    ...clone(desired),
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
    kind: application
      ? AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND
      : AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
    device,
    mount: {
      ...clone(desired.mount),
      sourcePath: device.path,
      mounted: true,
    },
  });
}

/**
 * Command-owned durable state survives its deliberately lost mutation response.
 * @param {'application-storage'|'control-storage'} stepKind
 * @param {AnyRecord[]} events
 * @returns {{command: Readonly<AnyRecord>, inspectCalls: AnyRecord[], convergeCalls: AnyRecord[]}}
 */
function createLostResponseStorageCommand(stepKind, events) {
  /** @type {Readonly<AnyRecord>|null} */
  let durableEvidence = null;
  /** @type {AnyRecord[]} */
  const inspectCalls = [];
  /** @type {AnyRecord[]} */
  const convergeCalls = [];
  const command = Object.freeze({
    async inspect(/** @type {Readonly<AnyRecord>} */ desired) {
      inspectCalls.push(desired);
      const status = durableEvidence === null ? 'ready' : 'settled';
      events.push({ surface: stepKind, method: 'inspect', status });
      return durableEvidence === null
        ? Object.freeze({ status: 'ready' })
        : deepFreeze({ status: 'settled', evidence: durableEvidence });
    },
    async converge(/** @type {Readonly<AnyRecord>} */ envelope) {
      convergeCalls.push(envelope);
      events.push({ surface: stepKind, method: 'converge' });
      durableEvidence = storageEvidence(envelope.desired);
      throw new Error(`simulated ${stepKind} response loss`);
    },
  });
  return { command, inspectCalls, convergeCalls };
}

/** @param {Readonly<AnyRecord>} request @param {Readonly<AnyRecord>} runtime @returns {Readonly<AnyRecord>} */
function applicationContext(request, runtime) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        'application-storage',
      ),
      kind: 'application-storage',
      attemptGeneration: 0,
    },
    priorEvidence: { 'runtime-identity': runtime },
  });
}

/** @param {Readonly<AnyRecord>} request @param {Readonly<AnyRecord>} runtime @param {Readonly<AnyRecord>} application @returns {Readonly<AnyRecord>} */
function controlContext(request, runtime, application) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        'control-storage',
      ),
      kind: 'control-storage',
      attemptGeneration: 0,
    },
    priorEvidence: {
      'runtime-identity': runtime,
      'application-storage': application,
    },
  });
}

/**
 * Strictly validate a harmless downstream test adapter's complete context.
 * Calling the control validator also revalidates runtime and application.
 * @param {unknown} value
 * @param {string} stepKind
 * @param {ReadonlyArray<string>} priorKeys
 * @returns {Readonly<AnyRecord>}
 */
function validateDownstreamContext(value, stepKind, priorKeys) {
  const context = exactObject(
    value,
    CONTEXT_KEYS,
    `${stepKind} integration context`,
  );
  const request = validateAwsSingleNodeHostActivationRequest(context.request);
  exactObject(context.step, STEP_KEYS, `${stepKind} integration context.step`);
  if (
    context.step.kind !== stepKind ||
    context.step.intentId !==
      getAwsSingleNodeHostActivationIntentId(request, stepKind) ||
    !Number.isSafeInteger(context.step.attemptGeneration) ||
    context.step.attemptGeneration < 0
  ) {
    throw new TypeError(`${stepKind} integration step is invalid.`);
  }
  const prior = exactObject(
    context.priorEvidence,
    priorKeys,
    `${stepKind} integration context.priorEvidence`,
  );
  const runtime = validateAwsSingleNodeHostRuntimeIdentityEvidence(
    prior['runtime-identity'],
    runtimeContext(request),
  );
  if (priorKeys.includes('application-storage')) {
    const application = validateAwsSingleNodeHostApplicationStorageEvidence(
      prior['application-storage'],
      applicationContext(request, runtime),
    );
    if (priorKeys.includes('control-storage')) {
      validateAwsSingleNodeHostControlStorageEvidence(
        prior['control-storage'],
        controlContext(request, runtime, application),
      );
    }
  }
  for (const earlierStep of ['artifact-projection', 'service-convergence']) {
    if (
      priorKeys.includes(earlierStep) &&
      !sameJson(prior[earlierStep], testEvidence(request, earlierStep))
    ) {
      throw new TypeError(
        `${stepKind} integration ${earlierStep} evidence is invalid.`,
      );
    }
  }
  return deepFreeze({ request, prior });
}

/** @param {Readonly<AnyRecord>} request @param {string} stepKind @returns {Readonly<AnyRecord>} */
function testEvidence(request, stepKind) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'testAwsSingleNodeHostRetainedStorageActivationEvidence',
    requestId: request.requestId,
    step: stepKind,
  });
}

/**
 * @param {string} stepKind
 * @param {ReadonlyArray<string>} priorKeys
 * @param {{unknownFirst?: boolean, evidence?: Readonly<AnyRecord>, events: AnyRecord[]}} options
 * @returns {Readonly<AnyRecord>}
 */
function createHarmlessEffectAdapter(stepKind, priorKeys, options) {
  let observations = 0;
  /** @param {unknown} value @param {unknown} context @returns {Readonly<AnyRecord>} */
  function validateEvidence(value, context) {
    const { request } = validateDownstreamContext(context, stepKind, priorKeys);
    const evidence = exactObject(
      clone(value),
      ['kind', 'requestId', 'schemaVersion', 'step'],
      `${stepKind} integration evidence`,
    );
    const expected = testEvidence(request, stepKind);
    if (!sameJson(evidence, expected)) {
      throw new TypeError(`${stepKind} integration evidence is invalid.`);
    }
    return expected;
  }
  return Object.freeze({
    async observe(/** @type {unknown} */ context) {
      const { request, prior } = validateDownstreamContext(
        context,
        stepKind,
        priorKeys,
      );
      observations += 1;
      options.events.push({
        surface: stepKind,
        method: 'observe',
        priorKeys: Object.keys(prior),
      });
      if (options.unknownFirst === true && observations === 1) {
        return Object.freeze({ status: 'unknown' });
      }
      return deepFreeze({
        status: 'settled',
        evidence: options.evidence ?? testEvidence(request, stepKind),
      });
    },
    async converge() {
      throw new Error(`${stepKind} harmless adapter must not mutate.`);
    },
    validateEvidence,
  });
}

/** @param {Readonly<AnyRecord>} request @param {Readonly<AnyRecord>} expectedHealth @param {AnyRecord[]} events @returns {Readonly<AnyRecord>} */
function createHealthAdapter(request, expectedHealth, events) {
  const priorKeys = [
    'artifact-projection',
    'application-storage',
    'control-storage',
    'runtime-identity',
    'service-convergence',
  ];
  return Object.freeze({
    async observe(/** @type {unknown} */ context) {
      validateDownstreamContext(context, 'health-publication', priorKeys);
      events.push({ surface: 'health-publication', method: 'observe' });
      return deepFreeze({
        status: 'settled',
        evidence: expectedHealth,
      });
    },
    async converge() {
      throw new Error('health harmless adapter must not mutate.');
    },
    validateEvidence(
      /** @type {unknown} */ value,
      /** @type {unknown} */ context,
    ) {
      validateDownstreamContext(context, 'health-publication', priorKeys);
      const evidence = validateDeploymentServiceHealthObservation(value);
      if (!sameJson(evidence, expectedHealth)) {
        throw new TypeError('health integration evidence is invalid.');
      }
      return evidence;
    },
  });
}

/** @returns {Readonly<AnyRecord>} */
function createMemoryStore() {
  /** @type {Map<string, Readonly<AnyRecord>>} */
  const fences = new Map();
  /** @type {Map<string, Readonly<AnyRecord>>} */
  const states = new Map();
  return Object.freeze({
    async readActivationFence(/** @type {string} */ deploymentInstanceId) {
      const value = fences.get(deploymentInstanceId);
      return value === undefined ? null : deepFreeze(clone(value));
    },
    async compareAndSetActivationFence(/** @type {AnyRecord} */ input) {
      const current = fences.get(input.deploymentInstanceId) ?? null;
      if ((current?.fenceId ?? null) !== input.expectedFenceId) return false;
      fences.set(
        input.deploymentInstanceId,
        deepFreeze(clone(input.nextFence)),
      );
      return true;
    },
    async readActivationState(/** @type {string} */ requestId) {
      const value = states.get(requestId);
      return value === undefined ? null : deepFreeze(clone(value));
    },
    async compareAndSetActivationState(/** @type {AnyRecord} */ input) {
      const current = states.get(input.requestId) ?? null;
      if ((current?.stateId ?? null) !== input.expectedStateId) return false;
      states.set(input.requestId, deepFreeze(clone(input.nextState)));
      return true;
    },
  });
}

describe('AWS single-node retained storage through durable host activation', () => {
  it('recovers both lost command responses and revalidates their exact prefix on resume', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {AnyRecord[]} */
    const events = [];
    const applicationCommand = createLostResponseStorageCommand(
      'application-storage',
      events,
    );
    const controlCommand = createLostResponseStorageCommand(
      'control-storage',
      events,
    );
    const runtime = runtimeEvidence(request);
    const healthReceipt = makeHealthReceipt(fixture, {
      providerScopeId: request.providerScope.providerScopeId,
      providerSpecId: request.providerSpecId,
      deploymentInstanceId: request.deploymentInstanceId,
      incarnationId: request.incarnationId,
      deploymentOperationId: request.deploymentOperationId,
      authorizedHeadId: request.authorizedHeadId,
      authorizedHeadGeneration: request.authorizedHeadGeneration,
      nodeBindingId: request.nodeBindingId,
      nodeProviderResourceId: request.nodeProviderResourceId,
      runtimeRoleBindingId: request.runtimeRoleBindingId,
      runtimeRoleId: request.runtimeRoleId,
      deploymentRevisionId: request.deploymentRevisionId,
      appId: request.appId,
      artifactId: request.artifactId,
      revisionId: request.revisionId,
    });
    const healthLocation = getDeploymentServiceHealthObjectLocation(
      request.providerScope,
      healthReceipt,
    );
    const healthEvidence = deepFreeze({
      receipt: healthReceipt,
      object: {
        bucketName: healthLocation.bucketName,
        key: healthLocation.key,
        versionId: 'retained-storage-health-version',
        etag: '"retained-storage-health-etag"',
        lastModifiedAt: 1_735_689_600_000,
      },
    });
    const artifactAdapter = createHarmlessEffectAdapter(
      'artifact-projection',
      ['application-storage', 'control-storage', 'runtime-identity'],
      { unknownFirst: true, events },
    );
    const serviceAdapter = createHarmlessEffectAdapter(
      'service-convergence',
      [
        'artifact-projection',
        'application-storage',
        'control-storage',
        'runtime-identity',
      ],
      { events },
    );
    const kernel = createAwsSingleNodeHostActivationKernel({
      store: createMemoryStore(),
      async withHostLock(
        /** @type {AnyRecord} */ identity,
        /** @type {() => Promise<any>} */ operation,
      ) {
        expect(identity).toEqual({
          deploymentInstanceId: request.deploymentInstanceId,
        });
        return await operation();
      },
      async authorizeRequest(/** @type {AnyRecord} */ input) {
        return input.request.requestId === request.requestId;
      },
      steps: {
        runtimeIdentity: {
          async observe(/** @type {unknown} */ context) {
            return {
              status: 'settled',
              evidence: validateAwsSingleNodeHostRuntimeIdentityEvidence(
                runtime,
                context,
              ),
            };
          },
          validateEvidence(
            /** @type {unknown} */ value,
            /** @type {unknown} */ context,
          ) {
            return validateAwsSingleNodeHostRuntimeIdentityEvidence(
              value,
              context,
            );
          },
        },
        applicationStorage: createAwsSingleNodeHostApplicationStorageAdapter({
          command: applicationCommand.command,
        }),
        controlStorage: createAwsSingleNodeHostControlStorageAdapter({
          command: controlCommand.command,
        }),
        artifactProjection: artifactAdapter,
        serviceConvergence: serviceAdapter,
        healthPublication: createHealthAdapter(request, healthEvidence, events),
      },
    });

    const interrupted = await kernel.converge(request);
    expect(interrupted).toMatchObject({
      status: 'pending',
      step: 'artifact-projection',
    });

    const completed = await kernel.resume({ requestId: request.requestId });
    const state = await kernel.inspect({ requestId: request.requestId });

    expect(completed.status).toBe('succeeded');
    expect(state.status).toBe('succeeded');
    expect(
      state.steps.slice(0, 3).map((/** @type {AnyRecord} */ step) => ({
        kind: step.kind,
        status: step.status,
      })),
    ).toEqual([
      { kind: 'runtime-identity', status: 'settled' },
      { kind: 'application-storage', status: 'settled' },
      { kind: 'control-storage', status: 'settled' },
    ]);
    expect(
      events
        .filter((event) => event.method === 'converge')
        .map((event) => event.surface),
    ).toEqual(['application-storage', 'control-storage']);
    /** @type {Array<[string, ReturnType<typeof createLostResponseStorageCommand>]>} */
    const storageCommands = [
      ['application-storage', applicationCommand],
      ['control-storage', controlCommand],
    ];
    for (const [stepKind, command] of storageCommands) {
      expect(command.inspectCalls[0]).toBeDefined();
      expect(
        command.inspectCalls.some((/** @type {AnyRecord} */ call) =>
          call.kind.endsWith('StorageDesired'),
        ),
      ).toBe(true);
      expect(command.convergeCalls).toHaveLength(1);
      const envelope = command.convergeCalls[0];
      expect(Object.keys(envelope).sort()).toEqual([
        'attemptGeneration',
        'desired',
        'intentId',
      ]);
      expect(envelope.intentId).toBe(
        getAwsSingleNodeHostActivationIntentId(request, stepKind),
      );
      expect(envelope.attemptGeneration).toBeGreaterThan(0);
      expect(envelope.attemptGeneration).toBe(1);
      expect(envelope.desired.requestId).toBe(request.requestId);
      expect(JSON.stringify(envelope.desired)).not.toContain(
        envelope.desired.capabilityKind === 'application-state'
          ? request.volumes[0].requestedDeviceName
          : request.volumes[1].requestedDeviceName,
      );
      expectDeepFrozen(envelope);
      const inspectionStatuses = events
        .filter(
          (event) => event.surface === stepKind && event.method === 'inspect',
        )
        .map((event) => event.status);
      expect(inspectionStatuses[0]).toBe('ready');
      expect(inspectionStatuses).toContain('settled');
    }
    for (const storageStep of state.steps.slice(1, 3)) {
      expect(storageStep.evidence.value).not.toHaveProperty('intentId');
      expect(storageStep.evidence.value).not.toHaveProperty(
        'attemptGeneration',
      );
    }
    expect(
      events.filter(
        (event) =>
          event.surface === 'artifact-projection' && event.method === 'observe',
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(applicationCommand.inspectCalls.length).toBeGreaterThanOrEqual(3);
    expect(controlCommand.inspectCalls.length).toBeGreaterThanOrEqual(3);
    expectDeepFrozen(completed);
    expectDeepFrozen(state);
  });
});
