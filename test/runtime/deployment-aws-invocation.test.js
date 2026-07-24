import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const INVOCATION_IMPORT = '../../src/core/runtime/deployment-aws-invocation.js';
const PROVIDER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
});
const CLIENT_KEYS = Object.freeze([
  'deploymentStore',
  'dynamoControl',
  's3Control',
  'providerSpecRead',
  'managedArtifact',
  'volume',
  'network',
  'runtimeIdentity',
  'node',
  'volumeAttachment',
]);
const INVOCATION_KEYS = Object.freeze([
  'providerScope',
  'inspectControl',
  'requireControl',
  'reconcileControl',
  'bootstrapControl',
  'plan',
  'converge',
  'resume',
  'close',
]);
const CONTROL_TABLE_NAME = 'wharfie-deployment-control-v1';

/** @type {Record<string, any>} */
let openedFamily;
/** @type {Record<string, jest.Mock<(...args: any[]) => any>>} */
let tableLifecycle;
/** @type {Record<string, jest.Mock<(...args: any[]) => any>>} */
let bucketLifecycle;
/** @type {Record<string, any>} */
let store;
/** @type {Record<string, any>} */
let artifactStager;
/** @type {Record<string, any>} */
let provider;
/** @type {Record<string, jest.Mock<(...args: any[]) => any>>} */
let controller;

/** @type {jest.Mock<(options: any) => Promise<any>>} */
const openClientFamily = jest.fn(async (_options) => openedFamily);
/** @type {jest.Mock<(options: any) => any>} */
const createTableLifecycle = jest.fn((_options) => tableLifecycle);
/** @type {jest.Mock<(options: any) => any>} */
const createBucketLifecycle = jest.fn((_options) => bucketLifecycle);
/** @type {jest.Mock<(options: any) => any>} */
const createStore = jest.fn((_options) => store);
/** @type {jest.Mock<(options: any) => any>} */
const createArtifactStager = jest.fn((_options) => artifactStager);
/** @type {jest.Mock<(options: any) => any>} */
const createProvider = jest.fn((_options) => provider);
/** @type {jest.Mock<(options: any) => any>} */
const createController = jest.fn((_options) => controller);

jest.unstable_mockModule(
  '../../src/core/runtime/deployment-aws-client-family.js',
  () => ({
    openAwsDeploymentClientFamily: openClientFamily,
  }),
);
jest.unstable_mockModule(
  '../../src/core/runtime/deployment-aws-provider-assembly.js',
  () => ({
    createAwsSingleNodeDeploymentProviderFromClientFamily: createProvider,
  }),
);
jest.unstable_mockModule(
  '../../src/core/runtime/deployment-artifact-stager.js',
  () => ({
    createDeploymentArtifactStager: createArtifactStager,
  }),
);
jest.unstable_mockModule(
  '../../src/core/runtime/deployment-control-bucket.js',
  () => ({
    createDeploymentControlBucket: createBucketLifecycle,
  }),
);
jest.unstable_mockModule(
  '../../src/core/runtime/deployment-control-store.js',
  () => ({
    createDeploymentControlStore: createStore,
  }),
);
jest.unstable_mockModule(
  '../../src/core/runtime/deployment-control-table.js',
  () => ({
    createDeploymentControlTableLifecycle: createTableLifecycle,
    DEPLOYMENT_CONTROL_TABLE_NAME: CONTROL_TABLE_NAME,
  }),
);
jest.unstable_mockModule(
  '../../src/core/runtime/deployment-controller.js',
  () => ({
    createDeploymentController: createController,
  }),
);

const {
  AwsDeploymentControlNotReadyError,
  AwsDeploymentInvocationClosedError,
  createAwsSingleNodeDeploymentInvocationFromClientFamily,
  openAwsSingleNodeDeploymentInvocation,
} = await import(INVOCATION_IMPORT);

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
  return {
    promise,
    resolve: settle,
    reject: fail,
  };
}

/** @param {'active'|'bootstrap-required'|'absent'|'creating'} [status] */
function tableState(status = 'active') {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'deploymentControlTableInspection',
    providerScopeId: PROVIDER_SCOPE.providerScopeId,
    status,
  });
}

/** @param {'active'|'bootstrap-required'|'absent'} [status] */
function bucketState(status = 'active') {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'deploymentControlBucketInspection',
    providerScopeId: PROVIDER_SCOPE.providerScopeId,
    status,
  });
}

