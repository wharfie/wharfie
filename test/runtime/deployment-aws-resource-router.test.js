/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';

const ROUTER_IMPORT =
  '../../src/core/runtime/deployment-aws-resource-router.js';
/** @type {ReadonlyArray<'executeAction'|'verifySettlement'>} */
const ROUTER_METHODS = Object.freeze(['executeAction', 'verifySettlement']);

/** @param {string} factoryId @returns {any} */
function createFactoryDouble(factoryId) {
  const results = Object.freeze({
    executeAction: Object.freeze({ factoryId, method: 'executeAction' }),
    verifySettlement: Object.freeze({ factoryId, method: 'verifySettlement' }),
  });
  const resource = Object.freeze({
    executeAction: jest.fn(async () => results.executeAction),
    verifySettlement: jest.fn(async () => results.verifySettlement),
  });
  return Object.freeze({
    factoryId,
    factory: jest.fn(() => resource),
    resource,
    results,
  });
}

/** @type {ReadonlyArray<Readonly<{factoryId: string, clientKey: string, modulePath: string, exportName: string}>>} */
const FACTORY_DEFINITIONS = Object.freeze([
  Object.freeze({
    factoryId: 'managedArtifact',
    clientKey: 'managedArtifact',
    modulePath:
      '../../src/core/runtime/deployment-aws-managed-artifact-resource.js',
    exportName: 'createAwsSingleNodeManagedArtifactResource',
  }),
  Object.freeze({
    factoryId: 'volume',
    clientKey: 'volume',
    modulePath: '../../src/core/runtime/deployment-aws-volume-resource.js',
    exportName: 'createAwsSingleNodeVolumeResource',
  }),
  Object.freeze({
    factoryId: 'vpc',
    clientKey: 'network',
    modulePath: '../../src/core/runtime/deployment-aws-vpc-resource.js',
    exportName: 'createAwsSingleNodeVpcResource',
  }),
  Object.freeze({
    factoryId: 'internetGateway',
    clientKey: 'network',
    modulePath:
      '../../src/core/runtime/deployment-aws-internet-gateway-resource.js',
    exportName: 'createAwsSingleNodeInternetGatewayResource',
  }),
  Object.freeze({
    factoryId: 'internetGatewayAttachment',
    clientKey: 'network',
    modulePath:
      '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js',
    exportName: 'createAwsSingleNodeInternetGatewayAttachmentResource',
  }),
  Object.freeze({
    factoryId: 'subnet',
    clientKey: 'network',
    modulePath: '../../src/core/runtime/deployment-aws-subnet-resource.js',
    exportName: 'createAwsSingleNodeSubnetResource',
  }),
  Object.freeze({
    factoryId: 'routeTable',
    clientKey: 'network',
    modulePath: '../../src/core/runtime/deployment-aws-route-table-resource.js',
    exportName: 'createAwsSingleNodeRouteTableResource',
  }),
  Object.freeze({
    factoryId: 'defaultIpv4Route',
    clientKey: 'network',
    modulePath:
      '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js',
    exportName: 'createAwsSingleNodeDefaultIpv4RouteResource',
  }),
  Object.freeze({
    factoryId: 'subnetRouteTableAssociation',
    clientKey: 'network',
    modulePath:
      '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js',
    exportName: 'createAwsSingleNodeSubnetRouteTableAssociationResource',
  }),
  Object.freeze({
    factoryId: 'securityGroup',
    clientKey: 'network',
    modulePath:
      '../../src/core/runtime/deployment-aws-security-group-resource.js',
    exportName: 'createAwsSingleNodeSecurityGroupResource',
  }),
  Object.freeze({
    factoryId: 'runtimeRole',
    clientKey: 'runtimeIdentity',
    modulePath:
      '../../src/core/runtime/deployment-aws-runtime-role-resource.js',
    exportName: 'createAwsSingleNodeRuntimeRoleResource',
  }),
  Object.freeze({
    factoryId: 'runtimeRolePolicy',
    clientKey: 'runtimeIdentity',
    modulePath:
      '../../src/core/runtime/deployment-aws-runtime-role-policy-resource.js',
    exportName: 'createAwsSingleNodeRuntimeRolePolicyResource',
  }),
  Object.freeze({
    factoryId: 'instanceProfile',
    clientKey: 'runtimeIdentity',
    modulePath:
      '../../src/core/runtime/deployment-aws-instance-profile-resource.js',
    exportName: 'createAwsSingleNodeInstanceProfileResource',
  }),
  Object.freeze({
    factoryId: 'instanceProfileRoleAssociation',
    clientKey: 'runtimeIdentity',
    modulePath:
      '../../src/core/runtime/deployment-aws-instance-profile-role-association-resource.js',
    exportName: 'createAwsSingleNodeInstanceProfileRoleAssociationResource',
  }),
  Object.freeze({
    factoryId: 'node',
    clientKey: 'node',
    modulePath: '../../src/core/runtime/deployment-aws-node-resource.js',
    exportName: 'createAwsSingleNodeNodeResource',
  }),
  Object.freeze({
    factoryId: 'volumeAttachment',
    clientKey: 'volumeAttachment',
    modulePath:
      '../../src/core/runtime/deployment-aws-volume-attachment-resource.js',
    exportName: 'createAwsSingleNodeVolumeAttachmentResource',
  }),
]);

