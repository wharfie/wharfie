import { jest } from '@jest/globals';

import { createAwsSingleNodeDeploymentProvider } from '../../src/core/runtime/deployment-aws-provider.js';

/** @typedef {'resolveScope'|'resolveProviderSpec'|'validateProviderSpec'|'inspect'|'createPlan'|'executeAction'|'verifySettlement'} ProviderMethod */

function createPorts(overrides = {}) {
  return {
    scopeResolver: {
      resolveScope: jest.fn(),
    },
    providerSpecResolver: {
      resolveProviderSpec: jest.fn(),
      validateProviderSpec: jest.fn(),
    },
    inspectionProvider: {
      inspect: jest.fn(),
    },
    resourceRouter: {
      executeAction: jest.fn(),
      verifySettlement: jest.fn(),
    },
    createPlan: jest.fn(),
    ...overrides,
  };
}

describe('AWS single-node deployment provider', () => {
  test('composes the exact frozen seven-method controller port', () => {
    const provider = createAwsSingleNodeDeploymentProvider(createPorts());

    expect(Object.keys(provider)).toEqual([
      'resolveScope',
      'resolveProviderSpec',
      'validateProviderSpec',
      'inspect',
      'createPlan',
      'executeAction',
      'verifySettlement',
    ]);
    expect(Object.isFrozen(provider)).toBe(true);
    for (const method of Object.values(provider)) {
      expect(typeof method).toBe('function');
    }
  });

  test('delegates every capability only to its owner with exact arguments, receivers, and returns', async () => {
    /** @type {Array<[string, object, unknown]>} */
    const calls = [];
    /** @type {ProviderMethod[]} */
    const methods = [
      'resolveScope',
      'resolveProviderSpec',
      'validateProviderSpec',
      'inspect',
      'createPlan',
      'executeAction',
      'verifySettlement',
    ];
    const promises =
      /** @type {Record<ProviderMethod, Promise<Readonly<{method: ProviderMethod}>>>} */ (
        Object.fromEntries(
          methods.map((method) => [method, Promise.resolve({ method })]),
        )
      );
    const scopeResolver = {
      /** @param {unknown} context */
      resolveScope(context) {
        calls.push(['resolveScope', this, context]);
        return promises.resolveScope;
      },
    };
    const providerSpecResolver = {
      /** @param {unknown} context */
      resolveProviderSpec(context) {
        calls.push(['resolveProviderSpec', this, context]);
        return promises.resolveProviderSpec;
      },
      /** @param {unknown} context */
      validateProviderSpec(context) {
        calls.push(['validateProviderSpec', this, context]);
        return promises.validateProviderSpec;
      },
    };
    const inspectionProvider = {
      /** @param {unknown} context */
      inspect(context) {
        calls.push(['inspect', this, context]);
        return promises.inspect;
      },
    };
    const resourceRouter = {
      /** @param {unknown} context */
      executeAction(context) {
        calls.push(['executeAction', this, context]);
        return promises.executeAction;
      },
      /** @param {unknown} context */
      verifySettlement(context) {
        calls.push(['verifySettlement', this, context]);
        return promises.verifySettlement;
      },
    };
    const options = {
      scopeResolver,
      providerSpecResolver,
      inspectionProvider,
      resourceRouter,
      /** @param {unknown} context */
      createPlan(context) {
        calls.push(['createPlan', this, context]);
        return promises.createPlan;
      },
    };
    const provider = createAwsSingleNodeDeploymentProvider(options);
    const owners = /** @type {Record<ProviderMethod, object>} */ ({
      resolveScope: scopeResolver,
      resolveProviderSpec: providerSpecResolver,
      validateProviderSpec: providerSpecResolver,
      inspect: inspectionProvider,
      createPlan: options,
      executeAction: resourceRouter,
      verifySettlement: resourceRouter,
    });

    for (const method of methods) {
      const context = Object.freeze({ method });
      const returned = provider[method](context);
      expect(returned).toBe(promises[method]);
      expect(calls).toEqual([[method, owners[method], context]]);
      calls.length = 0;
      await returned;
    }
  });

  test('captures the validated functions so later port mutation cannot cross-route calls', () => {
    const ports = createPorts();
    const originalInspection = ports.inspectionProvider.inspect;
    const originalExecute = ports.resourceRouter.executeAction;
    const provider = createAwsSingleNodeDeploymentProvider(ports);
    ports.inspectionProvider.inspect = ports.resourceRouter.executeAction;
    ports.resourceRouter.executeAction = originalInspection;
    const inspectionContext = Object.freeze({ purpose: 'read' });
    const actionContext = Object.freeze({ purpose: 'mutate' });

    provider.inspect(inspectionContext);
    provider.executeAction(actionContext);

    expect(originalInspection).toHaveBeenCalledTimes(1);
    expect(originalInspection).toHaveBeenCalledWith(inspectionContext);
    expect(originalExecute).toHaveBeenCalledTimes(1);
    expect(originalExecute).toHaveBeenCalledWith(actionContext);
  });

  test('preserves synchronous throws and rejected Promise identity unchanged', async () => {
    const thrown = new Error('scope failed');
    const rejectedError = new Error('inspection failed');
    const rejected = Promise.reject(rejectedError);
    const ports = createPorts({
      scopeResolver: {
        resolveScope() {
          throw thrown;
        },
      },
      inspectionProvider: {
        inspect() {
          return rejected;
        },
      },
    });
    const provider = createAwsSingleNodeDeploymentProvider(ports);

    let observed;
    try {
      provider.resolveScope(Object.freeze({}));
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(thrown);

    const returned = provider.inspect(Object.freeze({}));
    expect(returned).toBe(rejected);
    await expect(returned).rejects.toBe(rejectedError);
  });

  test('passes a supplied createPlan port its complete argument unchanged', () => {
    const ports = createPorts();
    const provider = createAwsSingleNodeDeploymentProvider(ports);
    const input = Object.freeze({
      inspection: Object.freeze({ inspectionId: 'win6-example' }),
      plan: Object.freeze({ aggregateOnly: true }),
      settledPlan: null,
      pendingBinding: null,
    });
    const result = Object.freeze({ planId: 'wdp3-example' });
    ports.createPlan.mockReturnValue(result);

    expect(provider.createPlan(input)).toBe(result);
    expect(ports.createPlan).toHaveBeenCalledTimes(1);
    expect(ports.createPlan).toHaveBeenCalledWith(input);
  });

  test('shapes built-in pure planner input without touching aggregate-only fields', () => {
    const aggregateLeak = new Error('aggregate field leaked');
    const aggregateFields = {
      get plan() {
        throw aggregateLeak;
      },
      get settledPlan() {
        throw aggregateLeak;
      },
      get pendingBinding() {
        throw aggregateLeak;
      },
    };
    const { createPlan: _createPlan, ...ports } = createPorts();
    const provider = createAwsSingleNodeDeploymentProvider(ports);
    let observed;

    const plannerContext = {
      operation: 'unsupported-operation',
      deploymentRevision: null,
      profile: null,
      providerScope: null,
      providerSpec: null,
      deploymentInstanceId: null,
      incarnationId: null,
      head: null,
      inspection: null,
    };
    Object.defineProperties(
      plannerContext,
      Object.getOwnPropertyDescriptors(aggregateFields),
    );

    try {
      provider.createPlan(plannerContext);
    } catch (error) {
      observed = error;
    }

    expect(observed).not.toBe(aggregateLeak);
    expect(observed).toBeInstanceOf(TypeError);
    if (!(observed instanceof TypeError)) {
      throw new Error('Expected the built-in planner to reject the operation.');
    }
    expect(observed.message).toMatch(/operation is not supported/i);
  });

  test.each([null, [], () => {}, Object.create({ scopeResolver: {} })])(
    'rejects a non-plain or inherited options boundary',
    (options) => {
      expect(() => createAwsSingleNodeDeploymentProvider(options)).toThrow(
        TypeError,
      );
    },
  );

  test.each([
    'scopeResolver',
    'providerSpecResolver',
    'inspectionProvider',
    'resourceRouter',
  ])('rejects missing required option %s', (key) => {
    const options = /** @type {Record<string, unknown>} */ (createPorts());
    delete options[key];

    expect(() => createAwsSingleNodeDeploymentProvider(options)).toThrow(
      new RegExp(`${key} is required`),
    );
  });

  test('rejects extra factory options and a non-function planner', () => {
    expect(() =>
      createAwsSingleNodeDeploymentProvider({
        ...createPorts(),
        credentials: {},
      }),
    ).toThrow(/options\.credentials is not supported/i);
    expect(() =>
      createAwsSingleNodeDeploymentProvider({
        ...createPorts(),
        createPlan: {},
      }),
    ).toThrow(/options\.createPlan must be a function/i);
  });

  test.each([
    [
      'scopeResolver',
      { resolveScope: jest.fn(), resolveProviderSpec: jest.fn() },
      /scopeResolver\.resolveProviderSpec is not supported/i,
    ],
    [
      'providerSpecResolver',
      { resolveProviderSpec: jest.fn() },
      /providerSpecResolver\.validateProviderSpec is required/i,
    ],
    [
      'inspectionProvider',
      { inspect: jest.fn(), executeAction: jest.fn() },
      /inspectionProvider\.executeAction is not supported/i,
    ],
    [
      'inspectionProvider',
      { inspect: jest.fn(), verifySettlement: jest.fn() },
      /inspectionProvider\.verifySettlement is not supported/i,
    ],
    [
      'resourceRouter',
      { executeAction: jest.fn() },
      /resourceRouter\.verifySettlement is required/i,
    ],
    [
      'resourceRouter',
      { executeAction: null, verifySettlement: jest.fn() },
      /resourceRouter\.executeAction must be a function/i,
    ],
  ])('rejects invalid exact %s capability ports', (key, port, expected) => {
    expect(() =>
      createAwsSingleNodeDeploymentProvider(
        createPorts({
          [key]: port,
        }),
      ),
    ).toThrow(expected);
  });

  test('rejects inherited port methods', () => {
    const inherited = Object.create({
      inspect: jest.fn(),
    });

    expect(() =>
      createAwsSingleNodeDeploymentProvider(
        createPorts({
          inspectionProvider: inherited,
        }),
      ),
    ).toThrow(/inspectionProvider must be an object/i);
  });
});