/** @returns {Record<string, any>} */
function makeFamily() {
  const clients = Object.freeze(
    Object.fromEntries(
      CLIENT_KEYS.map((key) => [key, Object.freeze({ clientKey: key })]),
    ),
  );
  /** @type {Record<string, any>} */
  const family = {
    providerScope: PROVIDER_SCOPE,
    scopeResolver: Object.freeze({ resolveScope: jest.fn() }),
    clients,
    close: jest.fn(function closeFamily() {
      return Promise.resolve();
    }),
  };
  return Object.freeze(family);
}

/** @param {Record<string, any>} [family] @param {Record<string, any>} [extra] */
function createInvocation(family = openedFamily, extra = {}) {
  return createAwsSingleNodeDeploymentInvocationFromClientFamily({
    clientFamily: family,
    ...extra,
  });
}

beforeEach(() => {
  openedFamily = makeFamily();
  tableLifecycle = {
    inspect: jest.fn(async () => tableState()),
    reconcile: jest.fn(async () => tableState()),
    bootstrap: jest.fn(async () => tableState()),
  };
  bucketLifecycle = {
    inspect: jest.fn(async () => bucketState()),
    reconcile: jest.fn(async () => bucketState()),
    bootstrap: jest.fn(async () => bucketState()),
  };
  store = Object.freeze({ store: true });
  artifactStager = Object.freeze({ artifactStager: true });
  provider = Object.freeze({ provider: true });
  controller = {
    plan: jest.fn(async (input) => Object.freeze({ kind: 'plan', input })),
    converge: jest.fn(async (input) =>
      Object.freeze({ kind: 'converged-head', input }),
    ),
    resume: jest.fn(async (input) =>
      Object.freeze({ kind: 'resumed-head', input }),
    ),
  };
  for (const mock of [
    openClientFamily,
    createTableLifecycle,
    createBucketLifecycle,
    createStore,
    createArtifactStager,
    createProvider,
    createController,
  ]) {
    mock.mockClear();
  }
});

