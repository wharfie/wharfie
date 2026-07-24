import { jest } from '@jest/globals';

import {
  AwsDeploymentClientFamilyCloseError,
  AwsDeploymentClientFamilyInitializationError,
  createAwsDeploymentClientFamilyFromAuthority,
  openAwsDeploymentClientFamily,
} from '../../src/core/runtime/deployment-aws-client-family.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  assertDBClientAdapterIdentity,
  DB_ADAPTER_NAMES,
} from '../../src/core/lib/db/base.js';

/** @type {Readonly<Array<Readonly<Array<string>>>>} */
const CLIENT_DEFINITIONS = Object.freeze([
  ['deploymentStore', 'createDynamoDB'],
  ['dynamoControl', 'createDynamoDBControlClient'],
  ['s3Control', 'createS3ControlClient'],
  ['providerSpecRead', 'createProviderSpecReadClient'],
  ['managedArtifact', 'createManagedArtifactResourceClient'],
  ['volume', 'createVolumeResourceClient'],
  ['network', 'createNetworkResourceClient'],
  ['runtimeIdentity', 'createRuntimeIdentityResourceClient'],
  ['node', 'createNodeResourceClient'],
  ['volumeAttachment', 'createVolumeAttachmentResourceClient'],
]);
/** @type {Readonly<Record<string, Readonly<Array<string>>>>} */
const CLIENT_METHODS = Object.freeze({
  deploymentStore: Object.freeze([
    'query',
    'queryPage',
    'batchWrite',
    'transactionWrite',
    'update',
    'put',
    'get',
    'remove',
    'close',
  ]),
  dynamoControl: Object.freeze([
    'createTable',
    'describeContinuousBackups',
    'describeTable',
    'describeTimeToLive',
    'listTagsOfResource',
    'updateContinuousBackups',
    'close',
  ]),
  s3Control: Object.freeze([
    'createBucket',
    'headBucket',
    'getBucketEncryption',
    'getBucketLifecycleConfiguration',
    'getBucketLocation',
    'getBucketOwnershipControls',
    'getBucketPolicy',
    'getBucketReplication',
    'getBucketTagging',
    'getBucketVersioning',
    'getPublicAccessBlock',
    'getObject',
    'putBucketEncryption',
    'putBucketLifecycleConfiguration',
    'putBucketOwnershipControls',
    'putBucketVersioning',
    'putPublicAccessBlock',
    'putObject',
    'headObject',
    'close',
  ]),
  providerSpecRead: Object.freeze([
    'getParameter',
    'describeAvailabilityZones',
    'describeImages',
    'describeInstanceTypeOfferings',
    'getEbsDefaultKmsKeyId',
    'close',
  ]),
  managedArtifact: Object.freeze([
    'copyObject',
    'headObject',
    'listObjectVersions',
    'deleteObjectVersion',
    'close',
  ]),
  volume: Object.freeze(['createVolume', 'describeVolumes', 'close']),
  network: Object.freeze([
    'associateRouteTable',
    'attachInternetGateway',
    'createInternetGateway',
    'createRoute',
    'createRouteTable',
    'createSecurityGroup',
    'createSubnet',
    'createVpc',
    'describeInternetGateways',
    'describeRouteTables',
    'describeSecurityGroups',
    'describeSubnets',
    'describeVpcs',
    'describeVpcAttribute',
    'disassociateRouteTable',
    'detachInternetGateway',
    'deleteInternetGateway',
    'deleteRoute',
    'deleteRouteTable',
    'deleteSecurityGroup',
    'deleteSubnet',
    'deleteVpc',
    'close',
  ]),
  runtimeIdentity: Object.freeze([
    'createRole',
    'getRole',
    'deleteRole',
    'listRoleTags',
    'listRolePolicies',
    'listAttachedRolePolicies',
    'putRolePolicy',
    'getRolePolicy',
    'deleteRolePolicy',
    'createInstanceProfile',
    'getInstanceProfile',
    'deleteInstanceProfile',
    'listInstanceProfileTags',
    'addRoleToInstanceProfile',
    'removeRoleFromInstanceProfile',
    'listInstanceProfilesForRole',
    'describeInstances',
    'close',
  ]),
  node: Object.freeze([
    'runInstances',
    'startInstances',
    'describeInstances',
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeVolumes',
    'terminateInstances',
    'close',
  ]),
  volumeAttachment: Object.freeze([
    'attachVolume',
    'detachVolume',
    'modifyInstanceAttribute',
    'describeInstances',
    'describeVolumes',
    'close',
  ]),
});
const AUTHORITY_KEYS = Object.freeze([
  'providerScope',
  'resolveScope',
  'createDynamoDB',
  'createDynamoDBControlClient',
  'createS3ControlClient',
  'createManagedArtifactResourceClient',
  'createProviderSpecReadClient',
  'createVolumeResourceClient',
  'createNodeResourceClient',
  'createVolumeAttachmentResourceClient',
  'createNetworkResourceClient',
  'createRuntimeIdentityResourceClient',
  'close',
]);
const PROVIDER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
});