/** @type {Readonly<Record<string, any>>} */
const FACTORY_DOUBLE_BY_ID = Object.freeze(
  Object.fromEntries(
    FACTORY_DEFINITIONS.map(({ factoryId }) => [
      factoryId,
      createFactoryDouble(factoryId),
    ]),
  ),
);

for (const definition of FACTORY_DEFINITIONS) {
  jest.unstable_mockModule(definition.modulePath, () => ({
    [definition.exportName]: FACTORY_DOUBLE_BY_ID[definition.factoryId].factory,
  }));
}

const {
  AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED,
  AwsSingleNodeResourceRouteUnsupportedError,
  createAwsSingleNodeResourceRouter,
} = await import(ROUTER_IMPORT);

/** @type {Readonly<Record<string, string>>} */
const EXPECTED_RESOURCE_FACTORY = Object.freeze({
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

/** @type {ReadonlyArray<Readonly<{resourceKey: string, factoryId: string}>>} */
const GRAPH_ROWS = Object.freeze(
  AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ resource) =>
      Object.freeze({
        resourceKey: resource.resourceKey,
        factoryId: EXPECTED_RESOURCE_FACTORY[resource.resourceKey],
      }),
  ),
);

/** @type {Readonly<Record<string, ReadonlyArray<string>>>} */
const REQUIRED_CLIENT_METHODS = Object.freeze({
  managedArtifact: Object.freeze([
    'copyObject',
    'close',
    'headObject',
    'listObjectVersions',
    'deleteObjectVersion',
  ]),
  volume: Object.freeze(['close', 'createVolume', 'describeVolumes']),
  network: Object.freeze([
    'associateRouteTable',
    'attachInternetGateway',
    'createInternetGateway',
    'createRoute',
    'createRouteTable',
    'createSecurityGroup',
    'createSubnet',
    'createVpc',
    'close',
    'deleteInternetGateway',
    'deleteRoute',
    'deleteRouteTable',
    'deleteSecurityGroup',
    'deleteSubnet',
    'deleteVpc',
    'describeInternetGateways',
    'describeRouteTables',
    'describeSecurityGroups',
    'describeSubnets',
    'describeVpcAttribute',
    'describeVpcs',
    'detachInternetGateway',
    'disassociateRouteTable',
  ]),
  runtimeIdentity: Object.freeze([
    'addRoleToInstanceProfile',
    'createInstanceProfile',
    'createRole',
    'close',
    'deleteInstanceProfile',
    'deleteRole',
    'deleteRolePolicy',
    'describeInstances',
    'getInstanceProfile',
    'getRole',
    'getRolePolicy',
    'listAttachedRolePolicies',
    'listInstanceProfilesForRole',
    'listInstanceProfileTags',
    'listRolePolicies',
    'listRoleTags',
    'putRolePolicy',
    'removeRoleFromInstanceProfile',
  ]),
  node: Object.freeze([
    'close',
    'runInstances',
    'startInstances',
    'describeInstances',
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeVolumes',
    'terminateInstances',
  ]),
  volumeAttachment: Object.freeze([
    'attachVolume',
    'close',
    'describeInstances',
    'describeVolumes',
    'detachVolume',
    'modifyInstanceAttribute',
  ]),
});

const PROVIDER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
});
const WAIT_FOR_RETRY = async () => {};

/** @param {ReadonlyArray<string>} methods @returns {Record<string, any>} */
function createClient(methods) {
  return Object.fromEntries(methods.map((method) => [method, () => {}]));
}