describe('AWS single-node deployment invocation construction', () => {
  it('purely composes the real port graph and exposes only the owned API', () => {
    const now = jest.fn(() => 1_700_000_000_000);
    const waitForRetry = jest.fn();
    const invocation = createInvocation(openedFamily, {
      now,
      maxAttempts: 4,
      waitForRetry,
    });

    expect(Object.keys(invocation)).toEqual(INVOCATION_KEYS);
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(invocation.providerScope).toEqual(PROVIDER_SCOPE);
    expect(invocation).not.toHaveProperty('clientFamily');
    expect(invocation).not.toHaveProperty('clients');
    expect(invocation).not.toHaveProperty('controller');
    expect(invocation).not.toHaveProperty('store');
    expect(invocation).not.toHaveProperty('provider');

    expect(createTableLifecycle).toHaveBeenCalledWith({
      client: openedFamily.clients.dynamoControl,
      providerScope: PROVIDER_SCOPE,
    });
    expect(createBucketLifecycle).toHaveBeenCalledWith({
      client: openedFamily.clients.s3Control,
      providerScope: PROVIDER_SCOPE,
    });
    expect(createStore).toHaveBeenCalledWith({
      db: openedFamily.clients.deploymentStore,
      tableName: CONTROL_TABLE_NAME,
    });
    expect(createArtifactStager).toHaveBeenCalledWith({
      client: openedFamily.clients.s3Control,
      store,
    });
    expect(createProvider).toHaveBeenCalledWith({
      clientFamily: openedFamily,
      now,
      maxAttempts: 4,
      waitForRetry,
    });
    expect(createController).toHaveBeenCalledWith({
      store,
      provider,
      artifactStager,
      now,
    });

    for (const lifecycle of [tableLifecycle, bucketLifecycle]) {
      expect(lifecycle.inspect).not.toHaveBeenCalled();
      expect(lifecycle.reconcile).not.toHaveBeenCalled();
      expect(lifecycle.bootstrap).not.toHaveBeenCalled();
    }
    expect(controller.plan).not.toHaveBeenCalled();
    expect(controller.converge).not.toHaveBeenCalled();
    expect(controller.resume).not.toHaveBeenCalled();
    expect(openedFamily.close).not.toHaveBeenCalled();
  });

  it('claims a family exactly once only after successful construction', async () => {
    const family = makeFamily();
    const constructionFailure = new Error('constructor failed');
    createController.mockImplementationOnce(() => {
      throw constructionFailure;
    });

    expect(() => createInvocation(family)).toThrow(constructionFailure);
    expect(family.close).not.toHaveBeenCalled();

    const invocation = createInvocation(family);
    expect(() => createInvocation(family)).toThrow(
      'AWS deployment invocation client family is already owned.',
    );
    await invocation.close();
    expect(family.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { clientFamily: null },
    { clientFamily: makeFamily(), unsupported: true },
    { clientFamily: makeFamily(), now: 1 },
    { clientFamily: makeFamily(), maxAttempts: 1 },
    { clientFamily: makeFamily(), maxAttempts: 11 },
    { clientFamily: makeFamily(), waitForRetry: true },
  ])('rejects an invalid exact factory surface %#', (options) => {
    expect(() =>
      createAwsSingleNodeDeploymentInvocationFromClientFamily(options),
    ).toThrow(TypeError);
    expect(createTableLifecycle).not.toHaveBeenCalled();
  });

  it('rejects hidden, accessor, symbol, and incomplete family surfaces', () => {
    const accessorOptions = {};
    Object.defineProperty(accessorOptions, 'clientFamily', {
      enumerable: true,
      get: () => openedFamily,
    });
    expect(() =>
      createAwsSingleNodeDeploymentInvocationFromClientFamily(accessorOptions),
    ).toThrow('AWS deployment invocation options are invalid.');

    const symbolOptions = {
      clientFamily: openedFamily,
      [Symbol('hidden')]: true,
    };
    expect(() =>
      createAwsSingleNodeDeploymentInvocationFromClientFamily(symbolOptions),
    ).toThrow('AWS deployment invocation options are invalid.');

    const incompleteFamily = {
      providerScope: PROVIDER_SCOPE,
      scopeResolver: openedFamily.scopeResolver,
      clients: Object.freeze({}),
      close: jest.fn(),
    };
    expect(() => createInvocation(incompleteFamily)).toThrow(
      'AWS deployment invocation client family is invalid.',
    );
  });
});

describe('AWS deployment control orchestration', () => {
  it('returns one frozen aggregate and reduces every non-active pair to bootstrap-required', async () => {
    const invocation = createInvocation();
    const active = await invocation.inspectControl();

    expect(active).toEqual({
      schemaVersion: 1,
      kind: 'awsDeploymentControlInspection',
      providerScopeId: PROVIDER_SCOPE.providerScopeId,
      status: 'active',
      table: tableState(),
      bucket: bucketState(),
    });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.table)).toBe(true);
    expect(Object.isFrozen(active.bucket)).toBe(true);

    tableLifecycle.inspect.mockResolvedValueOnce(
      tableState('bootstrap-required'),
    );
    const pending = await invocation.inspectControl();
    expect(pending.status).toBe('bootstrap-required');
    expect(pending.table.status).toBe('bootstrap-required');
    expect(pending.bucket.status).toBe('active');
  });

  it('requires both controls to be active before controller delegation', async () => {
    tableLifecycle.inspect.mockResolvedValue(tableState('absent'));
    const invocation = createInvocation();
    const input = Object.freeze({ request: 'plan' });

    await expect(invocation.requireControl()).rejects.toMatchObject({
      name: 'AwsDeploymentControlNotReadyError',
      code: 'AWS_DEPLOYMENT_CONTROL_NOT_READY',
      message: 'AWS deployment control resources are not active.',
    });
    await expect(invocation.plan(input)).rejects.toBeInstanceOf(
      AwsDeploymentControlNotReadyError,
    );
    expect(controller.plan).not.toHaveBeenCalled();
    expect(tableLifecycle.inspect).toHaveBeenCalledTimes(2);
    expect(bucketLifecycle.inspect).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['plan', 'plan'],
    ['converge', 'converge'],
    ['resume', 'resume'],
  ])(
    'gates and delegates %s with the exact input and controller receiver',
    async (publicMethod, controllerMethod) => {
      const invocation = createInvocation();
      const input = Object.freeze({ method: publicMethod });

      const result = await invocation[publicMethod](input);

      expect(result.input).toBe(input);
      expect(controller[controllerMethod]).toHaveBeenCalledWith(input);
      expect(controller[controllerMethod].mock.contexts[0]).toBe(controller);
      expect(tableLifecycle.inspect).toHaveBeenCalledTimes(1);
      expect(bucketLifecycle.inspect).toHaveBeenCalledTimes(1);
    },
  );

  it('preflights both controls before explicit reconcile and never bootstraps', async () => {
    const tableInspection = deferred();
    const bucketInspection = deferred();
    tableLifecycle.inspect.mockReturnValueOnce(tableInspection.promise);
    bucketLifecycle.inspect.mockReturnValueOnce(bucketInspection.promise);
    const invocation = createInvocation();

    const reconciliation = invocation.reconcileControl();
    expect(tableLifecycle.reconcile).not.toHaveBeenCalled();
    expect(bucketLifecycle.reconcile).not.toHaveBeenCalled();

    tableInspection.resolve(tableState('bootstrap-required'));
    await Promise.resolve();
    expect(tableLifecycle.reconcile).not.toHaveBeenCalled();
    bucketInspection.resolve(bucketState('bootstrap-required'));

    await expect(reconciliation).resolves.toMatchObject({ status: 'active' });
    expect(tableLifecycle.reconcile).toHaveBeenCalledTimes(1);
    expect(bucketLifecycle.reconcile).toHaveBeenCalledTimes(1);
    expect(tableLifecycle.bootstrap).not.toHaveBeenCalled();
    expect(bucketLifecycle.bootstrap).not.toHaveBeenCalled();
  });

  it('preflights both controls before explicit concurrent bootstrap', async () => {
    const tableInspection = deferred();
    const bucketInspection = deferred();
    tableLifecycle.inspect.mockReturnValueOnce(tableInspection.promise);
    bucketLifecycle.inspect.mockReturnValueOnce(bucketInspection.promise);
    const invocation = createInvocation();

    const bootstrap = invocation.bootstrapControl();
    expect(tableLifecycle.bootstrap).not.toHaveBeenCalled();
    expect(bucketLifecycle.bootstrap).not.toHaveBeenCalled();

    bucketInspection.resolve(bucketState('absent'));
    await Promise.resolve();
    expect(tableLifecycle.bootstrap).not.toHaveBeenCalled();
    tableInspection.resolve(tableState('absent'));

    await expect(bootstrap).resolves.toMatchObject({ status: 'active' });
    expect(tableLifecycle.bootstrap).toHaveBeenCalledTimes(1);
    expect(bucketLifecycle.bootstrap).toHaveBeenCalledTimes(1);
    expect(tableLifecycle.reconcile).not.toHaveBeenCalled();
    expect(bucketLifecycle.reconcile).not.toHaveBeenCalled();
  });

  it('waits for both pair results and chooses table failure deterministically', async () => {
    const tableError = new Error('table failure');
    const bucketError = new Error('bucket failure');
    const bucketInspection = deferred();
    tableLifecycle.inspect.mockImplementationOnce(() => {
      throw tableError;
    });
    bucketLifecycle.inspect.mockReturnValueOnce(bucketInspection.promise);
    const invocation = createInvocation();

    const inspection = invocation.inspectControl();
    const outcome = inspection.then(
      (/** @type {unknown} */ value) => ({ status: 'fulfilled', value }),
      (/** @type {unknown} */ reason) => ({ status: 'rejected', reason }),
    );
    let settled = false;
    outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const close = invocation.close();
    expect(openedFamily.close).not.toHaveBeenCalled();
    bucketInspection.reject(bucketError);

    await expect(outcome).resolves.toEqual({
      status: 'rejected',
      reason: tableError,
    });
    await close;
    expect(openedFamily.close).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed lifecycle state only after both inspections settle', async () => {
    const bucketInspection = deferred();
    tableLifecycle.inspect.mockResolvedValueOnce(
      Object.freeze({
        ...tableState(),
        providerScopeId: 'aws:000000000000:us-west-2',
      }),
    );
    bucketLifecycle.inspect.mockReturnValueOnce(bucketInspection.promise);
    const invocation = createInvocation();

    const inspection = invocation.inspectControl();
    let settled = false;
    inspection.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    bucketInspection.resolve(bucketState());
    await expect(inspection).rejects.toThrow(
      'AWS deployment control inspection is invalid.',
    );
    expect(tableLifecycle.inspect).toHaveBeenCalledTimes(1);
    expect(bucketLifecycle.inspect).toHaveBeenCalledTimes(1);
  });

  it('rejects a control document with the wrong schema or kind', async () => {
    const invocation = createInvocation();
    tableLifecycle.inspect.mockResolvedValueOnce(
      Object.freeze({
        ...tableState(),
        kind: 'deploymentControlBucketInspection',
      }),
    );

    await expect(invocation.inspectControl()).rejects.toThrow(
      'AWS deployment control inspection is invalid.',
    );
    expect(bucketLifecycle.inspect).toHaveBeenCalledTimes(1);
  });
});

