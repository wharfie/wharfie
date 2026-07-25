import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const INVOCATION_IMPORT = '../../src/core/runtime/deployment-aws-invocation.js';
const RUNNER_IMPORT =
  '../../src/core/runtime/deployment-aws-operation-runner.js';
/** @type {jest.Mock<(options: any) => Promise<any>>} */
const openInvocation = jest.fn();

jest.unstable_mockModule(INVOCATION_IMPORT, () => ({
  openAwsSingleNodeDeploymentInvocation: openInvocation,
}));

const { runAwsSingleNodeDeploymentOperation } = await import(RUNNER_IMPORT);

const POLICIES = Object.freeze([
  ['require-active', 'requireControl'],
  ['reconcile-existing', 'reconcileControl'],
  ['bootstrap', 'bootstrapControl'],
]);
const OPERATION_METHOD_BY_NAME = Object.freeze({
  inspect: 'inspect',
  plan: 'plan',
  converge: 'converge',
  'converge-pre-staged': 'convergePreStaged',
  resume: 'resume',
});
const OPERATIONS = Object.freeze(
  /** @type {const} */ ([
    'inspect',
    'plan',
    'converge',
    'converge-pre-staged',
    'resume',
  ]),
);
const INVOCATION_OPERATION_METHODS = Object.freeze(
  Object.values(OPERATION_METHOD_BY_NAME),
);
const AGGREGATE_MESSAGE =
  'AWS deployment operation and invocation cleanup both failed.';

/** @returns {{promise: Promise<any>, resolve: (value: any) => void, reject: (reason: unknown) => void}} */
function deferred() {
  /** @type {(value: any) => void} */
  let settle = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  /** @type {(reason: unknown) => void} */
  let fail = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
}

/**
 * @param {Record<string, any>} [implementations] - Optional method overrides.
 * @param {boolean} [freeze] - Whether to freeze the exact surface.
 * @returns {Record<string, any>} - Invocation.
 */
function makeInvocation(implementations = {}, freeze = true) {
  /** @type {Record<string, any>} */
  const invocation = {
    providerScope: Object.freeze({
      providerScopeId: 'aws:123456789012:us-east-1',
    }),
  };
  for (const method of [
    'inspectControl',
    'requireControl',
    'reconcileControl',
    'bootstrapControl',
    ...INVOCATION_OPERATION_METHODS,
    'stageClaimedArtifact',
    'close',
  ]) {
    invocation[method] = jest.fn(
      implementations[method] ??
        (method === 'close'
          ? () => Promise.resolve()
          : () => Promise.resolve(Object.freeze({ method }))),
    );
  }
  return freeze ? Object.freeze(invocation) : invocation;
}

/** @param {Record<string, any>} [overrides] */
function request(overrides = {}) {
  return {
    region: 'us-east-1',
    controlPolicy: 'require-active',
    operation: 'inspect',
    input: { deploymentInstanceId: 'deployment-1' },
    ...overrides,
  };
}

/** @param {unknown} invocation */
function openWith(invocation) {
  openInvocation.mockImplementationOnce((_options) =>
    Promise.resolve(invocation),
  );
}

beforeEach(() => {
  openInvocation.mockReset();
});