/**
 * @param {{
 *   events?: string[],
 *   factoryFailure?: string,
 *   syncCloseFailures?: Set<string>,
 *   asyncCloseFailures?: Set<string>,
 *   authorityCloseFailure?: 'sync'|'async',
 *   closeOverrides?: Record<string, () => unknown>,
 * }} [options]
 * @returns {{authority: Record<string, any>, clients: Record<string, Record<string, any>>, calls: Array<[string, object, unknown[]]>, clientCalls: Array<[string, string, object, unknown[]]>, methodResults: Record<string, Promise<unknown>>}}
 */
function createAuthority(options = {}) {
  const events = options.events ?? [];
  /** @type {Array<[string, object, unknown[]]>} */
  const calls = [];
  /** @type {Array<[string, string, object, unknown[]]>} */
  const clientCalls = [];
  /** @type {Record<string, Promise<unknown>>} */
  const methodResults = {};
  /** @type {Record<string, Record<string, any>>} */
  const clients = {};
  for (const [clientKey] of CLIENT_DEFINITIONS) {
    clients[clientKey] = {
      clientKey,
      credentials: `sensitive ${clientKey} credentials`,
    };
    for (const method of CLIENT_METHODS[clientKey]) {
      if (method === 'close') continue;
      const result = Promise.resolve(Object.freeze({ clientKey, method }));
      methodResults[`${clientKey}.${method}`] = result;
      clients[clientKey][method] = jest.fn(
        /**
         * @this {Record<string, any>}
         * @param {...any} args
         */
        function clientMethod(...args) {
          clientCalls.push([clientKey, method, this, args]);
          return result;
        },
      );
    }
    clients[clientKey].close = jest.fn(
      /** @this {Record<string, any>} */
      function closeClient() {
        events.push(`${clientKey}:close`);
        if (options.syncCloseFailures?.has(clientKey)) {
          throw new Error(`sensitive ${clientKey} close failure`);
        }
        if (options.asyncCloseFailures?.has(clientKey)) {
          return Promise.reject(
            new Error(`sensitive ${clientKey} async close failure`),
          );
        }
        return options.closeOverrides?.[clientKey]?.();
      },
    );
  }

  /** @type {Record<string, any>} */
  const authority = {
    providerScope: PROVIDER_SCOPE,
    /**
     * @this {Record<string, any>}
     * @param {...any} args
     */
    resolveScope(...args) {
      calls.push(['resolveScope', this, args]);
      return Promise.resolve(PROVIDER_SCOPE);
    },
    close: jest.fn(
      /** @this {Record<string, any>} */
      function closeAuthority() {
        calls.push(['close', this, []]);
        events.push('authority:close');
        if (options.authorityCloseFailure === 'sync') {
          throw new Error('sensitive authority sync close failure');
        }
        if (options.authorityCloseFailure === 'async') {
          return Promise.reject(
            new Error('sensitive authority async close failure'),
          );
        }
        return Promise.resolve();
      },
    ),
  };
  for (const [clientKey, factory] of CLIENT_DEFINITIONS) {
    authority[factory] = jest.fn(
      /**
       * @this {Record<string, any>}
       * @param {...any} args
       */
      function createClient(...args) {
        calls.push([factory, this, args]);
        if (options.factoryFailure === factory) {
          throw new Error(`sensitive ${factory} failure`);
        }
        return clients[clientKey];
      },
    );
  }
  return { authority, clients, calls, clientCalls, methodResults };
}

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function deferred() {
  /** @type {() => void} */
  let release = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
}

/**
 * @param {unknown} value - Family client map.
 * @returns {Record<string, Record<string, Function>>} - Dynamically indexed ports.
 */