describe('AWS deployment invocation ownership lifecycle', () => {
  it('fences immediately, waits for entered work, and memoizes one family close', async () => {
    const entered = deferred();
    const operation = deferred();
    controller.plan.mockImplementationOnce(function planController() {
      entered.resolve(undefined);
      return operation.promise;
    });
    const invocation = createInvocation();
    const input = Object.freeze({ request: 'active-plan' });
    const active = invocation.plan(input);
    await entered.promise;

    const firstClose = invocation.close();
    const secondClose = invocation.close();
    expect(firstClose).toBe(secondClose);
    expect(openedFamily.close).not.toHaveBeenCalled();

    for (const method of [
      'inspectControl',
      'requireControl',
      'reconcileControl',
      'bootstrapControl',
      'plan',
      'converge',
      'resume',
    ]) {
      expect(() => invocation[method]({})).toThrow(
        AwsDeploymentInvocationClosedError,
      );
    }

    const result = Object.freeze({ kind: 'plan' });
    operation.resolve(result);
    await expect(active).resolves.toBe(result);
    await expect(firstClose).resolves.toBeUndefined();
    expect(openedFamily.close).toHaveBeenCalledTimes(1);
    expect(openedFamily.close.mock.contexts[0]).toBe(openedFamily);
  });

  it('keeps the close fence and memoized promise when family close throws', async () => {
    const closeError = new Error('family close failed');
    openedFamily.close.mockImplementationOnce(function closeFamily() {
      throw closeError;
    });
    const invocation = createInvocation();

    const firstClose = invocation.close();
    const secondClose = invocation.close();

    expect(firstClose).toBe(secondClose);
    await expect(firstClose).rejects.toBe(closeError);
    expect(invocation.close()).toBe(firstClose);
    expect(openedFamily.close).toHaveBeenCalledTimes(1);
    expect(openedFamily.close.mock.contexts[0]).toBe(openedFamily);
    expect(() => invocation.inspectControl()).toThrow(
      AwsDeploymentInvocationClosedError,
    );
  });
});