describe('AWS single-node deployment operation runner boundary', () => {
  it('is non-async and synchronously opens only after cloning its input', async () => {
    const invocation = makeInvocation();
    const sourceInput = {
      deploymentInstanceId: 'deployment-1',
      nested: { labels: ['original'] },
    };
    let openerEntered = false;
    openInvocation.mockImplementationOnce(function open() {
      openerEntered = true;
      expect(sourceInput).toEqual({
        deploymentInstanceId: 'deployment-1',
        nested: { labels: ['original'] },
      });
      return Promise.resolve(invocation);
    });

    expect(
      Object.prototype.toString.call(runAwsSingleNodeDeploymentOperation),
    ).toBe('[object Function]');
    expect(runAwsSingleNodeDeploymentOperation).toHaveLength(1);
    const running = runAwsSingleNodeDeploymentOperation(
      request({ input: sourceInput }),
    );
    expect(openerEntered).toBe(true);
    expect(running).toBeInstanceOf(Promise);

    sourceInput.deploymentInstanceId = 'changed';
    sourceInput.nested.labels[0] = 'changed';
    await running;

    const observed = invocation.inspect.mock.calls[0][0];
    expect(observed).toEqual({
      deploymentInstanceId: 'deployment-1',
      nested: { labels: ['original'] },
    });
    expect(observed).not.toBe(sourceInput);
    expect(observed.nested).not.toBe(sourceInput.nested);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed.nested)).toBe(true);
    expect(Object.isFrozen(observed.nested.labels)).toBe(true);
  });

  it.each(
    POLICIES.flatMap(([policy, controlMethod]) =>
      OPERATIONS.map((operation) => [
        policy,
        controlMethod,
        operation,
        OPERATION_METHOD_BY_NAME[operation],
      ]),
    ),
  )(
    'maps %s through %s before receiver-preserving %s/%s',
    async (policy, controlMethod, operation, operationMethod) => {
      /** @type {{phase: string, receiver: unknown, args: any[]}[]} */
      const events = [];
      const operationResult = Object.freeze({ operationResult: operation });
      const invocation = makeInvocation({
        [controlMethod]: function control() {
          events.push({
            phase: 'control',
            receiver: this,
            args: [...arguments],
          });
          return Promise.resolve();
        },
        [operationMethod]: function run(/** @type {any} */ input) {
          events.push({
            phase: 'operation',
            receiver: this,
            args: [...arguments],
          });
          return Promise.resolve(operationResult);
        },
        close: function close() {
          events.push({
            phase: 'close',
            receiver: this,
            args: [...arguments],
          });
          return Promise.resolve();
        },
      });
      openWith(invocation);
      const input = { deploymentInstanceId: 'deployment-1' };

      await expect(
        runAwsSingleNodeDeploymentOperation(
          request({ controlPolicy: policy, operation, input }),
        ),
      ).resolves.toBe(operationResult);

      expect(openInvocation).toHaveBeenCalledWith({
        region: 'us-east-1',
      });
      expect(openInvocation.mock.contexts[0]).toBeUndefined();
      expect(events.map(({ phase }) => phase)).toEqual([
        'control',
        'operation',
        'close',
      ]);
      expect(events.every(({ receiver }) => receiver === invocation)).toBe(
        true,
      );
      expect(events[0].args).toEqual([]);
      expect(events[1].args).toEqual([input]);
      expect(events[1].args[0]).not.toBe(input);
      expect(events[2].args).toEqual([]);
      for (const otherPolicyMethod of [
        'requireControl',
        'reconcileControl',
        'bootstrapControl',
      ]) {
        expect(invocation[otherPolicyMethod]).toHaveBeenCalledTimes(
          otherPolicyMethod === controlMethod ? 1 : 0,
        );
      }
      for (const otherOperationMethod of INVOCATION_OPERATION_METHODS) {
        expect(invocation[otherOperationMethod]).toHaveBeenCalledTimes(
          otherOperationMethod === operationMethod ? 1 : 0,
        );
      }
      expect(invocation.stageClaimedArtifact).not.toHaveBeenCalled();
      expect(invocation.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    undefined,
    null,
    {},
    {
      region: 'us-east-1',
      controlPolicy: 'require-active',
      operation: 'inspect',
    },
    request({ extra: true }),
    request({ region: 1 }),
    request({ region: '' }),
    request({ region: ' us-east-1' }),
    request({ region: 'us-east-1 ' }),
    request({ controlPolicy: 'inspect' }),
    request({ controlPolicy: 'constructor' }),
    request({ controlPolicy: 'toString' }),
    request({ controlPolicy: '__proto__' }),
    request({ operation: 'apply' }),
    request({ operation: 'constructor' }),
    request({ operation: 'toString' }),
    request({ operation: '__proto__' }),
    request({ input: [] }),
    request({ input: null }),
    request({ input: { invalid: undefined } }),
    Object.assign(Object.create({}), request()),
  ])('synchronously rejects an invalid exact request %#', (candidate) => {
    expect(() => runAwsSingleNodeDeploymentOperation(candidate)).toThrow(
      'AWS deployment operation request is invalid.',
    );
    expect(openInvocation).not.toHaveBeenCalled();
  });

  it('rejects a prototype-polluted control policy before opening', () => {
    const pollutedPolicy = 'wharfieV60PollutedPolicy';
    // eslint-disable-next-line no-extend-native -- This regression proves inherited policy names cannot bypass the own-key allowlist.
    Object.defineProperty(Object.prototype, pollutedPolicy, {
      configurable: true,
      value: 'bootstrapControl',
    });
    try {
      expect(() =>
        runAwsSingleNodeDeploymentOperation(
          request({ controlPolicy: pollutedPolicy }),
        ),
      ).toThrow('AWS deployment operation request is invalid.');
      expect(openInvocation).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Object.prototype, pollutedPolicy);
    }
  });

  it('rejects accessor, symbol, and non-enumerable request properties without reading them', () => {
    const getter = jest.fn(() => 'us-east-1');
    const accessor = request();
    Object.defineProperty(accessor, 'region', {
      enumerable: true,
      get: getter,
    });
    const symbol = request();
    /** @type {Record<PropertyKey, any>} */ (symbol)[Symbol('hidden')] = true;
    const nonEnumerable = request();
    Object.defineProperty(nonEnumerable, 'region', {
      enumerable: false,
      value: 'us-east-1',
    });

    for (const candidate of [accessor, symbol, nonEnumerable]) {
      expect(() => runAwsSingleNodeDeploymentOperation(candidate)).toThrow(
        'AWS deployment operation request is invalid.',
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(openInvocation).not.toHaveBeenCalled();
  });

  it('rejects invalid nested JSON before opening and never invokes nested accessors', () => {
    const nestedGetter = jest.fn(() => 'value');
    const nested = {};
    Object.defineProperty(nested, 'value', {
      enumerable: true,
      get: nestedGetter,
    });

    expect(() =>
      runAwsSingleNodeDeploymentOperation(request({ input: { nested } })),
    ).toThrow('AWS deployment operation request is invalid.');
    expect(nestedGetter).not.toHaveBeenCalled();
    expect(openInvocation).not.toHaveBeenCalled();
  });

  it('has no callback seam outside the production opener import', async () => {
    const invocation = makeInvocation();
    openWith(invocation);
    const rogueOpen = jest.fn();

    await Reflect.apply(runAwsSingleNodeDeploymentOperation, undefined, [
      request(),
      { openInvocation: rogueOpen },
    ]);

    expect(openInvocation).toHaveBeenCalledTimes(1);
    expect(rogueOpen).not.toHaveBeenCalled();
  });

  it('accepts only an exact frozen twelve-key invocation before taking ownership', async () => {
    const getter = jest.fn();
    const mutable = makeInvocation({}, false);
    const extra = makeInvocation({}, false);
    extra.extra = true;
    Object.freeze(extra);
    const missing = makeInvocation({}, false);
    delete missing.inspectControl;
    Object.freeze(missing);
    const accessor = makeInvocation({}, false);
    Object.defineProperty(accessor, 'inspect', {
      configurable: true,
      enumerable: true,
      get: getter,
    });
    Object.freeze(accessor);
    const nonEnumerable = makeInvocation({}, false);
    Object.defineProperty(nonEnumerable, 'inspectControl', {
      configurable: true,
      enumerable: false,
      value: nonEnumerable.inspectControl,
    });
    Object.freeze(nonEnumerable);

    for (const candidate of [
      mutable,
      extra,
      missing,
      accessor,
      nonEnumerable,
    ]) {
      openWith(candidate);
      await expect(
        runAwsSingleNodeDeploymentOperation(request()),
      ).rejects.toThrow('AWS deployment operation invocation is invalid.');
      expect(candidate.requireControl).not.toHaveBeenCalled();
      expect(candidate.close).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('captures every method from a valid exact frozen invocation before action', async () => {
    const originalResult = Object.freeze({ original: true });
    const invocation = makeInvocation({
      requireControl() {
        expect(() => {
          invocation.inspect = jest.fn();
        }).toThrow(TypeError);
        return Promise.resolve();
      },
      inspect: () => Promise.resolve(originalResult),
      close: () => Promise.resolve(),
    });
    const originalInspect = invocation.inspect;
    const originalClose = invocation.close;
    openWith(invocation);

    await expect(runAwsSingleNodeDeploymentOperation(request())).resolves.toBe(
      originalResult,
    );

    expect(originalInspect).toHaveBeenCalledTimes(1);
    expect(originalClose).toHaveBeenCalledTimes(1);
    expect(invocation.inspect).toBe(originalInspect);
    expect(invocation.close).toBe(originalClose);
  });

  it('rejects a non-function method before policy or operation work', async () => {
    const invocation = makeInvocation({}, false);
    invocation.inspectControl = true;
    Object.freeze(invocation);
    openWith(invocation);

    await expect(
      runAwsSingleNodeDeploymentOperation(request()),
    ).rejects.toThrow('AWS deployment operation invocation is invalid.');
    expect(invocation.requireControl).not.toHaveBeenCalled();
    expect(invocation.inspect).not.toHaveBeenCalled();
    expect(invocation.close).not.toHaveBeenCalled();
  });

  it('does not start cleanup until an in-flight operation settles', async () => {
    const operation = deferred();
    const invocation = makeInvocation({
      inspect: () => operation.promise,
    });
    openWith(invocation);
    const running = runAwsSingleNodeDeploymentOperation(request());
    await Promise.resolve();
    await Promise.resolve();

    expect(invocation.inspect).toHaveBeenCalledTimes(1);
    expect(invocation.close).not.toHaveBeenCalled();

    const result = Object.freeze({ settled: true });
    operation.resolve(result);
    await expect(running).resolves.toBe(result);
    expect(invocation.close).toHaveBeenCalledTimes(1);
  });
});

describe('AWS deployment operation and cleanup failure precedence', () => {
  it.each(['throw', 'reject'])(
    'does not clean up when opening credentials %s',
    async (mode) => {
      const openError = new Error('open failed');
      const invocation = makeInvocation();
      openInvocation.mockImplementationOnce(() => {
        if (mode === 'throw') throw openError;
        return Promise.reject(openError);
      });

      await expect(runAwsSingleNodeDeploymentOperation(request())).rejects.toBe(
        openError,
      );
      expect(invocation.close).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['control throws', 'requireControl', 'throw'],
    ['control rejects', 'requireControl', 'reject'],
    ['operation throws', 'inspect', 'throw'],
    ['operation rejects', 'inspect', 'reject'],
  ])(
    'preserves the primary failure unchanged and closes when %s',
    async (_label, failingMethod, mode) => {
      const primaryError = new Error('primary failed');
      const invocation = makeInvocation({
        [failingMethod]: () => {
          if (mode === 'throw') throw primaryError;
          return Promise.reject(primaryError);
        },
      });
      openWith(invocation);

      await expect(runAwsSingleNodeDeploymentOperation(request())).rejects.toBe(
        primaryError,
      );
      expect(invocation.close).toHaveBeenCalledTimes(1);
      expect(invocation.inspect).toHaveBeenCalledTimes(
        failingMethod === 'requireControl' ? 0 : 1,
      );
    },
  );

  it.each(['throw', 'reject'])(
    'surfaces cleanup failure after operation success when close %s',
    async (mode) => {
      const cleanupError = new Error('cleanup failed');
      const invocation = makeInvocation({
        close: () => {
          if (mode === 'throw') throw cleanupError;
          return Promise.reject(cleanupError);
        },
      });
      openWith(invocation);

      await expect(runAwsSingleNodeDeploymentOperation(request())).rejects.toBe(
        cleanupError,
      );
      expect(invocation.inspect).toHaveBeenCalledTimes(1);
      expect(invocation.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['throw', 'throw'],
    ['throw', 'reject'],
    ['reject', 'throw'],
    ['reject', 'reject'],
  ])(
    'aggregates ordered primary and cleanup failures for %s/%s settlement',
    async (primaryMode, cleanupMode) => {
      const primaryError = new Error('primary failed');
      const cleanupError = new Error('cleanup failed');
      const invocation = makeInvocation({
        inspect: () => {
          if (primaryMode === 'throw') throw primaryError;
          return Promise.reject(primaryError);
        },
        close: () => {
          if (cleanupMode === 'throw') throw cleanupError;
          return Promise.reject(cleanupError);
        },
      });
      openWith(invocation);

      const failure = await runAwsSingleNodeDeploymentOperation(
        request(),
      ).catch((/** @type {unknown} */ error) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.message).toBe(AGGREGATE_MESSAGE);
      expect(/** @type {AggregateError} */ (failure).errors).toEqual([
        primaryError,
        cleanupError,
      ]);
      expect(invocation.close).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves undefined and non-Error failures in the ordered aggregate', async () => {
    const invocation = makeInvocation({
      // eslint-disable-next-line prefer-promise-reject-errors -- Promise rejection reasons are intentionally untrusted boundary values.
      inspect: () => Promise.reject(undefined),
      // eslint-disable-next-line prefer-promise-reject-errors -- Promise rejection reasons are intentionally untrusted boundary values.
      close: () => Promise.reject('cleanup failed'),
    });
    openWith(invocation);

    const failure = await runAwsSingleNodeDeploymentOperation(request()).catch(
      (/** @type {unknown} */ error) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toBe(AGGREGATE_MESSAGE);
    expect(/** @type {AggregateError} */ (failure).errors).toEqual([
      undefined,
      'cleanup failed',
    ]);
  });

  it('surfaces an undefined cleanup rejection after success', async () => {
    const invocation = makeInvocation({
      // eslint-disable-next-line prefer-promise-reject-errors -- This proves undefined cleanup failure is not mistaken for success.
      close: () => Promise.reject(undefined),
    });
    openWith(invocation);
    const marker = Symbol('unexpected resolution');

    const failure = await runAwsSingleNodeDeploymentOperation(request()).then(
      () => marker,
      (/** @type {unknown} */ error) => error,
    );

    expect(failure).toBeUndefined();
    expect(failure).not.toBe(marker);
  });
});
