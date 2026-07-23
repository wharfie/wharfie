import { describe, expect, it, jest } from '@jest/globals';

import {
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_EXECUTIONS,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_OWNERSHIP,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_PRESENCES,
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED,
  AwsSingleNodeResourceObservationRouteUnsupportedError,
  createAwsSingleNodeResourceObservationRouter,
  validateAwsSingleNodeResourceObservation,
} from '../../src/core/runtime/deployment-aws-resource-observation.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  getAwsSingleNodeResourceDefinition,
} from '../../src/core/runtime/deployment-resource-graph.js';

/** @typedef {{observe: jest.Mock<(context: Record<string, any>) => Promise<any>>}} ObserverDouble */

const OBSERVER_KEYS = Object.freeze([
  'managedArtifact',
  'volume',
  'vpc',
  'internetGateway',
  'internetGatewayAttachment',
  'subnet',
  'routeTable',
  'defaultIpv4Route',
  'subnetRouteTableAssociation',
  'securityGroup',
  'runtimeRole',
  'runtimeRolePolicy',
  'instanceProfile',
  'instanceProfileRoleAssociation',
  'node',
  'volumeAttachment',
]);

/** @type {Readonly<Record<string, string>>} */
const EXPECTED_RESOURCE_OBSERVER = Object.freeze({
  artifact: 'managedArtifact',
  'application-state': 'volume',
  'control-state': 'volume',
  'network-vpc': 'vpc',
  'network-internet-gateway': 'internetGateway',
  'network-internet-gateway-attachment': 'internetGatewayAttachment',
  'network-subnet': 'subnet',
  'network-route-table': 'routeTable',
  'network-default-ipv4-route': 'defaultIpv4Route',
  'network-subnet-route-table-association': 'subnetRouteTableAssociation',
  'network-security-group': 'securityGroup',
  'runtime-role': 'runtimeRole',
  'runtime-role-policy': 'runtimeRolePolicy',
  'runtime-identity': 'instanceProfile',
  'runtime-identity-role-association': 'instanceProfileRoleAssociation',
  substrate: 'node',
  'application-state-attachment': 'volumeAttachment',
  'control-state-attachment': 'volumeAttachment',
});

const SUBSTRATE_OWNED_HEALTH = Object.freeze([
  'starting',
  'degraded',
  'stopped',
  'failed',
]);
const SUBSTRATE_CONFLICT_HEALTH = Object.freeze([
  ...SUBSTRATE_OWNED_HEALTH,
  'unknown',
]);
const DIGEST = Object.freeze({
  algorithm: 'sha256',
  value: Buffer.alloc(32, 0x47).toString('base64url'),
});
const ACTION_ID = `wda3_${Buffer.alloc(32, 0x48).toString('base64url')}`;

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function definition(resourceKey) {
  const value = getAwsSingleNodeResourceDefinition(resourceKey);
  if (value === null) throw new Error(`Missing test definition ${resourceKey}`);
  return value;
}

/** @param {string} resourceKey @returns {Record<string, string>} */
function providerIdentity(resourceKey) {
  return {
    providerType: definition(resourceKey).providerType,
    providerResourceId: `provider-id:${resourceKey}`,
  };
}

/**
 * @param {string} resourceKey
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function presentObservation(resourceKey, overrides = {}) {
  return {
    resourceKey,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: providerIdentity(resourceKey),
    observedDigest: clone(DIGEST),
    health: resourceKey === 'substrate' ? 'starting' : 'not-applicable',
    execution: 'none',
    ...overrides,
  };
}

/** @param {string} resourceKey @returns {Record<string, any>} */
function absentObservation(resourceKey) {
  return {
    resourceKey,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  };
}

/**
 * @param {string} resourceKey
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function unknownObservation(resourceKey, overrides = {}) {
  return {
    resourceKey,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
    ...overrides,
  };
}

/** @returns {Record<string, ObserverDouble>} */
function createObservers() {
  return Object.fromEntries(
    OBSERVER_KEYS.map((observerKey) => [
      observerKey,
      {
        observe: jest.fn(async (/** @type {Record<string, any>} */ context) =>
          presentObservation(context.target.resourceKey),
        ),
      },
    ]),
  );
}

/**
 * @param {Record<string, ObserverDouble>} observers
 * @returns {number}
 */
function totalObserverCalls(observers) {
  return Object.values(observers).reduce(
    (total, observer) => total + observer.observe.mock.calls.length,
    0,
  );
}