describe('opening an AWS deployment invocation', () => {
  it.each([
    null,
    {},
    { region: 1 },
    { region: 'us-east-1', unsupported: true },
    { region: 'us-east-1', now: 1 },
    { region: 'us-east-1', maxAttempts: 1 },
    { region: 'us-east-1', maxAttempts: 11 },
    { region: 'us-east-1', waitForRetry: true },
  ])(
    'rejects invalid exact open options before opening credentials %#',
    async (options) => {
      await expect(
        openAwsSingleNodeDeploymentInvocation(options),
      ).rejects.toThrow('AWS deployment invocation open options are invalid.');
      expect(openClientFamily).not.toHaveBeenCalled();
    },
  );

  it('rejects accessor and symbol open options before opening credentials', async () => {
    const accessor = {};
    Object.defineProperty(accessor, 'region', {
      enumerable: true,
      get: () => 'us-east-1',
    });
    await expect(
      openAwsSingleNodeDeploymentInvocation(accessor),
    ).rejects.toThrow('AWS deployment invocation open options are invalid.');

    await expect(
      openAwsSingleNodeDeploymentInvocation({
        region: 'us-east-1',
        [Symbol('hidden')]: true,
      }),
    ).rejects.toThrow('AWS deployment invocation open options are invalid.');
    expect(openClientFamily).not.toHaveBeenCalled();
  });

  it('opens one exact regional family and transfers it into the facade', async () => {
    const now = jest.fn(() => 1_700_000_000_000);
    const waitForRetry = jest.fn();

    const invocation = await openAwsSingleNodeDeploymentInvocation({
      region: 'us-east-1',
      now,
      maxAttempts: 5,
      waitForRetry,
    });

    expect(openClientFamily).toHaveBeenCalledWith({ region: 'us-east-1' });
    expect(createProvider).toHaveBeenCalledWith({
      clientFamily: openedFamily,
      now,
      maxAttempts: 5,
      waitForRetry,
    });
    expect(invocation.providerScope).toEqual(PROVIDER_SCOPE);
    expect(openedFamily.close).not.toHaveBeenCalled();
    await invocation.close();
    expect(openedFamily.close).toHaveBeenCalledTimes(1);
  });

  it('best-effort closes a newly opened family when transfer fails', async () => {
    const transferError = new Error('transfer failed');
    const closeError = new Error('close failed');
    createTableLifecycle.mockImplementationOnce(() => {
      throw transferError;
    });
    openedFamily.close.mockRejectedValueOnce(closeError);

    await expect(
      openAwsSingleNodeDeploymentInvocation({ region: 'us-east-1' }),
    ).rejects.toBe(transferError);

    expect(openClientFamily).toHaveBeenCalledTimes(1);
    expect(openedFamily.close).toHaveBeenCalledTimes(1);
    expect(openedFamily.close.mock.contexts[0]).toBe(openedFamily);
  });
});