/** @returns {Record<string, Record<string, any>>} */
function createClients() {
  return Object.fromEntries(
    Object.entries(REQUIRED_CLIENT_METHODS).map(([clientKey, methods]) => [
      clientKey,
      createClient(methods),
    ]),
  );
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function createValidOptions(overrides = {}) {
  return {
    providerScope: PROVIDER_SCOPE,
    clients: createClients(),
    maxAttempts: 3,
    waitForRetry: WAIT_FOR_RETRY,
    ...overrides,
  };
}

/** @param {'executeAction'|'verifySettlement'} method @returns {number} */
function totalHandlerCalls(method) {
  return FACTORY_DEFINITIONS.reduce(
    (total, { factoryId }) =>
      total +
      FACTORY_DOUBLE_BY_ID[factoryId].resource[method].mock.calls.length,
    0,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const { factoryId } of FACTORY_DEFINITIONS) {
    const double = FACTORY_DOUBLE_BY_ID[factoryId];
    double.factory.mockImplementation(() => double.resource);
    double.resource.executeAction.mockImplementation(
      async () => double.results.executeAction,
    );
    double.resource.verifySettlement.mockImplementation(
      async () => double.results.verifySettlement,
    );
  }
});

describe('AWS single-node resource router', () => {
  it('pins the complete graph to an explicit resource-key/factory mapping', () => {
    expect(GRAPH_ROWS).toHaveLength(18);
    expect(GRAPH_ROWS.map(({ resourceKey }) => resourceKey)).toEqual(
      Object.keys(EXPECTED_RESOURCE_FACTORY),
    );
    expect(
      GRAPH_ROWS.every(({ factoryId }) => typeof factoryId === 'string'),
    ).toBe(true);
  });

  it('constructs every resource exactly once with the right shared authority and retry inputs', () => {
    const options = createValidOptions();
    createAwsSingleNodeResourceRouter(options);

    for (const { factoryId, clientKey } of FACTORY_DEFINITIONS) {
      const factory = FACTORY_DOUBLE_BY_ID[factoryId].factory;
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory.mock.calls[0]).toHaveLength(1);
      const factoryOptions = factory.mock.calls[0][0];
      expect(Object.keys(factoryOptions).sort()).toEqual([
        'client',
        'maxAttempts',
        'providerScope',
        'waitForRetry',
      ]);
      expect(factoryOptions.client).toBe(options.clients[clientKey]);
      expect(factoryOptions.providerScope).toEqual(PROVIDER_SCOPE);
      expect(factoryOptions.maxAttempts).toBe(3);
      expect(factoryOptions.waitForRetry).toBe(WAIT_FOR_RETRY);
    }

    expect(FACTORY_DOUBLE_BY_ID.volume.factory).toHaveBeenCalledTimes(1);
    expect(FACTORY_DOUBLE_BY_ID.volumeAttachment.factory).toHaveBeenCalledTimes(
      1,
    );
  });

  it('ignores inherited retry lookups that are not part of the exact options object', () => {
    const options = new Proxy(
      {
        providerScope: PROVIDER_SCOPE,
        clients: createClients(),
      },
      {
        get(target, property, receiver) {
          if (property === 'maxAttempts') return 10;
          if (property === 'waitForRetry') return WAIT_FOR_RETRY;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    createAwsSingleNodeResourceRouter(options);

    for (const { factoryId } of FACTORY_DEFINITIONS) {
      expect(
        Object.keys(
          FACTORY_DOUBLE_BY_ID[factoryId].factory.mock.calls[0][0],
        ).sort(),
      ).toEqual(['client', 'providerScope']);
    }
  });

  it('routes both ports across all 18 graph roles without cloning or fanout', async () => {
    const router = createAwsSingleNodeResourceRouter(createValidOptions());

    for (const method of ROUTER_METHODS) {
      for (const row of GRAPH_ROWS) {
        const context = Object.freeze({
          action: Object.freeze({ resourceKey: row.resourceKey }),
          callerMarker: Object.freeze({ resourceKey: row.resourceKey }),
        });
        const before = Object.fromEntries(
          FACTORY_DEFINITIONS.map(({ factoryId }) => [
            factoryId,
            FACTORY_DOUBLE_BY_ID[factoryId].resource[method].mock.calls.length,
          ]),
        );

        await expect(router[method](context)).resolves.toBe(
          FACTORY_DOUBLE_BY_ID[row.factoryId].results[method],
        );

        for (const { factoryId } of FACTORY_DEFINITIONS) {
          const handler = FACTORY_DOUBLE_BY_ID[factoryId].resource[method];
          const expectedDelta = factoryId === row.factoryId ? 1 : 0;
          expect(handler.mock.calls.length - before[factoryId]).toBe(
            expectedDelta,
          );
        }
        const call =
          FACTORY_DOUBLE_BY_ID[row.factoryId].resource[method].mock.calls.at(
            -1,
          );
        expect(call).toHaveLength(1);
        expect(call[0]).toBe(context);
      }

      expect(totalHandlerCalls(method)).toBe(18);
      expect(
        FACTORY_DOUBLE_BY_ID.volume.resource[method],
      ).toHaveBeenCalledTimes(2);
      expect(
        FACTORY_DOUBLE_BY_ID.volumeAttachment.resource[method],
      ).toHaveBeenCalledTimes(2);
      for (const { factoryId } of FACTORY_DEFINITIONS) {
        if (factoryId === 'volume' || factoryId === 'volumeAttachment')
          continue;
        expect(
          FACTORY_DOUBLE_BY_ID[factoryId].resource[method],
        ).toHaveBeenCalledTimes(1);
      }
    }
  });

  it('preserves handler rejection identity on both ports without fanout', async () => {
    const router = createAwsSingleNodeResourceRouter(createValidOptions());
    const executeFailure = new Error('execute sentinel');
    const settlementFailure = new Error('settlement sentinel');
    FACTORY_DOUBLE_BY_ID.node.resource.executeAction.mockRejectedValueOnce(
      executeFailure,
    );
    FACTORY_DOUBLE_BY_ID.managedArtifact.resource.verifySettlement.mockRejectedValueOnce(
      settlementFailure,
    );

    await expect(
      router.executeAction({ action: { resourceKey: 'substrate' } }),
    ).rejects.toBe(executeFailure);
    await expect(
      router.verifySettlement({ action: { resourceKey: 'artifact' } }),
    ).rejects.toBe(settlementFailure);

    expect(totalHandlerCalls('executeAction')).toBe(1);
    expect(totalHandlerCalls('verifySettlement')).toBe(1);
    expect(
      FACTORY_DOUBLE_BY_ID.node.resource.executeAction,
    ).toHaveBeenCalledTimes(1);
    expect(
      FACTORY_DOUBLE_BY_ID.managedArtifact.resource.verifySettlement,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects every malformed or unknown route with one fixed non-echoing error before handler calls', async () => {
    const router = createAwsSingleNodeResourceRouter(createValidOptions());
    const secretUnknownKey = 'secret-provider-resource-arn-1234';
    const malformedContexts = [
      undefined,
      null,
      'context',
      [],
      {},
      { action: null },
      { action: [] },
      { action: {} },
      { action: { resourceKey: null } },
      { action: { resourceKey: {} } },
      { action: { resourceKey: '' } },
      { action: { resourceKey: secretUnknownKey } },
    ];

    expect(AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED).toBe(
      'AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED',
    );
    for (const method of ROUTER_METHODS) {
      for (const context of malformedContexts) {
        /** @type {any} */
        let failure;
        try {
          await router[method](context);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(
          AwsSingleNodeResourceRouteUnsupportedError,
        );
        expect(failure).toMatchObject({
          name: 'AwsSingleNodeResourceRouteUnsupportedError',
          code: AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED,
          message: 'AWS single-node resource action route is unsupported.',
        });
        expect(failure.message).not.toContain(secretUnknownKey);
      }
    }

    expect(totalHandlerCalls('executeAction')).toBe(0);
    expect(totalHandlerCalls('verifySettlement')).toBe(0);
  });

  it('requires own fields even when inherited lookup returns a valid route', () => {
    const router = createAwsSingleNodeResourceRouter(createValidOptions());
    const inheritedAction = new Proxy(
      {},
      {
        get(target, property, receiver) {
          return property === 'action'
            ? { resourceKey: 'artifact' }
            : Reflect.get(target, property, receiver);
        },
      },
    );
    const inheritedResourceKey = new Proxy(
      {},
      {
        get(target, property, receiver) {
          return property === 'resourceKey'
            ? 'artifact'
            : Reflect.get(target, property, receiver);
        },
      },
    );
    /** @type {unknown} */
    let inheritedActionFailure;
    try {
      router.executeAction(inheritedAction);
    } catch (error) {
      inheritedActionFailure = error;
    }

    /** @type {unknown} */
    let inheritedResourceKeyFailure;
    try {
      router.verifySettlement({ action: inheritedResourceKey });
    } catch (error) {
      inheritedResourceKeyFailure = error;
    }

    expect(inheritedActionFailure).toBeInstanceOf(
      AwsSingleNodeResourceRouteUnsupportedError,
    );
    expect(inheritedResourceKeyFailure).toBeInstanceOf(
      AwsSingleNodeResourceRouteUnsupportedError,
    );
    expect(totalHandlerCalls('executeAction')).toBe(0);
    expect(totalHandlerCalls('verifySettlement')).toBe(0);
  });

  it('validates the exact constructor, retry, client-family, and client-method contract before construction', () => {
    /** @param {unknown} options */
    const expectInvalid = (options) => {
      expect(() => createAwsSingleNodeResourceRouter(options)).toThrow(
        TypeError,
      );
      for (const { factoryId } of FACTORY_DEFINITIONS) {
        expect(FACTORY_DOUBLE_BY_ID[factoryId].factory).not.toHaveBeenCalled();
      }
    };

    expectInvalid(undefined);
    expectInvalid(null);
    expectInvalid([]);
    expectInvalid(Object.create(null));
    expectInvalid({ clients: createClients() });
    expectInvalid({ providerScope: PROVIDER_SCOPE });
    expectInvalid({ ...createValidOptions(), unsupported: true });
    expectInvalid({ ...createValidOptions(), providerScope: {} });

    for (const maxAttempts of [1, 11, 2.5, '3', Number.NaN]) {
      expectInvalid({ ...createValidOptions(), maxAttempts });
    }
    expectInvalid({ ...createValidOptions(), waitForRetry: true });

    for (const clients of [null, [], Object.create(null)]) {
      expectInvalid({ ...createValidOptions(), clients });
    }
    const withExtraClient = createClients();
    withExtraClient.unsupported = {};
    expectInvalid({ ...createValidOptions(), clients: withExtraClient });

    for (const clientKey of Object.keys(REQUIRED_CLIENT_METHODS)) {
      const missingClient = createClients();
      delete missingClient[clientKey];
      expectInvalid({ ...createValidOptions(), clients: missingClient });

      for (const invalidClient of [null, [], Object.create(null)]) {
        expectInvalid({
          ...createValidOptions(),
          clients: { ...createClients(), [clientKey]: invalidClient },
        });
      }

      for (const method of REQUIRED_CLIENT_METHODS[clientKey]) {
        const missingMethod = createClients();
        delete missingMethod[clientKey][method];
        expectInvalid({ ...createValidOptions(), clients: missingMethod });
      }

      const extraMethod = createClients();
      extraMethod[clientKey].unsupported = () => {};
      expectInvalid({ ...createValidOptions(), clients: extraMethod });

      const inheritedMethod = createClients();
      const inheritedName = REQUIRED_CLIENT_METHODS[clientKey][0];
      delete inheritedMethod[clientKey][inheritedName];
      inheritedMethod[clientKey] = new Proxy(inheritedMethod[clientKey], {
        get(target, property, receiver) {
          return property === inheritedName
            ? () => {}
            : Reflect.get(target, property, receiver);
        },
      });
      expectInvalid({ ...createValidOptions(), clients: inheritedMethod });
    }
  });

  it('rejects malformed factory ports during construction', () => {
    for (const { factoryId } of FACTORY_DEFINITIONS) {
      const double = FACTORY_DOUBLE_BY_ID[factoryId];
      for (const invalid of [
        null,
        {},
        { executeAction() {}, verifySettlement: true },
        {
          executeAction() {},
          verifySettlement() {},
          unsupported() {},
        },
      ]) {
        double.factory.mockReturnValueOnce(invalid);
        expect(() =>
          createAwsSingleNodeResourceRouter(createValidOptions()),
        ).toThrow(TypeError);
      }
    }
  });

  it('returns only the two frozen controller action ports', () => {
    const router = createAwsSingleNodeResourceRouter(createValidOptions());

    expect(Object.isFrozen(router)).toBe(true);
    expect(Object.keys(router)).toEqual(['executeAction', 'verifySettlement']);
    expect(typeof router.executeAction).toBe('function');
    expect(typeof router.verifySettlement).toBe('function');
  });
});