describe('AWS single-node resource observation contract', () => {
  it('exports the complete frozen finite vocabularies and deliberately excludes healthy resource evidence', () => {
    expect(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_PRESENCES).toEqual([
      'present',
      'absent',
      'unknown',
    ]);
    expect(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_OWNERSHIP).toEqual([
      'verified',
      'external',
      'missing',
      'conflict',
      'unknown',
    ]);
    expect(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH).toEqual([
      'starting',
      'degraded',
      'stopped',
      'failed',
      'absent',
      'unknown',
      'not-applicable',
    ]);
    expect(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_EXECUTIONS).toEqual([
      'none',
      'replay-safe-create',
    ]);
    expect(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH).not.toContain(
      'healthy',
    );
    expect(
      Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_PRESENCES),
    ).toBe(true);
    expect(
      Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_OWNERSHIP),
    ).toBe(true);
    expect(Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_HEALTH)).toBe(
      true,
    );
    expect(
      Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_EXECUTIONS),
    ).toBe(true);
  });

  it.each([
    ['absent', absentObservation('artifact')],
    ['unknown', unknownObservation('artifact')],
    [
      'replay-safe create',
      unknownObservation('artifact', { execution: 'replay-safe-create' }),
    ],
  ])('accepts and deeply freezes the exact %s union', (_name, input) => {
    const result = validateAwsSingleNodeResourceObservation(input, 'artifact');

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expectDeepFrozen(result);
  });

  it.each(['verified', 'external', 'conflict'])(
    'accepts non-substrate present %s evidence only with not-applicable health',
    (ownership) => {
      const input = presentObservation('artifact', {
        ownership,
        health: 'not-applicable',
      });
      const result = validateAwsSingleNodeResourceObservation(
        input,
        'artifact',
      );

      expect(result).toEqual(input);
      expect(result).not.toBe(input);
      expect(result.providerIdentity).not.toBe(input.providerIdentity);
      expect(result.observedDigest).not.toBe(input.observedDigest);
      expectDeepFrozen(result);
    },
  );

  it.each(
    ['verified', 'external'].flatMap((ownership) =>
      SUBSTRATE_OWNED_HEALTH.map((health) => [ownership, health]),
    ),
  )(
    'accepts substrate present %s evidence with %s health and a concrete digest',
    (ownership, health) => {
      const input = presentObservation('substrate', { ownership, health });
      const result = validateAwsSingleNodeResourceObservation(
        input,
        'substrate',
      );

      expect(result).toEqual(input);
      expect(result).not.toBe(input);
      expect(result.providerIdentity).not.toBe(input.providerIdentity);
      expect(result.observedDigest).not.toBe(input.observedDigest);
      expectDeepFrozen(result);
    },
  );

  it.each(SUBSTRATE_CONFLICT_HEALTH)(
    'accepts substrate present conflict evidence with %s health',
    (health) => {
      const input = presentObservation('substrate', {
        ownership: 'conflict',
        health,
      });

      expect(
        validateAwsSingleNodeResourceObservation(input, 'substrate'),
      ).toEqual(input);
    },
  );

  it('allows a present conflict to omit an unknowable observed digest', () => {
    const input = presentObservation('artifact', {
      ownership: 'conflict',
      observedDigest: null,
    });

    expect(validateAwsSingleNodeResourceObservation(input, 'artifact')).toEqual(
      input,
    );
  });

  it('accepts every graph role only with its exact provider type and routed key', () => {
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH.resources).toHaveLength(18);
    for (const resource of AWS_SINGLE_NODE_RESOURCE_GRAPH.resources) {
      const observed = validateAwsSingleNodeResourceObservation(
        presentObservation(resource.resourceKey),
        resource.resourceKey,
      );
      expect(observed.resourceKey).toBe(resource.resourceKey);
      expect(observed.providerIdentity.providerType).toBe(
        resource.providerType,
      );
    }
  });

  it('rejects non-objects, missing or extra fields, and unsupported resource keys', () => {
    for (const value of [undefined, null, [], 'observation', 47]) {
      expect(() => validateAwsSingleNodeResourceObservation(value)).toThrow(
        TypeError,
      );
    }

    const valid = presentObservation('artifact');
    for (const key of Object.keys(valid)) {
      const missing = clone(valid);
      delete missing[key];
      expect(() => validateAwsSingleNodeResourceObservation(missing)).toThrow(
        new RegExp(`${key} is required`, 'i'),
      );
    }
    expect(() =>
      validateAwsSingleNodeResourceObservation({ ...valid, secret: 'value' }),
    ).toThrow(/secret is not supported/i);
    expect(() =>
      validateAwsSingleNodeResourceObservation({
        ...valid,
        resourceKey: 'unknown-resource',
      }),
    ).toThrow(/resourceKey is not supported/i);
    expect(() =>
      validateAwsSingleNodeResourceObservation({
        ...valid,
        resourceKey: null,
      }),
    ).toThrow(TypeError);
  });

  it('rejects unsupported presence, ownership, health, and execution vocabulary values', () => {
    const valid = presentObservation('artifact');
    /** @type {Array<[string, unknown]>} */
    const invalidValues = [
      ['presence', 'destroyed'],
      ['presence', null],
      ['ownership', 'adopted'],
      ['ownership', null],
      ['health', 'healthy'],
      ['health', null],
      ['execution', 'create'],
      ['execution', null],
    ];
    for (const [field, value] of invalidValues) {
      expect(() =>
        validateAwsSingleNodeResourceObservation({
          ...valid,
          [field]: value,
        }),
      ).toThrow(new RegExp(`${field} is not supported`, 'i'));
    }
  });

  it('rejects every absent cross-field claim', () => {
    const valid = absentObservation('artifact');
    const invalid = [
      { ...valid, ownership: 'verified' },
      { ...valid, ownership: 'external' },
      { ...valid, ownership: 'conflict' },
      { ...valid, ownership: 'unknown' },
      { ...valid, providerIdentity: providerIdentity('artifact') },
      { ...valid, observedDigest: clone(DIGEST) },
      { ...valid, health: 'unknown' },
      { ...valid, health: 'not-applicable' },
      { ...valid, execution: 'replay-safe-create' },
    ];

    for (const observation of invalid) {
      expect(() =>
        validateAwsSingleNodeResourceObservation(observation),
      ).toThrow(/absent evidence must be missing/i);
    }
  });

  it('rejects every unknown cross-field claim', () => {
    const valid = unknownObservation('artifact');
    const invalid = [
      { ...valid, ownership: 'verified' },
      { ...valid, ownership: 'external' },
      { ...valid, ownership: 'missing' },
      { ...valid, ownership: 'conflict' },
      { ...valid, providerIdentity: providerIdentity('artifact') },
      { ...valid, observedDigest: clone(DIGEST) },
      { ...valid, health: 'absent' },
      { ...valid, health: 'starting' },
    ];

    for (const observation of invalid) {
      expect(() =>
        validateAwsSingleNodeResourceObservation(observation),
      ).toThrow(/unknown evidence must have unknown ownership/i);
    }
  });

  it('rejects present evidence without exact identity, ownership, digest, and non-absent health', () => {
    const valid = presentObservation('artifact');
    const invalid = [
      { ...valid, ownership: 'missing' },
      { ...valid, ownership: 'unknown' },
      { ...valid, providerIdentity: null },
      { ...valid, observedDigest: null },
      { ...valid, ownership: 'external', observedDigest: null },
      { ...valid, health: 'absent' },
      { ...valid, execution: 'replay-safe-create' },
    ];

    for (const observation of invalid) {
      expect(() =>
        validateAwsSingleNodeResourceObservation(observation),
      ).toThrow(/present evidence has an unsupported/i);
    }
  });

  it.each(
    ['verified', 'external', 'conflict'].flatMap((ownership) =>
      ['starting', 'degraded', 'stopped', 'failed', 'unknown'].map((health) => [
        ownership,
        health,
      ]),
    ),
  )(
    'rejects non-substrate present %s evidence with %s health',
    (ownership, health) => {
      expect(() =>
        validateAwsSingleNodeResourceObservation(
          presentObservation('artifact', { ownership, health }),
        ),
      ).toThrow(/present evidence has an unsupported/i);
    },
  );

  it.each(
    ['verified', 'external'].flatMap((ownership) =>
      ['unknown', 'not-applicable'].map((health) => [ownership, health]),
    ),
  )(
    'rejects substrate present %s evidence with %s health',
    (ownership, health) => {
      expect(() =>
        validateAwsSingleNodeResourceObservation(
          presentObservation('substrate', { ownership, health }),
        ),
      ).toThrow(/present evidence has an unsupported/i);
    },
  );

  it('rejects substrate present conflict evidence with not-applicable health', () => {
    expect(() =>
      validateAwsSingleNodeResourceObservation(
        presentObservation('substrate', {
          ownership: 'conflict',
          health: 'not-applicable',
        }),
      ),
    ).toThrow(/present evidence has an unsupported/i);
  });

  it('rejects malformed, extra, or graph-mismatched provider identities', () => {
    const valid = presentObservation('artifact');
    const identities = [
      undefined,
      [],
      'provider',
      {},
      { providerType: definition('artifact').providerType },
      { providerResourceId: 'provider-id' },
      { ...providerIdentity('artifact'), extra: true },
      { ...providerIdentity('artifact'), providerType: 'aws.wrong' },
      { ...providerIdentity('artifact'), providerResourceId: '' },
      { ...providerIdentity('artifact'), providerResourceId: 'contains space' },
    ];

    for (const providerIdentityValue of identities) {
      expect(() =>
        validateAwsSingleNodeResourceObservation({
          ...valid,
          providerIdentity: providerIdentityValue,
        }),
      ).toThrow();
    }
  });

  it('rejects malformed and noncanonical observed digests', () => {
    const valid = presentObservation('artifact');
    const digests = [
      undefined,
      [],
      'digest',
      {},
      { algorithm: 'sha256' },
      { value: DIGEST.value },
      { ...DIGEST, extra: true },
      { ...DIGEST, algorithm: 'sha512' },
      { ...DIGEST, value: 'not-a-sha256-digest' },
    ];

    for (const observedDigest of digests) {
      expect(() =>
        validateAwsSingleNodeResourceObservation({
          ...valid,
          observedDigest,
        }),
      ).toThrow();
    }
  });

  it('validates an optional expected resource key and rejects unknown or mismatched expectations', () => {
    const valid = presentObservation('artifact');

    expect(validateAwsSingleNodeResourceObservation(valid)).toEqual(valid);
    expect(validateAwsSingleNodeResourceObservation(valid, 'artifact')).toEqual(
      valid,
    );
    expect(() =>
      validateAwsSingleNodeResourceObservation(valid, 'substrate'),
    ).toThrow(/does not match its exact routed resource key/i);
    for (const expectedResourceKey of [null, 47, 'unknown-resource']) {
      expect(() =>
        validateAwsSingleNodeResourceObservation(valid, expectedResourceKey),
      ).toThrow(TypeError);
    }
  });
});

