/**
 * @typedef {Readonly<{
 *   clientDynamoDB: typeof import('@aws-sdk/client-dynamodb'),
 *   clientEC2: typeof import('@aws-sdk/client-ec2'),
 *   clientIAM: typeof import('@aws-sdk/client-iam'),
 *   clientS3: typeof import('@aws-sdk/client-s3'),
 *   clientSSM: typeof import('@aws-sdk/client-ssm'),
 *   clientSTS: typeof import('@aws-sdk/client-sts'),
 *   credentialProviders: typeof import('@aws-sdk/credential-providers'),
 *   libDynamoDB: typeof import('@aws-sdk/lib-dynamodb'),
 *   utilRetry: typeof import('@smithy/util-retry'),
 * }>} AwsSdkBindings
 */

import * as clientDynamoDB from '@aws-sdk/client-dynamodb';
import * as clientEC2 from '@aws-sdk/client-ec2';
import * as clientIAM from '@aws-sdk/client-iam';
import * as clientS3 from '@aws-sdk/client-s3';
import * as clientSSM from '@aws-sdk/client-ssm';
import * as clientSTS from '@aws-sdk/client-sts';
import * as credentialProviders from '@aws-sdk/credential-providers';
import * as libDynamoDB from '@aws-sdk/lib-dynamodb';
import * as utilRetry from '@smithy/util-retry';

export const WHARFIE_AWS_PROVIDER_CONTRACT_VERSION = 1;
export const WHARFIE_AWS_PROVIDER_PACKAGE_VERSION = '0.0.15';

/** @type {AwsSdkBindings} */
const BINDINGS = Object.freeze({
  clientDynamoDB,
  clientEC2,
  clientIAM,
  clientS3,
  clientSSM,
  clientSTS,
  credentialProviders,
  libDynamoDB,
  utilRetry,
});

/**
 * Return the versioned SDK binding contract understood by this Wharfie version.
 * @returns {AwsSdkBindings} - Frozen AWS SDK namespaces.
 */
export function getAwsSdkBindings() {
  return BINDINGS;
}
