import { describe, expect, it } from '@jest/globals';

import { createAwsSingleNodeResourceRouter } from '../../src/core/runtime/deployment-aws-resource-router.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const CLIENT_METHODS = Object.freeze({
  managedArtifact: Object.freeze([
    'close',
    'copyObject',
    'deleteObjectVersion',
    'headObject',
    'listObjectVersions',
  ]),
  volume: Object.freeze(['close', 'createVolume', 'describeVolumes']),
  network: Object.freeze([
    'associateRouteTable',
    'attachInternetGateway',
    'close',
    'createInternetGateway',
    'createRoute',
    'createRouteTable',
    'createSecurityGroup',
    'createSubnet',
    'createVpc',
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
    'close',
    'createInstanceProfile',
    'createRole',
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
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeInstances',
    'describeVolumes',
    'runInstances',
    'startInstances',
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

/** @param {ReadonlyArray<string>} methods @returns {Record<string, () => void>} */
function createClient(methods) {
  return Object.fromEntries(methods.map((method) => [method, () => {}]));
}

describe('AWS single-node resource router real factories', () => {
  it('constructs every production driver through their common option contract', () => {
    const clients = Object.fromEntries(
      Object.entries(CLIENT_METHODS).map(([clientKey, methods]) => [
        clientKey,
        createClient(methods),
      ]),
    );
    const providerScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    });

    const router = createAwsSingleNodeResourceRouter({
      providerScope,
      clients,
      maxAttempts: 2,
      waitForRetry: async () => {},
    });

    expect(Object.isFrozen(router)).toBe(true);
    expect(Object.keys(router)).toEqual(['executeAction', 'verifySettlement']);
  });
});