function readClientPorts(value) {
  return /** @type {Record<string, Record<string, Function>>} */ (
    /** @type {any} */ (value)
  );
}

describe('AWS deployment client family', () => {
  test('constructs the exact frozen family and client map without bootstrapping', async () => {
    const { authority, clients, calls } = createAuthority();

    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);
    const ports = readClientPorts(family.clients);

    expect(Object.keys(family)).toEqual([
      'providerScope',
      'scopeResolver',
      'clients',
      'close',
    ]);
    expect(Object.keys(family.scopeResolver)).toEqual(['resolveScope']);
    expect(Object.keys(family.clients)).toEqual(
      CLIENT_DEFINITIONS.map(([clientKey]) => clientKey),
    );
    expect(Object.isFrozen(family)).toBe(true);
    expect(Object.isFrozen(family.scopeResolver)).toBe(true);
    expect(Object.isFrozen(family.clients)).toBe(true);
    expect(family.providerScope).toEqual(PROVIDER_SCOPE);
    expect(Object.isFrozen(family.providerScope)).toBe(true);
    for (const [clientKey] of CLIENT_DEFINITIONS) {
      expect(ports[clientKey]).not.toBe(clients[clientKey]);
      expect(Object.keys(ports[clientKey])).toEqual(CLIENT_METHODS[clientKey]);
      expect(Object.isFrozen(ports[clientKey])).toBe(true);
      expect(ports[clientKey]).not.toHaveProperty('clientKey');
      expect(ports[clientKey]).not.toHaveProperty('credentials');
    }
    expect(
      assertDBClientAdapterIdentity(
        family.clients.deploymentStore,
        DB_ADAPTER_NAMES.DYNAMODB,
      ),
    ).toBe(DB_ADAPTER_NAMES.DYNAMODB);
    expect(calls.map(([method]) => method)).toEqual(
      CLIENT_DEFINITIONS.map(([, factory]) => factory),
    );
    expect(calls).not.toContainEqual([
      'resolveScope',
      expect.anything(),
      expect.anything(),
    ]);
    expect(family).not.toHaveProperty('authority');
    expect(family).not.toHaveProperty('credentials');
    for (const [, factory] of CLIENT_DEFINITIONS) {
      expect(family).not.toHaveProperty(factory);
      expect(family.clients).not.toHaveProperty(factory);
    }

    await family.close();
  });

  test('calls every factory once with the original authority receiver and no arguments', async () => {
    const { authority, calls } = createAuthority();
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);

    for (const [, factory] of CLIENT_DEFINITIONS) {
      expect(authority[factory]).toHaveBeenCalledTimes(1);
      expect(calls.filter(([method]) => method === factory)).toEqual([
        [factory, authority, []],
      ]);
    }

    await family.close();
  });

  test('projects every client method with the raw owner receiver, exact arguments, and return identity', async () => {
    const { authority, clients, clientCalls, methodResults } =
      createAuthority();
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);
    const ports = readClientPorts(family.clients);

    for (const [clientKey] of CLIENT_DEFINITIONS) {
      for (const method of CLIENT_METHODS[clientKey]) {
        if (method === 'close') continue;
        const input = Object.freeze({ clientKey, method });
        const returned = ports[clientKey][method](input);
        expect(returned).toBe(methodResults[`${clientKey}.${method}`]);
        expect(clientCalls.at(-1)).toEqual([
          clientKey,
          method,
          clients[clientKey],
          [input],
        ]);
      }
    }

    await family.close();
  });

  test('scope resolution preserves the captured function, authority receiver, arguments, and Promise identity', async () => {
    const { authority, calls } = createAuthority();
    const expected = Promise.resolve(PROVIDER_SCOPE);
    authority.resolveScope = jest.fn(
      /**
       * @this {Record<string, any>}
       * @param {...any} args
       */
      function resolveScope(...args) {
        calls.push(['capturedResolveScope', this, args]);
        return expected;
      },
    );
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);
    authority.resolveScope = jest.fn(() => {
      throw new Error('replacement must not be used');
    });
    const context = Object.freeze({ invocationId: 'invocation-1' });

    const returned = family.scopeResolver.resolveScope(context);

    expect(returned).toBe(expected);
    expect(calls.some(([method]) => method === 'resolveScope')).toBe(false);
    expect(
      calls.filter(([method]) => method === 'capturedResolveScope'),
    ).toEqual([['capturedResolveScope', authority, [context]]]);
    await returned;
    await family.close();
  });

  test('cleans up every issued child in reverse order and the authority last after partial construction failure', async () => {
    /** @type {string[]} */
    const events = [];
    const { authority, clients } = createAuthority({
      events,
      factoryFailure: 'createVolumeResourceClient',
      syncCloseFailures: new Set(['s3Control']),
      asyncCloseFailures: new Set(['deploymentStore']),
      authorityCloseFailure: 'async',
    });

    let failure;
    try {
      await createAwsDeploymentClientFamilyFromAuthority(authority);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(
      AwsDeploymentClientFamilyInitializationError,
    );
    expect(failure).toMatchObject({
      name: 'AwsDeploymentClientFamilyInitializationError',
      message: 'AWS deployment client family initialization failed.',
      code: 'AWS_DEPLOYMENT_CLIENT_FAMILY_INITIALIZATION_FAILED',
    });
    expect(failure).not.toHaveProperty('cause');
    expect(String(failure)).not.toMatch(/sensitive|VolumeResource/i);
    expect(events).toEqual([
      'managedArtifact:close',
      'providerSpecRead:close',
      's3Control:close',
      'dynamoControl:close',
      'deploymentStore:close',
      'authority:close',
    ]);
    for (const clientKey of [
      'deploymentStore',
      'dynamoControl',
      's3Control',
      'providerSpecRead',
      'managedArtifact',
    ]) {
      expect(clients[clientKey].close).toHaveBeenCalledTimes(1);
    }
    for (const clientKey of [
      'volume',
      'network',
      'runtimeIdentity',
      'node',
      'volumeAttachment',
    ]) {
      expect(clients[clientKey].close).not.toHaveBeenCalled();
    }
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  test('waits for all child closes before beginning authority close', async () => {
    /** @type {string[]} */
    const events = [];
    const gate = deferred();
    const { authority, clientCalls } = createAuthority({
      events,
      closeOverrides: {
        network: () => gate.promise,
      },
    });
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);
    const ports = readClientPorts(family.clients);

    const closePromise = family.close();

    expect(events).toEqual(
      CLIENT_DEFINITIONS.map(([clientKey]) => `${clientKey}:close`).reverse(),
    );
    expect(authority.close).not.toHaveBeenCalled();
    expect(() => family.scopeResolver.resolveScope()).toThrow(
      'AWS deployment client family is closed.',
    );
    for (const [clientKey] of CLIENT_DEFINITIONS) {
      const method = CLIENT_METHODS[clientKey][0];
      expect(() => ports[clientKey][method]({})).toThrow(
        'AWS deployment client family is closed.',
      );
    }
    expect(clientCalls).toEqual([]);

    gate.resolve();
    await closePromise;

    expect(events.at(-1)).toBe('authority:close');
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  test('memoizes projected child close and family close reuses the same raw attempt', async () => {
    const { authority, clients } = createAuthority();
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);
    const ports = readClientPorts(family.clients);

    const first = ports.deploymentStore.close();
    const second = ports.deploymentStore.close();

    expect(second).toBe(first);
    await first;
    expect(clients.deploymentStore.close).toHaveBeenCalledTimes(1);
    expect(() => ports.deploymentStore.get({})).toThrow(
      'AWS deployment client family is closed.',
    );

    await family.close();
    expect(clients.deploymentStore.close).toHaveBeenCalledTimes(1);
  });

  test('memoizes one close Promise and redacts multiple synchronous and asynchronous close failures', async () => {
    /** @type {string[]} */
    const events = [];
    const { authority, clients } = createAuthority({
      events,
      syncCloseFailures: new Set(['volumeAttachment', 'managedArtifact']),
      asyncCloseFailures: new Set(['runtimeIdentity', 'dynamoControl']),
      authorityCloseFailure: 'sync',
    });
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);

    const first = family.close();
    const second = family.close();
    const third = family.close();

    expect(second).toBe(first);
    expect(third).toBe(first);
    let failure;
    try {
      await first;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AwsDeploymentClientFamilyCloseError);
    expect(failure).toMatchObject({
      name: 'AwsDeploymentClientFamilyCloseError',
      message: 'AWS deployment client family close failed.',
      code: 'AWS_DEPLOYMENT_CLIENT_FAMILY_CLOSE_FAILED',
    });
    expect(failure).not.toHaveProperty('cause');
    expect(String(failure)).not.toMatch(/sensitive|managedArtifact/i);
    for (const [clientKey] of CLIENT_DEFINITIONS) {
      expect(clients[clientKey].close).toHaveBeenCalledTimes(1);
    }
    expect(authority.close).toHaveBeenCalledTimes(1);
    expect(family.close()).toBe(first);
    await expect(family.close()).rejects.toBe(failure);
  });

  test('rejects a second owner for the same transferred authority without issuing more children', async () => {
    const { authority } = createAuthority();
    const family =
      await createAwsDeploymentClientFamilyFromAuthority(authority);

    await expect(
      createAwsDeploymentClientFamilyFromAuthority(authority),
    ).rejects.toThrow(TypeError);
    for (const [, factory] of CLIENT_DEFINITIONS) {
      expect(authority[factory]).toHaveBeenCalledTimes(1);
    }

    await family.close();
  });

  test.each([
    ['null', () => null],
    ['array', () => []],
    ['function', () => () => {}],
    ['inherited', () => Object.create(createAuthority().authority)],
    [
      'missing method',
      () => {
        const { authority } = createAuthority();
        delete authority.createNodeResourceClient;
        return authority;
      },
    ],
    [
      'extra enumerable key',
      () => ({ ...createAuthority().authority, credentials: 'secret' }),
    ],
    [
      'extra hidden key',
      () => {
        const { authority } = createAuthority();
        Object.defineProperty(authority, 'credentials', { value: 'secret' });
        return authority;
      },
    ],
    [
      'accessor method',
      () => {
        const { authority } = createAuthority();
        const implementation = authority.createDynamoDB;
        Object.defineProperty(authority, 'createDynamoDB', {
          enumerable: true,
          get: () => implementation,
        });
        return authority;
      },
    ],
    [
      'non-function method',
      () => {
        const { authority } = createAuthority();
        authority.createDynamoDB = null;
        return authority;
      },
    ],
    [
      'invalid provider scope',
      () => {
        const { authority } = createAuthority();
        authority.providerScope = { ...PROVIDER_SCOPE, region: 'INVALID' };
        return authority;
      },
    ],
  ])(
    'rejects an inexact %s authority before taking ownership',
    async (_label, build) => {
      const authority = build();

      await expect(
        createAwsDeploymentClientFamilyFromAuthority(authority),
      ).rejects.toMatchObject({
        name: 'TypeError',
        message: 'AWS deployment client family authority is invalid.',
      });
      if (
        authority &&
        typeof authority === 'object' &&
        Object.hasOwn(authority, 'close') &&
        jest.isMockFunction(authority.close)
      ) {
        expect(authority.close).not.toHaveBeenCalled();
        for (const [, factory] of CLIENT_DEFINITIONS) {
          if (jest.isMockFunction(authority[factory])) {
            expect(authority[factory]).not.toHaveBeenCalled();
          }
        }
      }
    },
  );

  test.each([
    null,
    {},
    [],
    { region: 1 },
    { region: 'us-east-1', credentials: 'secret' },
    Object.create({ region: 'us-east-1' }),
    Object.defineProperty({}, 'region', {
      enumerable: true,
      get: () => 'us-east-1',
    }),
  ])(
    'rejects inexact open options before credential resolution',
    async (options) => {
      await expect(
        openAwsDeploymentClientFamily(options),
      ).rejects.toMatchObject({
        name: 'TypeError',
        message:
          'AWS deployment client family options must contain only one explicit region.',
      });
    },
  );

  test('exports errors with fixed type, message, and code', () => {
    const initialization = new AwsDeploymentClientFamilyInitializationError();
    const close = new AwsDeploymentClientFamilyCloseError();

    expect(initialization).toMatchObject({
      name: 'AwsDeploymentClientFamilyInitializationError',
      message: 'AWS deployment client family initialization failed.',
      code: 'AWS_DEPLOYMENT_CLIENT_FAMILY_INITIALIZATION_FAILED',
    });
    expect(close).toMatchObject({
      name: 'AwsDeploymentClientFamilyCloseError',
      message: 'AWS deployment client family close failed.',
      code: 'AWS_DEPLOYMENT_CLIENT_FAMILY_CLOSE_FAILED',
    });
  });

  test('fake authority fixture stays aligned with the exact real surface', () => {
    const { authority } = createAuthority();

    expect(Object.keys(authority).sort()).toEqual([...AUTHORITY_KEYS].sort());
  });
});