describe('AWS single-node resource observation router', () => {
  it('pins all 18 graph roles to the exact 16 observer families', () => {
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH.resources).toHaveLength(18);
    expect(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.resourceKey,
      ),
    ).toEqual(Object.keys(EXPECTED_RESOURCE_OBSERVER));
    expect(new Set(Object.values(EXPECTED_RESOURCE_OBSERVER))).toEqual(
      new Set(OBSERVER_KEYS),
    );
  });

  it('routes all 18 roles to one observer call with the exact same context identity and no fanout', async () => {
    const observers = createObservers();
    const router = createAwsSingleNodeResourceObservationRouter({ observers });

    for (const resource of AWS_SINGLE_NODE_RESOURCE_GRAPH.resources) {
      const observerKey = EXPECTED_RESOURCE_OBSERVER[resource.resourceKey];
      const before = Object.fromEntries(
        OBSERVER_KEYS.map((key) => [
          key,
          observers[key].observe.mock.calls.length,
        ]),
      );
      const context = Object.freeze({
        target: Object.freeze({ resourceKey: resource.resourceKey }),
        authorityMarker: Object.freeze({ resourceKey: resource.resourceKey }),
      });

      await expect(router.observeResource(context)).resolves.toEqual(
        presentObservation(resource.resourceKey),
      );

      for (const key of OBSERVER_KEYS) {
        const expectedDelta = key === observerKey ? 1 : 0;
        expect(observers[key].observe.mock.calls.length - before[key]).toBe(
          expectedDelta,
        );
      }
      const call = observers[observerKey].observe.mock.calls.at(-1);
      expect(call).toHaveLength(1);
      expect(call?.[0]).toBe(context);
    }

    expect(totalObserverCalls(observers)).toBe(18);
    expect(observers.volume.observe).toHaveBeenCalledTimes(2);
    expect(observers.volumeAttachment.observe).toHaveBeenCalledTimes(2);
    for (const observerKey of OBSERVER_KEYS) {
      if (observerKey === 'volume' || observerKey === 'volumeAttachment') {
        continue;
      }
      expect(observers[observerKey].observe).toHaveBeenCalledTimes(1);
    }
  });

  it('validates and deeply freezes observer output at the routed resource boundary', async () => {
    const observers = createObservers();
    const raw = presentObservation('artifact');
    observers.managedArtifact.observe.mockImplementationOnce(async () => raw);
    const router = createAwsSingleNodeResourceObservationRouter({ observers });
    const observed = await router.observeResource({
      target: { resourceKey: 'artifact' },
    });

    expect(observed).toEqual(raw);
    expect(observed).not.toBe(raw);
    expect(observed.providerIdentity).not.toBe(raw.providerIdentity);
    expect(observed.observedDigest).not.toBe(raw.observedDigest);
    expectDeepFrozen(observed);
  });

  it('accepts replay-safe create only for the exact routed current create authority', async () => {
    const ownershipNonce = Buffer.alloc(32, 0x49).toString('base64url');
    const validContexts = [
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'application-state',
          },
          ownershipNonce,
        },
      },
      {
        target: { resourceKey: 'control-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'control-state',
          },
          ownershipNonce,
        },
      },
    ];

    for (const context of validContexts) {
      const observers = createObservers();
      observers.volume.observe.mockImplementationOnce(async () =>
        unknownObservation(context.target.resourceKey, {
          execution: 'replay-safe-create',
        }),
      );
      const router = createAwsSingleNodeResourceObservationRouter({
        observers,
      });

      await expect(router.observeResource(context)).resolves.toEqual(
        unknownObservation(context.target.resourceKey, {
          execution: 'replay-safe-create',
        }),
      );
    }
  });

  it('rejects replay-safe create without the exact current create action and nonce proof', async () => {
    const ownershipNonce = Buffer.alloc(32, 0x49).toString('base64url');
    const invalidContexts = [
      { target: { resourceKey: 'application-state' } },
      {
        target: { resourceKey: 'application-state' },
        currentAction: null,
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'delete',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'application-state',
          },
          ownershipNonce,
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'control-state',
          },
          ownershipNonce,
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'application-state',
          },
          ownershipNonce: null,
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'application-state',
          },
          ownershipNonce: 'not-a-valid-nonce',
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'application-state',
          },
          ownershipNonce,
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: 'not-an-action-id',
            management: 'managed',
            ownershipMode: 'direct',
            resourceKey: 'application-state',
          },
          ownershipNonce,
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'external',
            ownershipMode: 'external',
            resourceKey: 'application-state',
          },
          ownershipNonce,
        },
      },
      {
        target: { resourceKey: 'application-state' },
        currentAction: {
          action: {
            action: 'create',
            actionId: ACTION_ID,
            management: 'managed',
            ownershipMode: 'derived',
            resourceKey: 'application-state',
          },
          ownershipNonce,
        },
      },
    ];

    for (const context of invalidContexts) {
      const observers = createObservers();
      observers.volume.observe.mockImplementationOnce(async () =>
        unknownObservation('application-state', {
          execution: 'replay-safe-create',
        }),
      );
      const router = createAwsSingleNodeResourceObservationRouter({
        observers,
      });

      await expect(router.observeResource(context)).rejects.toThrow(
        'AWS single-node resource observation replay-safe create execution does not match its exact current action authority.',
      );
      expect(observers.volume.observe).toHaveBeenCalledTimes(1);
      expect(totalObserverCalls(observers)).toBe(1);
    }
  });

  it('rejects invalid observer output, including a valid observation for the wrong routed key', async () => {
    const invalidOutputs = [
      undefined,
      {},
      { ...absentObservation('artifact'), extra: true },
      { ...absentObservation('artifact'), ownership: 'verified' },
      presentObservation('substrate'),
    ];

    for (const output of invalidOutputs) {
      const observers = createObservers();
      observers.managedArtifact.observe.mockImplementationOnce(
        async () => output,
      );
      const router = createAwsSingleNodeResourceObservationRouter({
        observers,
      });

      await expect(
        router.observeResource({ target: { resourceKey: 'artifact' } }),
      ).rejects.toThrow();
      expect(observers.managedArtifact.observe).toHaveBeenCalledTimes(1);
      expect(totalObserverCalls(observers)).toBe(1);
    }
  });

  it('preserves an observer rejection and still performs no fanout', async () => {
    const observers = createObservers();
    const failure = new Error('observer failure sentinel');
    observers.node.observe.mockImplementationOnce(async () => {
      throw failure;
    });
    const router = createAwsSingleNodeResourceObservationRouter({ observers });

    await expect(
      router.observeResource({ target: { resourceKey: 'substrate' } }),
    ).rejects.toBe(failure);
    expect(observers.node.observe).toHaveBeenCalledTimes(1);
    expect(totalObserverCalls(observers)).toBe(1);
  });

  it('returns only one frozen read-only port', () => {
    const router = createAwsSingleNodeResourceObservationRouter({
      observers: createObservers(),
    });

    expect(Object.isFrozen(router)).toBe(true);
    expect(Object.keys(router)).toEqual(['observeResource']);
    expect(typeof router.observeResource).toBe('function');
    expect(router).not.toHaveProperty('executeAction');
    expect(router).not.toHaveProperty('verifySettlement');
  });

  it('rejects malformed, missing, and extra constructor options', () => {
    const observers = createObservers();
    for (const options of [
      undefined,
      null,
      [],
      'options',
      {},
      { observers: null },
      { observers: [] },
      { observers, extra: true },
    ]) {
      expect(() =>
        createAwsSingleNodeResourceObservationRouter(options),
      ).toThrow(TypeError);
    }

    const missingObserver = createObservers();
    delete missingObserver.node;
    expect(() =>
      createAwsSingleNodeResourceObservationRouter({
        observers: missingObserver,
      }),
    ).toThrow(/observers\.node is required/i);

    expect(() =>
      createAwsSingleNodeResourceObservationRouter({
        observers: { ...createObservers(), unsupported: { observe() {} } },
      }),
    ).toThrow(/observers\.unsupported is not supported/i);
  });

  it('requires each observer family to expose exactly one function-valued read-only port', () => {
    for (const observerKey of OBSERVER_KEYS) {
      for (const invalidPort of [
        null,
        [],
        () => {},
        {},
        { observe: true },
        { observe() {}, inspect() {} },
        { observe() {}, executeAction() {} },
        { observe() {}, verifySettlement() {} },
      ]) {
        /** @type {Record<string, any>} */
        const observers = createObservers();
        observers[observerKey] = invalidPort;
        expect(() =>
          createAwsSingleNodeResourceObservationRouter({ observers }),
        ).toThrow(TypeError);
      }
    }
  });

  it('rejects every malformed or unknown route with one fixed non-echoing error before observer calls', async () => {
    const observers = createObservers();
    const router = createAwsSingleNodeResourceObservationRouter({ observers });
    const secret = 'secret-provider-resource-route-arn-1234';
    /** @type {Record<string, any>} */
    const throwingTarget = {};
    Object.defineProperty(throwingTarget, 'target', {
      enumerable: true,
      get() {
        throw new Error(secret);
      },
    });
    const malformedContexts = [
      undefined,
      null,
      [],
      'context',
      {},
      { target: null },
      { target: [] },
      { target: {} },
      { target: { resourceKey: null } },
      { target: { resourceKey: {} } },
      { target: { resourceKey: '' } },
      { target: { resourceKey: secret } },
      throwingTarget,
    ];

    expect(AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED).toBe(
      'AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED',
    );
    for (const context of malformedContexts) {
      /** @type {any} */
      let failure;
      try {
        await router.observeResource(context);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(
        AwsSingleNodeResourceObservationRouteUnsupportedError,
      );
      expect(failure).toMatchObject({
        name: 'AwsSingleNodeResourceObservationRouteUnsupportedError',
        code: AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED,
        message: 'AWS single-node resource observation route is unsupported.',
      });
      expect(failure.message).not.toContain(secret);
    }
    expect(totalObserverCalls(observers)).toBe(0);
  });

  it('requires own route fields even when inherited lookups could name a valid observer', async () => {
    const observers = createObservers();
    const router = createAwsSingleNodeResourceObservationRouter({ observers });
    const inheritedTarget = Object.create({
      target: { resourceKey: 'artifact' },
    });
    const inheritedResourceKey = Object.create({ resourceKey: 'artifact' });

    await expect(
      router.observeResource(inheritedTarget),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeResourceObservationRouteUnsupportedError,
    );
    await expect(
      router.observeResource({ target: inheritedResourceKey }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeResourceObservationRouteUnsupportedError,
    );
    expect(totalObserverCalls(observers)).toBe(0);
  });
});
