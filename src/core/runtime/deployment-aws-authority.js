/* eslint-disable jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal boundary helpers keep their complete types inline. */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import {
  AssociateRouteTableCommand,
  AttachInternetGatewayCommand,
  AttachVolumeCommand,
  CreateInternetGatewayCommand,
  CreateRouteCommand,
  CreateRouteTableCommand,
  CreateSecurityGroupCommand,
  CreateSubnetCommand,
  CreateVpcCommand,
  CreateVolumeCommand,
  DeleteInternetGatewayCommand,
  DeleteRouteCommand,
  DeleteRouteTableCommand,
  DeleteSecurityGroupCommand,
  DeleteSubnetCommand,
  DeleteVpcCommand,
  DescribeAvailabilityZonesCommand,
  DescribeImagesCommand,
  DescribeInstanceCreditSpecificationsCommand,
  DescribeInstanceAttributeCommand,
  DescribeInstancesCommand,
  DescribeInternetGatewaysCommand,
  DescribeInstanceTypeOfferingsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcAttributeCommand,
  DescribeVpcsCommand,
  DescribeVolumesCommand,
  DisassociateRouteTableCommand,
  DetachInternetGatewayCommand,
  DetachVolumeCommand,
  EC2Client,
  GetEbsDefaultKmsKeyIdCommand,
  ModifyInstanceAttributeCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  AddRoleToInstanceProfileCommand,
  CreateInstanceProfileCommand,
  CreateRoleCommand,
  DeleteInstanceProfileCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  GetInstanceProfileCommand,
  GetRoleCommand,
  GetRolePolicyCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListInstanceProfilesForRoleCommand,
  ListInstanceProfileTagsCommand,
  ListRolePoliciesCommand,
  ListRoleTagsCommand,
  PutRolePolicyCommand,
  RemoveRoleFromInstanceProfileCommand,
} from '@aws-sdk/client-iam';
import { S3 } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from '../lib/aws/base.js';
import createDynamoDBAdapter from '../lib/db/adapters/dynamodb.js';
import { createAwsProviderScope } from './deployment-provider-scope.js';

const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const AWS_CALLER_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):(?:iam|sts)::([0-9]{12}):[!-~]+$/;
const FACTORY_KEYS = new Set(['region']);
const DYNAMODB_FACTORY_KEYS = new Set(['readOnly']);

const INVALID_OPTIONS_ERROR =
  'AWS deployment authority options must contain only one explicit region.';
const INVALID_REGION_ERROR =
  'AWS deployment authority region must be canonical.';
const CREDENTIAL_RESOLUTION_ERROR =
  'AWS deployment credential resolution failed.';
const INVALID_CREDENTIALS_ERROR =
  'AWS deployment credential resolution returned an invalid identity.';
const CALLER_IDENTITY_ERROR = 'AWS caller identity resolution failed.';
const INVALID_CALLER_IDENTITY_ERROR =
  'AWS caller identity response is invalid.';
const CALLER_IDENTITY_MISMATCH_ERROR =
  'AWS caller identity response is internally inconsistent.';
const CALLER_IDENTITY_CHANGED_ERROR =
  'AWS caller identity changed during the deployment invocation.';
const CLOSED_ERROR = 'AWS deployment authority is closed.';
const CLOSE_ERROR = 'AWS deployment authority close failed.';
const INITIALIZATION_ERROR = 'AWS deployment authority initialization failed.';
const DYNAMODB_CREATION_ERROR = 'AWS deployment DynamoDB creation failed.';
const DYNAMODB_CONTROL_CLOSED_ERROR =
  'AWS deployment DynamoDB control client is closed.';
const DYNAMODB_CONTROL_CLOSE_ERROR =
  'AWS deployment DynamoDB control client close failed.';
const S3_CONTROL_CREATION_ERROR =
  'AWS deployment S3 control client creation failed.';
const S3_CONTROL_OPERATION_ERROR =
  'AWS deployment S3 control operation failed.';
const S3_CONTROL_CLOSED_ERROR = 'AWS deployment S3 control client is closed.';
const S3_CONTROL_CLOSE_ERROR = 'AWS deployment S3 control client close failed.';
const MANAGED_ARTIFACT_RESOURCE_CREATION_ERROR =
  'AWS deployment managed-artifact resource client creation failed.';
const MANAGED_ARTIFACT_RESOURCE_OPERATION_ERROR =
  'AWS deployment managed-artifact resource operation failed.';
const MANAGED_ARTIFACT_RESOURCE_CLOSED_ERROR =
  'AWS deployment managed-artifact resource client is closed.';
const MANAGED_ARTIFACT_RESOURCE_CLOSE_ERROR =
  'AWS deployment managed-artifact resource client close failed.';
const MANAGED_ARTIFACT_RESOURCE_VERSION_ERROR =
  'AWS deployment managed-artifact delete requires an exact non-null object version ID.';
const PROVIDER_SPEC_READ_CREATION_ERROR =
  'AWS deployment provider-spec read client creation failed.';
const PROVIDER_SPEC_READ_OPERATION_ERROR =
  'AWS deployment provider-spec read operation failed.';
const PROVIDER_SPEC_READ_CLOSED_ERROR =
  'AWS deployment provider-spec read client is closed.';
const PROVIDER_SPEC_READ_CLOSE_ERROR =
  'AWS deployment provider-spec read client close failed.';
const VOLUME_RESOURCE_CREATION_ERROR =
  'AWS deployment volume resource client creation failed.';
const VOLUME_RESOURCE_OPERATION_ERROR =
  'AWS deployment volume resource operation failed.';
const VOLUME_RESOURCE_CLOSED_ERROR =
  'AWS deployment volume resource client is closed.';
const VOLUME_RESOURCE_CLOSE_ERROR =
  'AWS deployment volume resource client close failed.';
const NODE_RESOURCE_CREATION_ERROR =
  'AWS deployment node resource client creation failed.';
const NODE_RESOURCE_OPERATION_ERROR =
  'AWS deployment node resource operation failed.';
const NODE_RESOURCE_CLOSED_ERROR =
  'AWS deployment node resource client is closed.';
const NODE_RESOURCE_CLOSE_ERROR =
  'AWS deployment node resource client close failed.';
const VOLUME_ATTACHMENT_RESOURCE_CREATION_ERROR =
  'AWS deployment volume-attachment resource client creation failed.';
const VOLUME_ATTACHMENT_RESOURCE_OPERATION_ERROR =
  'AWS deployment volume-attachment resource operation failed.';
const VOLUME_ATTACHMENT_RESOURCE_CLOSED_ERROR =
  'AWS deployment volume-attachment resource client is closed.';
const VOLUME_ATTACHMENT_RESOURCE_CLOSE_ERROR =
  'AWS deployment volume-attachment resource client close failed.';
const NETWORK_RESOURCE_CREATION_ERROR =
  'AWS deployment network resource client creation failed.';
const NETWORK_RESOURCE_OPERATION_ERROR =
  'AWS deployment network resource operation failed.';
const NETWORK_RESOURCE_CLOSED_ERROR =
  'AWS deployment network resource client is closed.';
const NETWORK_RESOURCE_CLOSE_ERROR =
  'AWS deployment network resource client close failed.';
const RUNTIME_IDENTITY_RESOURCE_CREATION_ERROR =
  'AWS deployment runtime-identity resource client creation failed.';
const RUNTIME_IDENTITY_RESOURCE_OPERATION_ERROR =
  'AWS deployment runtime-identity resource operation failed.';
const RUNTIME_IDENTITY_RESOURCE_CLOSED_ERROR =
  'AWS deployment runtime-identity resource client is closed.';
const RUNTIME_IDENTITY_RESOURCE_CLOSE_ERROR =
  'AWS deployment runtime-identity resource client close failed.';
const PROVIDER_SPEC_READ_ERROR_NAMES = new Set([
  'ParameterNotFound',
  'ParameterVersionNotFound',
]);
const VOLUME_RESOURCE_ERROR_NAMES = new Set([
  'IdempotentParameterMismatch',
  'InvalidVolume.NotFound',
]);
const NODE_RESOURCE_ERROR_NAMES = new Set([
  'IdempotentParameterMismatch',
  'InvalidInstanceID.NotFound',
  'InvalidInstanceId.NotFound',
  'InvalidVolume.NotFound',
  'IncorrectInstanceState',
  'OperationNotPermitted',
]);
const VOLUME_ATTACHMENT_RESOURCE_ERROR_NAMES = new Set([
  'AttachmentLimitExceeded',
  'IncorrectInstanceState',
  'IncorrectState',
  'InvalidAttachment.NotFound',
  'InvalidDevice.InUse',
  'InvalidInstanceID.NotFound',
  'InvalidInstanceId.NotFound',
  'InvalidInstanceAttributeValue',
  'InvalidVolume.NotFound',
  'InvalidVolume.ZoneMismatch',
  'OperationNotPermitted',
  'UnsupportedOperation',
  'UnsupportedOperationException',
  'VolumeInUse',
]);
const NETWORK_RESOURCE_ERROR_NAMES = new Set([
  'DependencyViolation',
  'Gateway.NotAttached',
  'IdempotentParameterMismatch',
  'IncorrectState',
  'InvalidAssociationID.NotFound',
  'InvalidGatewayID.NotFound',
  'InvalidGroup.Duplicate',
  'InvalidGroup.InUse',
  'InvalidGroup.NotFound',
  'InvalidInternetGatewayID.NotFound',
  'InvalidRoute.NotFound',
  'InvalidRouteTableID.NotFound',
  'InvalidSubnetID.NotFound',
  'InvalidSubnetId.NotFound',
  'InvalidSecurityGroupID.NotFound',
  'InvalidVpcID.NotFound',
  'Resource.AlreadyAssociated',
  'RouteAlreadyExists',
]);
const RUNTIME_IDENTITY_RESOURCE_ERROR_NAMES = new Map([
  ['ConcurrentModification', 'ConcurrentModification'],
  ['ConcurrentModificationException', 'ConcurrentModification'],
  ['DeleteConflict', 'DeleteConflict'],
  ['DeleteConflictException', 'DeleteConflict'],
  ['EntityAlreadyExists', 'EntityAlreadyExists'],
  ['EntityAlreadyExistsException', 'EntityAlreadyExists'],
  ['NoSuchEntity', 'NoSuchEntity'],
  ['NoSuchEntityException', 'NoSuchEntity'],
]);
const S3_CONTROL_ERROR_NAMES = new Set([
  'ConditionalRequestConflict',
  'NoSuchBucket',
  'NoSuchKey',
  'NoSuchLifecycleConfiguration',
  'NoSuchBucketPolicy',
  'NoSuchOwnershipControls',
  'NoSuchPublicAccessBlockConfiguration',
  'NoSuchTagSet',
  'NoSuchVersion',
  'NotFound',
  'OwnershipControlsNotFoundError',
  'PreconditionFailed',
  'ReplicationConfigurationNotFoundError',
  'ServerSideEncryptionConfigurationNotFoundError',
]);
const MANAGED_ARTIFACT_RESOURCE_ERROR_NAMES = new Set([
  'BadDigest',
  'ConditionalRequestConflict',
  'InvalidObjectState',
  'NoSuchBucket',
  'NoSuchKey',
  'NoSuchVersion',
  'NotFound',
  'PreconditionFailed',
]);
const S3_VERSION_ID_MAX_UTF8_BYTES = 1024;

/**
 * @typedef DynamoDBControlClient
 * @property {(input: import('@aws-sdk/client-dynamodb').CreateTableCommandInput) => Promise<any>} createTable - Create one exact table.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeContinuousBackupsCommandInput) => Promise<any>} describeContinuousBackups - Read backup state.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeTableCommandInput) => Promise<any>} describeTable - Read table state.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeTimeToLiveCommandInput) => Promise<any>} describeTimeToLive - Read TTL state.
 * @property {(input: import('@aws-sdk/client-dynamodb').ListTagsOfResourceCommandInput) => Promise<any>} listTagsOfResource - Read table tags.
 * @property {(input: import('@aws-sdk/client-dynamodb').UpdateContinuousBackupsCommandInput) => Promise<any>} updateContinuousBackups - Strengthen backup state.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef ManagedArtifactResourceClient
 * @property {(input: import('@aws-sdk/client-s3').CopyObjectCommandInput) => Promise<any>} copyObject - Conditionally copy one exact staged version to its managed current key.
 * @property {(input: import('@aws-sdk/client-s3').HeadObjectCommandInput) => Promise<any>} headObject - Read exact current or versioned object metadata.
 * @property {(input: import('@aws-sdk/client-s3').ListObjectVersionsCommandInput) => Promise<any>} listObjectVersions - Enumerate bounded managed-key history for purge.
 * @property {(input: import('@aws-sdk/client-s3').DeleteObjectCommandInput & {VersionId: string}) => Promise<any>} deleteObjectVersion - Permanently delete one exact object version or delete marker without creating a delete marker.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef NetworkResourceClient
 * @property {(input: import('@aws-sdk/client-ec2').AssociateRouteTableCommandInput) => Promise<any>} associateRouteTable - Associate one exact subnet with one exact route table.
 * @property {(input: import('@aws-sdk/client-ec2').AttachInternetGatewayCommandInput) => Promise<any>} attachInternetGateway - Attach one exact internet gateway to one exact VPC.
 * @property {(input: import('@aws-sdk/client-ec2').CreateInternetGatewayCommandInput) => Promise<any>} createInternetGateway - Create one exact internet gateway.
 * @property {(input: import('@aws-sdk/client-ec2').CreateRouteCommandInput) => Promise<any>} createRoute - Create one exact route.
 * @property {(input: import('@aws-sdk/client-ec2').CreateRouteTableCommandInput) => Promise<any>} createRouteTable - Create one exact route table.
 * @property {(input: import('@aws-sdk/client-ec2').CreateSecurityGroupCommandInput) => Promise<any>} createSecurityGroup - Create one exact security group.
 * @property {(input: import('@aws-sdk/client-ec2').CreateSubnetCommandInput) => Promise<any>} createSubnet - Create one exact subnet.
 * @property {(input: import('@aws-sdk/client-ec2').CreateVpcCommandInput) => Promise<any>} createVpc - Create one exact VPC.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInternetGatewaysCommandInput) => Promise<any>} describeInternetGateways - Read exact internet-gateway state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeRouteTablesCommandInput) => Promise<any>} describeRouteTables - Read exact route-table state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeSecurityGroupsCommandInput) => Promise<any>} describeSecurityGroups - Read exact security-group state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeSubnetsCommandInput) => Promise<any>} describeSubnets - Read exact subnet state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVpcsCommandInput) => Promise<any>} describeVpcs - Read exact VPC state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVpcAttributeCommandInput) => Promise<any>} describeVpcAttribute - Read one exact VPC attribute.
 * @property {(input: import('@aws-sdk/client-ec2').DisassociateRouteTableCommandInput) => Promise<any>} disassociateRouteTable - Disassociate one exact route-table association.
 * @property {(input: import('@aws-sdk/client-ec2').DetachInternetGatewayCommandInput) => Promise<any>} detachInternetGateway - Detach one exact internet gateway from one exact VPC.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteInternetGatewayCommandInput) => Promise<any>} deleteInternetGateway - Delete one exact internet gateway.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteRouteCommandInput) => Promise<any>} deleteRoute - Delete one exact route.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteRouteTableCommandInput) => Promise<any>} deleteRouteTable - Delete one exact route table.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteSecurityGroupCommandInput) => Promise<any>} deleteSecurityGroup - Delete one exact security group.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteSubnetCommandInput) => Promise<any>} deleteSubnet - Delete one exact subnet.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteVpcCommandInput) => Promise<any>} deleteVpc - Delete one exact VPC.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef ProviderSpecReadClient
 * @property {(input: import('@aws-sdk/client-ssm').GetParameterCommandInput) => Promise<any>} getParameter - Read one exact parameter.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeAvailabilityZonesCommandInput) => Promise<any>} describeAvailabilityZones - Resolve regional availability-zone metadata.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeImagesCommandInput) => Promise<any>} describeImages - Resolve exact image metadata.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstanceTypeOfferingsCommandInput) => Promise<any>} describeInstanceTypeOfferings - Resolve exact regional instance-type offerings.
 * @property {(input: import('@aws-sdk/client-ec2').GetEbsDefaultKmsKeyIdCommandInput) => Promise<any>} getEbsDefaultKmsKeyId - Resolve the account's regional default EBS KMS key.
 * @property {() => Promise<void>} close - Close both caller-owned SDK clients.
 */

/**
 * @typedef VolumeResourceClient
 * @property {(input: import('@aws-sdk/client-ec2').CreateVolumeCommandInput) => Promise<any>} createVolume - Create one exact EBS volume.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVolumesCommandInput) => Promise<any>} describeVolumes - Read exact EBS volume state.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef NodeResourceClient
 * @property {(input: import('@aws-sdk/client-ec2').RunInstancesCommandInput) => Promise<any>} runInstances - Launch one exact substrate node.
 * @property {(input: import('@aws-sdk/client-ec2').StartInstancesCommandInput) => Promise<any>} startInstances - Recover one exact stopped substrate node.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstancesCommandInput) => Promise<any>} describeInstances - Read exact or bounded-discovery instance state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstanceAttributeCommandInput) => Promise<any>} describeInstanceAttribute - Read one exact instance attribute.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstanceCreditSpecificationsCommandInput) => Promise<any>} describeInstanceCreditSpecifications - Read exact burst-credit state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVolumesCommandInput) => Promise<any>} describeVolumes - Read exact root-volume state.
 * @property {(input: import('@aws-sdk/client-ec2').TerminateInstancesCommandInput) => Promise<any>} terminateInstances - Terminate one exact substrate node.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef VolumeAttachmentResourceClient
 * @property {(input: import('@aws-sdk/client-ec2').AttachVolumeCommandInput) => Promise<any>} attachVolume - Attach one exact retained volume to one exact node device.
 * @property {(input: import('@aws-sdk/client-ec2').DetachVolumeCommandInput) => Promise<any>} detachVolume - Non-forcibly detach one exact retained volume from one exact node device.
 * @property {(input: import('@aws-sdk/client-ec2').ModifyInstanceAttributeCommandInput) => Promise<any>} modifyInstanceAttribute - Set exact retained-volume deletion behavior on one node mapping.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstancesCommandInput) => Promise<any>} describeInstances - Read exact node-side attachment state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVolumesCommandInput) => Promise<any>} describeVolumes - Read exact volume-side attachment state.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef S3ControlClient
 * @property {(input: import('@aws-sdk/client-s3').CreateBucketCommandInput) => Promise<any>} createBucket - Create one exact bucket.
 * @property {(input: import('@aws-sdk/client-s3').HeadBucketCommandInput) => Promise<any>} headBucket - Read bucket existence and access.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketEncryptionCommandInput) => Promise<any>} getBucketEncryption - Read encryption state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketLifecycleConfigurationCommandInput) => Promise<any>} getBucketLifecycleConfiguration - Read lifecycle state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketLocationCommandInput) => Promise<any>} getBucketLocation - Read bucket location.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketOwnershipControlsCommandInput) => Promise<any>} getBucketOwnershipControls - Read ownership controls.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketPolicyCommandInput) => Promise<any>} getBucketPolicy - Read bucket-policy state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketReplicationCommandInput) => Promise<any>} getBucketReplication - Read replication state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketTaggingCommandInput) => Promise<any>} getBucketTagging - Read bucket tags.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketVersioningCommandInput) => Promise<any>} getBucketVersioning - Read versioning state.
 * @property {(input: import('@aws-sdk/client-s3').GetPublicAccessBlockCommandInput) => Promise<any>} getPublicAccessBlock - Read public-access state.
 * @property {(input: import('@aws-sdk/client-s3').GetObjectCommandInput) => Promise<any>} getObject - Read one exact object.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketEncryptionCommandInput) => Promise<any>} putBucketEncryption - Set exact encryption state.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketLifecycleConfigurationCommandInput) => Promise<any>} putBucketLifecycleConfiguration - Set exact lifecycle state.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketOwnershipControlsCommandInput) => Promise<any>} putBucketOwnershipControls - Set exact ownership controls.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketVersioningCommandInput) => Promise<any>} putBucketVersioning - Set exact versioning state.
 * @property {(input: import('@aws-sdk/client-s3').PutPublicAccessBlockCommandInput) => Promise<any>} putPublicAccessBlock - Set exact public-access state.
 * @property {(input: import('@aws-sdk/client-s3').PutObjectCommandInput) => Promise<any>} putObject - Put one exact object.
 * @property {(input: import('@aws-sdk/client-s3').HeadObjectCommandInput) => Promise<any>} headObject - Read exact object metadata.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef RuntimeIdentityResourceClient
 * @property {(input: import('@aws-sdk/client-iam').CreateRoleCommandInput) => Promise<any>} createRole - Create one exact runtime role.
 * @property {(input: import('@aws-sdk/client-iam').GetRoleCommandInput) => Promise<any>} getRole - Read one exact runtime role.
 * @property {(input: import('@aws-sdk/client-iam').DeleteRoleCommandInput) => Promise<any>} deleteRole - Delete one exact runtime role.
 * @property {(input: import('@aws-sdk/client-iam').ListRoleTagsCommandInput) => Promise<any>} listRoleTags - Read one runtime role's tags.
 * @property {(input: import('@aws-sdk/client-iam').ListRolePoliciesCommandInput) => Promise<any>} listRolePolicies - Read one runtime role's inline-policy names.
 * @property {(input: import('@aws-sdk/client-iam').ListAttachedRolePoliciesCommandInput) => Promise<any>} listAttachedRolePolicies - Read one runtime role's attached managed policies.
 * @property {(input: import('@aws-sdk/client-iam').PutRolePolicyCommandInput) => Promise<any>} putRolePolicy - Put one exact inline runtime policy.
 * @property {(input: import('@aws-sdk/client-iam').GetRolePolicyCommandInput) => Promise<any>} getRolePolicy - Read one exact inline runtime policy.
 * @property {(input: import('@aws-sdk/client-iam').DeleteRolePolicyCommandInput) => Promise<any>} deleteRolePolicy - Delete one exact inline runtime policy.
 * @property {(input: import('@aws-sdk/client-iam').CreateInstanceProfileCommandInput) => Promise<any>} createInstanceProfile - Create one exact runtime instance profile.
 * @property {(input: import('@aws-sdk/client-iam').GetInstanceProfileCommandInput) => Promise<any>} getInstanceProfile - Read one exact runtime instance profile.
 * @property {(input: import('@aws-sdk/client-iam').DeleteInstanceProfileCommandInput) => Promise<any>} deleteInstanceProfile - Delete one exact runtime instance profile.
 * @property {(input: import('@aws-sdk/client-iam').ListInstanceProfileTagsCommandInput) => Promise<any>} listInstanceProfileTags - Read one runtime instance profile's tags.
 * @property {(input: import('@aws-sdk/client-iam').AddRoleToInstanceProfileCommandInput) => Promise<any>} addRoleToInstanceProfile - Associate one exact runtime role and profile.
 * @property {(input: import('@aws-sdk/client-iam').RemoveRoleFromInstanceProfileCommandInput) => Promise<any>} removeRoleFromInstanceProfile - Remove one exact runtime role and profile association.
 * @property {(input: import('@aws-sdk/client-iam').ListInstanceProfilesForRoleCommandInput) => Promise<any>} listInstanceProfilesForRole - Read every instance profile associated with one runtime role.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstancesCommandInput) => Promise<any>} describeInstances - Fence instance-profile deletion against EC2 usage.
 * @property {() => Promise<void>} close - Close both caller-owned SDK clients.
 */

/**
 * @typedef CredentialSnapshot
 * @property {string} accessKeyId - AWS access-key identity.
 * @property {string} secretAccessKey - AWS signing secret.
 * @property {string} [sessionToken] - Temporary-session token.
 * @property {Date} [expiration] - Temporary-credential expiration.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Preserve only the provider classifications required for authoritative
 * readback. Raw SDK messages, request IDs, credential-bearing configuration,
 * and causes never cross the narrow authority boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeS3ControlError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(S3_CONTROL_OPERATION_ERROR)
    );
  error.name = S3_CONTROL_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentS3ControlError';
  error.code = 'AWS_DEPLOYMENT_S3_CONTROL_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the S3 classifications needed for conditional publication,
 * exact-version reads, and ownership-safe purge. Raw SDK messages, request
 * IDs, access classifications, causes, and credential-bearing configuration
 * never cross the narrow authority boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeManagedArtifactResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(MANAGED_ARTIFACT_RESOURCE_OPERATION_ERROR)
    );
  error.name = MANAGED_ARTIFACT_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentManagedArtifactResourceError';
  error.code = 'AWS_DEPLOYMENT_MANAGED_ARTIFACT_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/** @param {unknown} value @returns {value is string} */
function isUsableS3VersionId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value === 'null' ||
    Buffer.byteLength(value, 'utf8') > S3_VERSION_ID_MAX_UTF8_BYTES
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Preserve only the SSM missing classifications required by the provider-spec
 * resolver. Raw SDK messages, request IDs, access classifications, causes,
 * and credential-bearing configuration never cross this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeProviderSpecReadError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(PROVIDER_SPEC_READ_OPERATION_ERROR)
    );
  error.name = PROVIDER_SPEC_READ_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentProviderSpecReadError';
  error.code = 'AWS_DEPLOYMENT_PROVIDER_SPEC_READ_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the EBS classifications required for safe idempotent create
 * and authoritative readback. Raw SDK messages, request IDs, access
 * classifications, causes, and credential-bearing configuration never cross
 * this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeVolumeResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(VOLUME_RESOURCE_OPERATION_ERROR)
    );
  error.name = VOLUME_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentVolumeResourceError';
  error.code = 'AWS_DEPLOYMENT_VOLUME_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the EC2 classifications required for idempotent node launch,
 * authoritative absence, and deletion recovery. Raw SDK messages, request
 * IDs, access details, causes, and credential-bearing configuration never
 * cross this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeNodeResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(NODE_RESOURCE_OPERATION_ERROR)
    );
  error.name = NODE_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentNodeResourceError';
  error.code = 'AWS_DEPLOYMENT_NODE_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the EC2 classifications required to recover ambiguous
 * retained-volume attach, mapping, and detach attempts or report a stable
 * provider refusal. Raw SDK messages, request IDs, access details, causes,
 * and credential-bearing configuration never cross this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeVolumeAttachmentResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(VOLUME_ATTACHMENT_RESOURCE_OPERATION_ERROR)
    );
  error.name = VOLUME_ATTACHMENT_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentVolumeAttachmentResourceError';
  error.code = 'AWS_DEPLOYMENT_VOLUME_ATTACHMENT_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the network-resource classifications needed for authoritative
 * absence and dependency-fenced deletion. Raw SDK messages, request IDs,
 * access details, causes, and credential-bearing configuration never cross
 * this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeNetworkResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(NETWORK_RESOURCE_OPERATION_ERROR)
    );
  error.name = NETWORK_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentNetworkResourceError';
  error.code = 'AWS_DEPLOYMENT_NETWORK_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the IAM classifications needed for idempotent create,
 * authoritative absence, and dependency-fenced deletion. The SDK has emitted
 * both suffixed and unsuffixed names for these modeled IAM errors, so both map
 * to one stable boundary name. Raw messages, request IDs, access details,
 * causes, and credential-bearing configuration never cross this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeRuntimeIdentityResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(RUNTIME_IDENTITY_RESOURCE_OPERATION_ERROR)
    );
  error.name =
    RUNTIME_IDENTITY_RESOURCE_ERROR_NAMES.get(candidate.name) ??
    'AwsDeploymentRuntimeIdentityResourceError';
  error.code = 'AWS_DEPLOYMENT_RUNTIME_IDENTITY_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @returns {boolean} */
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.size &&
    actual.every((key) => keys.has(key)) &&
    [...keys].every((key) => Object.hasOwn(value, key))
  );
}

/** @param {unknown} options @returns {string} */
function readCanonicalRegion(options) {
  if (!isPlainObject(options) || !hasExactKeys(options, FACTORY_KEYS)) {
    throw new TypeError(INVALID_OPTIONS_ERROR);
  }
  const { region } = options;
  if (
    typeof region !== 'string' ||
    region.length > 63 ||
    !AWS_REGION_PATTERN.test(region)
  ) {
    throw new TypeError(INVALID_REGION_ERROR);
  }
  return region;
}

/** @param {unknown} value @returns {value is string} */
function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Copy only SDK credential identity fields into one immutable, non-refreshing
 * value. Nothing returned by this module exposes the snapshot.
 * @param {unknown} value - Resolved ordinary-chain credential identity.
 * @returns {Readonly<CredentialSnapshot>} - Static credentials.
 */
function createCredentialSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(INVALID_CREDENTIALS_ERROR);
  }
  const candidate = /** @type {Record<string, any>} */ (value);
  if (
    !isNonemptyString(candidate.accessKeyId) ||
    !isNonemptyString(candidate.secretAccessKey) ||
    (candidate.sessionToken !== undefined &&
      !isNonemptyString(candidate.sessionToken)) ||
    (candidate.expiration !== undefined &&
      (!(candidate.expiration instanceof Date) ||
        !Number.isFinite(candidate.expiration.getTime())))
  ) {
    throw new TypeError(INVALID_CREDENTIALS_ERROR);
  }

  return Object.freeze({
    accessKeyId: candidate.accessKeyId,
    secretAccessKey: candidate.secretAccessKey,
    ...(candidate.sessionToken === undefined
      ? {}
      : { sessionToken: candidate.sessionToken }),
    ...(candidate.expiration === undefined
      ? {}
      : { expiration: new Date(candidate.expiration.getTime()) }),
  });
}

/**
 * @param {unknown} value - GetCallerIdentity response.
 * @param {string} region - Explicit invocation region.
 * @returns {Readonly<import('./deployment-provider-scope.js').AwsProviderScope>} - Redacted scope.
 */
function scopeFromCallerIdentity(value, region) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(INVALID_CALLER_IDENTITY_ERROR);
  }
  const identity = /** @type {Record<string, any>} */ (value);
  const accountId = identity.Account;
  const arn = identity.Arn;
  if (
    typeof accountId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(accountId) ||
    typeof arn !== 'string' ||
    arn.length > 2048
  ) {
    throw new Error(INVALID_CALLER_IDENTITY_ERROR);
  }
  const match = AWS_CALLER_ARN_PATTERN.exec(arn);
  if (!match) throw new Error(INVALID_CALLER_IDENTITY_ERROR);
  const [, partition, arnAccountId] = match;
  if (arnAccountId !== accountId) {
    throw new Error(CALLER_IDENTITY_MISMATCH_ERROR);
  }
  return createAwsProviderScope({ partition, accountId, region });
}

/**
 * Resolve one invocation's ordinary AWS credentials into a non-exposed
 * capability. Every STS check and DynamoDB, S3, SSM, or EC2 client issued by
 * the capability uses the same static credential object and explicit region.
 * @param {{region: string}} options - Exact explicit invocation region.
 * @returns {Promise<Readonly<{
 *   providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>,
 *   resolveScope: () => Promise<Readonly<import('./deployment-provider-scope.js').AwsProviderScope>>,
 *   createDynamoDB: (options?: {readOnly?: boolean}) => import('../lib/db/base.js').DBClient,
 *   createDynamoDBControlClient: () => Readonly<DynamoDBControlClient>,
 *   createS3ControlClient: () => Readonly<S3ControlClient>,
 *   createManagedArtifactResourceClient: () => Readonly<ManagedArtifactResourceClient>,
 *   createProviderSpecReadClient: () => Readonly<ProviderSpecReadClient>,
 *   createVolumeResourceClient: () => Readonly<VolumeResourceClient>,
 *   createNodeResourceClient: () => Readonly<NodeResourceClient>,
 *   createVolumeAttachmentResourceClient: () => Readonly<VolumeAttachmentResourceClient>,
 *   createNetworkResourceClient: () => Readonly<NetworkResourceClient>,
 *   createRuntimeIdentityResourceClient: () => Readonly<RuntimeIdentityResourceClient>,
 *   close: () => Promise<void>,
 * }>>} - Credential-bound AWS authority.
 */
export async function createAwsDeploymentAuthority(options) {
  const region = readCanonicalRegion(options);
  let resolvedCredentials;
  try {
    const provider = fromNodeProviderChain({ clientConfig: { region } });
    resolvedCredentials = await provider();
  } catch {
    throw new Error(CREDENTIAL_RESOLUTION_ERROR);
  }
  /** @type {Readonly<CredentialSnapshot>} */
  let credentials;
  try {
    credentials = createCredentialSnapshot(resolvedCredentials);
  } catch {
    throw new TypeError(INVALID_CREDENTIALS_ERROR);
  }

  /** @type {STSClient} */
  let sts;
  try {
    sts = new STSClient({
      ...BaseAWS.config(),
      region,
      credentials,
    });
  } catch {
    throw new Error(INITIALIZATION_ERROR);
  }
  let closed = false;
  /** @type {Readonly<import('./deployment-provider-scope.js').AwsProviderScope> | undefined} */
  let providerScope;

  /** @returns {void} */
  function assertOpen() {
    if (closed) throw new Error(CLOSED_ERROR);
  }

  /** @returns {Promise<Readonly<import('./deployment-provider-scope.js').AwsProviderScope>>} */
  async function resolveScope() {
    assertOpen();
    let identity;
    try {
      identity = await sts.send(new GetCallerIdentityCommand({}));
    } catch {
      throw new Error(CALLER_IDENTITY_ERROR);
    }
    const scope = scopeFromCallerIdentity(identity, region);
    if (
      providerScope !== undefined &&
      scope.providerScopeId !== providerScope.providerScopeId
    ) {
      throw new Error(CALLER_IDENTITY_CHANGED_ERROR);
    }
    return scope;
  }

  try {
    providerScope = await resolveScope();
  } catch (error) {
    try {
      sts.destroy();
    } catch {
      // The identity error is the useful fixed boundary failure.
    }
    throw error;
  }

  /** @param {{readOnly?: boolean}} [dbOptions] @returns {import('../lib/db/base.js').DBClient} */
  function createDynamoDB(dbOptions = {}) {
    assertOpen();
    if (
      !isPlainObject(dbOptions) ||
      Object.keys(dbOptions).some((key) => !DYNAMODB_FACTORY_KEYS.has(key)) ||
      (dbOptions.readOnly !== undefined &&
        typeof dbOptions.readOnly !== 'boolean')
    ) {
      throw new TypeError('AWS deployment DynamoDB options are invalid.');
    }
    try {
      return createDynamoDBAdapter({
        region,
        credentials,
        readOnly: dbOptions.readOnly ?? false,
      });
    } catch {
      throw new Error(DYNAMODB_CREATION_ERROR);
    }
  }

  /** @returns {Readonly<DynamoDBControlClient>} - Caller-owned narrow control-plane client. */
  function createDynamoDBControlClient() {
    assertOpen();
    /** @type {DynamoDB} */
    let client;
    try {
      client = new DynamoDB({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      throw new Error(DYNAMODB_CREATION_ERROR);
    }
    let clientClosed = false;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    function call(operation) {
      if (clientClosed) throw new Error(DYNAMODB_CONTROL_CLOSED_ERROR);
      return operation();
    }

    return Object.freeze({
      createTable: (
        /** @type {import('@aws-sdk/client-dynamodb').CreateTableCommandInput} */ input,
      ) => call(() => client.createTable(input)),
      describeContinuousBackups: (
        /** @type {import('@aws-sdk/client-dynamodb').DescribeContinuousBackupsCommandInput} */ input,
      ) => call(() => client.describeContinuousBackups(input)),
      describeTable: (
        /** @type {import('@aws-sdk/client-dynamodb').DescribeTableCommandInput} */ input,
      ) => call(() => client.describeTable(input)),
      describeTimeToLive: (
        /** @type {import('@aws-sdk/client-dynamodb').DescribeTimeToLiveCommandInput} */ input,
      ) => call(() => client.describeTimeToLive(input)),
      listTagsOfResource: (
        /** @type {import('@aws-sdk/client-dynamodb').ListTagsOfResourceCommandInput} */ input,
      ) => call(() => client.listTagsOfResource(input)),
      updateContinuousBackups: (
        /** @type {import('@aws-sdk/client-dynamodb').UpdateContinuousBackupsCommandInput} */ input,
      ) => call(() => client.updateContinuousBackups(input)),
      close: async () => {
        if (clientClosed) return;
        clientClosed = true;
        try {
          client.destroy();
        } catch {
          throw new Error(DYNAMODB_CONTROL_CLOSE_ERROR);
        }
      },
    });
  }

  /** @returns {Readonly<S3ControlClient>} - Caller-owned narrow control-plane client. */
  function createS3ControlClient() {
    assertOpen();
    /** @type {S3} */
    let client;
    try {
      client = new S3({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      throw new Error(S3_CONTROL_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(S3_CONTROL_CLOSED_ERROR);
      // Lifecycle and staging consumers must distinguish authoritative AWS
      // outcomes such as NoSuchBucket, NoSuchLifecycleConfiguration, and a
      // conditional PutObject collision. Preserve only those allowlisted
      // classifications while stripping the raw provider failure.
      try {
        return await operation();
      } catch (error) {
        throw sanitizeS3ControlError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(S3_CONTROL_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      createBucket: (
        /** @type {import('@aws-sdk/client-s3').CreateBucketCommandInput} */ input,
      ) => call(() => client.createBucket(input)),
      headBucket: (
        /** @type {import('@aws-sdk/client-s3').HeadBucketCommandInput} */ input,
      ) => call(() => client.headBucket(input)),
      getBucketEncryption: (
        /** @type {import('@aws-sdk/client-s3').GetBucketEncryptionCommandInput} */ input,
      ) => call(() => client.getBucketEncryption(input)),
      getBucketLifecycleConfiguration: (
        /** @type {import('@aws-sdk/client-s3').GetBucketLifecycleConfigurationCommandInput} */ input,
      ) => call(() => client.getBucketLifecycleConfiguration(input)),
      getBucketLocation: (
        /** @type {import('@aws-sdk/client-s3').GetBucketLocationCommandInput} */ input,
      ) => call(() => client.getBucketLocation(input)),
      getBucketOwnershipControls: (
        /** @type {import('@aws-sdk/client-s3').GetBucketOwnershipControlsCommandInput} */ input,
      ) => call(() => client.getBucketOwnershipControls(input)),
      getBucketPolicy: (
        /** @type {import('@aws-sdk/client-s3').GetBucketPolicyCommandInput} */ input,
      ) => call(() => client.getBucketPolicy(input)),
      getBucketReplication: (
        /** @type {import('@aws-sdk/client-s3').GetBucketReplicationCommandInput} */ input,
      ) => call(() => client.getBucketReplication(input)),
      getBucketTagging: (
        /** @type {import('@aws-sdk/client-s3').GetBucketTaggingCommandInput} */ input,
      ) => call(() => client.getBucketTagging(input)),
      getBucketVersioning: (
        /** @type {import('@aws-sdk/client-s3').GetBucketVersioningCommandInput} */ input,
      ) => call(() => client.getBucketVersioning(input)),
      getPublicAccessBlock: (
        /** @type {import('@aws-sdk/client-s3').GetPublicAccessBlockCommandInput} */ input,
      ) => call(() => client.getPublicAccessBlock(input)),
      getObject: (
        /** @type {import('@aws-sdk/client-s3').GetObjectCommandInput} */ input,
      ) => call(() => client.getObject(input)),
      putBucketEncryption: (
        /** @type {import('@aws-sdk/client-s3').PutBucketEncryptionCommandInput} */ input,
      ) => call(() => client.putBucketEncryption(input)),
      putBucketLifecycleConfiguration: (
        /** @type {import('@aws-sdk/client-s3').PutBucketLifecycleConfigurationCommandInput} */ input,
      ) => call(() => client.putBucketLifecycleConfiguration(input)),
      putBucketOwnershipControls: (
        /** @type {import('@aws-sdk/client-s3').PutBucketOwnershipControlsCommandInput} */ input,
      ) => call(() => client.putBucketOwnershipControls(input)),
      putBucketVersioning: (
        /** @type {import('@aws-sdk/client-s3').PutBucketVersioningCommandInput} */ input,
      ) => call(() => client.putBucketVersioning(input)),
      putPublicAccessBlock: (
        /** @type {import('@aws-sdk/client-s3').PutPublicAccessBlockCommandInput} */ input,
      ) => call(() => client.putPublicAccessBlock(input)),
      putObject: (
        /** @type {import('@aws-sdk/client-s3').PutObjectCommandInput} */ input,
      ) => call(() => client.putObject(input)),
      headObject: (
        /** @type {import('@aws-sdk/client-s3').HeadObjectCommandInput} */ input,
      ) => call(() => client.headObject(input)),
      close: closeClient,
    });
  }

  /** @returns {Readonly<ManagedArtifactResourceClient>} - Caller-owned narrow managed-artifact client. */
  function createManagedArtifactResourceClient() {
    assertOpen();
    /** @type {S3} */
    let client;
    try {
      client = new S3({
        // Conditional copy and exact-version deletion settle only through the
        // driver's explicit readback. Hidden SDK retries must not multiply one
        // authorized effect.
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
    } catch {
      throw new Error(MANAGED_ARTIFACT_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) {
        throw new Error(MANAGED_ARTIFACT_RESOURCE_CLOSED_ERROR);
      }
      try {
        return await operation();
      } catch (error) {
        throw sanitizeManagedArtifactResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(MANAGED_ARTIFACT_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      copyObject: (
        /** @type {import('@aws-sdk/client-s3').CopyObjectCommandInput} */ input,
      ) => call(() => client.copyObject(input)),
      headObject: (
        /** @type {import('@aws-sdk/client-s3').HeadObjectCommandInput} */ input,
      ) => call(() => client.headObject(input)),
      listObjectVersions: (
        /** @type {import('@aws-sdk/client-s3').ListObjectVersionsCommandInput} */ input,
      ) => call(() => client.listObjectVersions(input)),
      deleteObjectVersion: (
        /** @type {import('@aws-sdk/client-s3').DeleteObjectCommandInput & {VersionId: string}} */ input,
      ) => {
        if (!isPlainObject(input) || !isUsableS3VersionId(input.VersionId)) {
          throw new TypeError(MANAGED_ARTIFACT_RESOURCE_VERSION_ERROR);
        }
        return call(() => client.deleteObject(input));
      },
      close: closeClient,
    });
  }

  /** @returns {Readonly<ProviderSpecReadClient>} - Caller-owned narrow provider-spec read client. */
  function createProviderSpecReadClient() {
    assertOpen();
    /** @type {SSMClient | undefined} */
    let ssm;
    /** @type {EC2Client | undefined} */
    let ec2;
    try {
      ssm = new SSMClient({
        ...BaseAWS.config(),
        region,
        credentials,
      });
      ec2 = new EC2Client({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      try {
        ssm?.destroy();
      } catch {
        // Construction failure remains the fixed boundary error.
      }
      try {
        ec2?.destroy();
      } catch {
        // Construction failure remains the fixed boundary error.
      }
      throw new Error(PROVIDER_SPEC_READ_CREATION_ERROR);
    }
    if (ssm === undefined || ec2 === undefined) {
      throw new Error(PROVIDER_SPEC_READ_CREATION_ERROR);
    }
    const ssmClient = ssm;
    const ec2Client = ec2;
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(PROVIDER_SPEC_READ_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeProviderSpecReadError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        let failed = false;
        try {
          ssmClient.destroy();
        } catch {
          failed = true;
        }
        try {
          ec2Client.destroy();
        } catch {
          failed = true;
        }
        if (failed) throw new Error(PROVIDER_SPEC_READ_CLOSE_ERROR);
      })();
      return closePromise;
    }

    return Object.freeze({
      getParameter: (
        /** @type {import('@aws-sdk/client-ssm').GetParameterCommandInput} */ input,
      ) => call(() => ssmClient.send(new GetParameterCommand(input))),
      describeAvailabilityZones: (
        /** @type {import('@aws-sdk/client-ec2').DescribeAvailabilityZonesCommandInput} */ input,
      ) =>
        call(() => ec2Client.send(new DescribeAvailabilityZonesCommand(input))),
      describeImages: (
        /** @type {import('@aws-sdk/client-ec2').DescribeImagesCommandInput} */ input,
      ) => call(() => ec2Client.send(new DescribeImagesCommand(input))),
      describeInstanceTypeOfferings: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstanceTypeOfferingsCommandInput} */ input,
      ) =>
        call(() =>
          ec2Client.send(new DescribeInstanceTypeOfferingsCommand(input)),
        ),
      getEbsDefaultKmsKeyId: (
        /** @type {import('@aws-sdk/client-ec2').GetEbsDefaultKmsKeyIdCommandInput} */ input,
      ) => call(() => ec2Client.send(new GetEbsDefaultKmsKeyIdCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<VolumeResourceClient>} - Caller-owned narrow EBS resource client. */
  function createVolumeResourceClient() {
    assertOpen();
    /** @type {EC2Client} */
    let client;
    try {
      client = new EC2Client({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      throw new Error(VOLUME_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(VOLUME_RESOURCE_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeVolumeResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(VOLUME_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      createVolume: (
        /** @type {import('@aws-sdk/client-ec2').CreateVolumeCommandInput} */ input,
      ) => call(() => client.send(new CreateVolumeCommand(input))),
      describeVolumes: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVolumesCommandInput} */ input,
      ) => call(() => client.send(new DescribeVolumesCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<NodeResourceClient>} - Caller-owned narrow EC2 node resource client. */
  function createNodeResourceClient() {
    assertOpen();
    /** @type {EC2Client} */
    let client;
    try {
      client = new EC2Client({
        // Node mutations use explicit provider recovery identities. Keep SDK
        // transport retries from hiding an ambiguous launch or termination.
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
    } catch {
      throw new Error(NODE_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(NODE_RESOURCE_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeNodeResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(NODE_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      runInstances: (
        /** @type {import('@aws-sdk/client-ec2').RunInstancesCommandInput} */ input,
      ) => call(() => client.send(new RunInstancesCommand(input))),
      startInstances: (
        /** @type {import('@aws-sdk/client-ec2').StartInstancesCommandInput} */ input,
      ) => call(() => client.send(new StartInstancesCommand(input))),
      describeInstances: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstancesCommandInput} */ input,
      ) => call(() => client.send(new DescribeInstancesCommand(input))),
      describeInstanceAttribute: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstanceAttributeCommandInput} */ input,
      ) => call(() => client.send(new DescribeInstanceAttributeCommand(input))),
      describeInstanceCreditSpecifications: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstanceCreditSpecificationsCommandInput} */ input,
      ) =>
        call(() =>
          client.send(new DescribeInstanceCreditSpecificationsCommand(input)),
        ),
      describeVolumes: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVolumesCommandInput} */ input,
      ) => call(() => client.send(new DescribeVolumesCommand(input))),
      terminateInstances: (
        /** @type {import('@aws-sdk/client-ec2').TerminateInstancesCommandInput} */ input,
      ) => call(() => client.send(new TerminateInstancesCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<VolumeAttachmentResourceClient>} - Caller-owned narrow retained-volume attachment client. */
  function createVolumeAttachmentResourceClient() {
    assertOpen();
    /** @type {EC2Client} */
    let client;
    try {
      client = new EC2Client({
        // Attachment mutations have no provider idempotency token. Perform one
        // SDK attempt, then let the driver recover solely from exact dual
        // instance/volume readback.
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
    } catch {
      throw new Error(VOLUME_ATTACHMENT_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) {
        throw new Error(VOLUME_ATTACHMENT_RESOURCE_CLOSED_ERROR);
      }
      try {
        return await operation();
      } catch (error) {
        throw sanitizeVolumeAttachmentResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(VOLUME_ATTACHMENT_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      attachVolume: (
        /** @type {import('@aws-sdk/client-ec2').AttachVolumeCommandInput} */ input,
      ) => call(() => client.send(new AttachVolumeCommand(input))),
      detachVolume: (
        /** @type {import('@aws-sdk/client-ec2').DetachVolumeCommandInput} */ input,
      ) => call(() => client.send(new DetachVolumeCommand(input))),
      modifyInstanceAttribute: (
        /** @type {import('@aws-sdk/client-ec2').ModifyInstanceAttributeCommandInput} */ input,
      ) => call(() => client.send(new ModifyInstanceAttributeCommand(input))),
      describeInstances: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstancesCommandInput} */ input,
      ) => call(() => client.send(new DescribeInstancesCommand(input))),
      describeVolumes: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVolumesCommandInput} */ input,
      ) => call(() => client.send(new DescribeVolumesCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<NetworkResourceClient>} - Caller-owned narrow network resource client. */
  function createNetworkResourceClient() {
    assertOpen();
    /** @type {EC2Client} */
    let client;
    try {
      client = new EC2Client({
        // Keep SDK transport retries from multiplying one authorized effect.
        // A driver may supply its own provider token where supported, but every
        // driver owns explicit recovery through exact readback.
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
    } catch {
      throw new Error(NETWORK_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(NETWORK_RESOURCE_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeNetworkResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(NETWORK_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      associateRouteTable: (
        /** @type {import('@aws-sdk/client-ec2').AssociateRouteTableCommandInput} */ input,
      ) => call(() => client.send(new AssociateRouteTableCommand(input))),
      attachInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').AttachInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new AttachInternetGatewayCommand(input))),
      createInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').CreateInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new CreateInternetGatewayCommand(input))),
      createRoute: (
        /** @type {import('@aws-sdk/client-ec2').CreateRouteCommandInput} */ input,
      ) => call(() => client.send(new CreateRouteCommand(input))),
      createRouteTable: (
        /** @type {import('@aws-sdk/client-ec2').CreateRouteTableCommandInput} */ input,
      ) => call(() => client.send(new CreateRouteTableCommand(input))),
      createSecurityGroup: (
        /** @type {import('@aws-sdk/client-ec2').CreateSecurityGroupCommandInput} */ input,
      ) => call(() => client.send(new CreateSecurityGroupCommand(input))),
      createSubnet: (
        /** @type {import('@aws-sdk/client-ec2').CreateSubnetCommandInput} */ input,
      ) => call(() => client.send(new CreateSubnetCommand(input))),
      createVpc: (
        /** @type {import('@aws-sdk/client-ec2').CreateVpcCommandInput} */ input,
      ) => call(() => client.send(new CreateVpcCommand(input))),
      describeInternetGateways: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInternetGatewaysCommandInput} */ input,
      ) => call(() => client.send(new DescribeInternetGatewaysCommand(input))),
      describeRouteTables: (
        /** @type {import('@aws-sdk/client-ec2').DescribeRouteTablesCommandInput} */ input,
      ) => call(() => client.send(new DescribeRouteTablesCommand(input))),
      describeSecurityGroups: (
        /** @type {import('@aws-sdk/client-ec2').DescribeSecurityGroupsCommandInput} */ input,
      ) => call(() => client.send(new DescribeSecurityGroupsCommand(input))),
      describeSubnets: (
        /** @type {import('@aws-sdk/client-ec2').DescribeSubnetsCommandInput} */ input,
      ) => call(() => client.send(new DescribeSubnetsCommand(input))),
      describeVpcs: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVpcsCommandInput} */ input,
      ) => call(() => client.send(new DescribeVpcsCommand(input))),
      describeVpcAttribute: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVpcAttributeCommandInput} */ input,
      ) => call(() => client.send(new DescribeVpcAttributeCommand(input))),
      disassociateRouteTable: (
        /** @type {import('@aws-sdk/client-ec2').DisassociateRouteTableCommandInput} */ input,
      ) => call(() => client.send(new DisassociateRouteTableCommand(input))),
      detachInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').DetachInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new DetachInternetGatewayCommand(input))),
      deleteInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').DeleteInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new DeleteInternetGatewayCommand(input))),
      deleteRoute: (
        /** @type {import('@aws-sdk/client-ec2').DeleteRouteCommandInput} */ input,
      ) => call(() => client.send(new DeleteRouteCommand(input))),
      deleteRouteTable: (
        /** @type {import('@aws-sdk/client-ec2').DeleteRouteTableCommandInput} */ input,
      ) => call(() => client.send(new DeleteRouteTableCommand(input))),
      deleteSecurityGroup: (
        /** @type {import('@aws-sdk/client-ec2').DeleteSecurityGroupCommandInput} */ input,
      ) => call(() => client.send(new DeleteSecurityGroupCommand(input))),
      deleteSubnet: (
        /** @type {import('@aws-sdk/client-ec2').DeleteSubnetCommandInput} */ input,
      ) => call(() => client.send(new DeleteSubnetCommand(input))),
      deleteVpc: (
        /** @type {import('@aws-sdk/client-ec2').DeleteVpcCommandInput} */ input,
      ) => call(() => client.send(new DeleteVpcCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<RuntimeIdentityResourceClient>} - Caller-owned narrow IAM and EC2 runtime-identity resource client. */
  function createRuntimeIdentityResourceClient() {
    assertOpen();
    /** @type {IAMClient | undefined} */
    let iamClient;
    /** @type {EC2Client | undefined} */
    let ec2Client;
    try {
      iamClient = new IAMClient({
        // IAM mutations do not carry provider idempotency tokens. Recovery is
        // explicit exact readback, so transport retries must not duplicate one
        // authorized effect.
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
      ec2Client = new EC2Client({
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
    } catch {
      try {
        iamClient?.destroy();
      } catch {
        // The fixed construction failure is the useful boundary error.
      }
      try {
        ec2Client?.destroy();
      } catch {
        // The fixed construction failure is the useful boundary error.
      }
      throw new Error(RUNTIME_IDENTITY_RESOURCE_CREATION_ERROR);
    }
    const runtimeIamClient = iamClient;
    const runtimeEc2Client = ec2Client;
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) {
        throw new Error(RUNTIME_IDENTITY_RESOURCE_CLOSED_ERROR);
      }
      try {
        return await operation();
      } catch (error) {
        throw sanitizeRuntimeIdentityResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        let failed = false;
        try {
          runtimeIamClient.destroy();
        } catch {
          failed = true;
        }
        try {
          runtimeEc2Client.destroy();
        } catch {
          failed = true;
        }
        if (failed) throw new Error(RUNTIME_IDENTITY_RESOURCE_CLOSE_ERROR);
      })();
      return closePromise;
    }

    return Object.freeze({
      createRole: (
        /** @type {import('@aws-sdk/client-iam').CreateRoleCommandInput} */ input,
      ) => call(() => runtimeIamClient.send(new CreateRoleCommand(input))),
      getRole: (
        /** @type {import('@aws-sdk/client-iam').GetRoleCommandInput} */ input,
      ) => call(() => runtimeIamClient.send(new GetRoleCommand(input))),
      deleteRole: (
        /** @type {import('@aws-sdk/client-iam').DeleteRoleCommandInput} */ input,
      ) => call(() => runtimeIamClient.send(new DeleteRoleCommand(input))),
      listRoleTags: (
        /** @type {import('@aws-sdk/client-iam').ListRoleTagsCommandInput} */ input,
      ) => call(() => runtimeIamClient.send(new ListRoleTagsCommand(input))),
      listRolePolicies: (
        /** @type {import('@aws-sdk/client-iam').ListRolePoliciesCommandInput} */ input,
      ) =>
        call(() => runtimeIamClient.send(new ListRolePoliciesCommand(input))),
      listAttachedRolePolicies: (
        /** @type {import('@aws-sdk/client-iam').ListAttachedRolePoliciesCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(new ListAttachedRolePoliciesCommand(input)),
        ),
      putRolePolicy: (
        /** @type {import('@aws-sdk/client-iam').PutRolePolicyCommandInput} */ input,
      ) => call(() => runtimeIamClient.send(new PutRolePolicyCommand(input))),
      getRolePolicy: (
        /** @type {import('@aws-sdk/client-iam').GetRolePolicyCommandInput} */ input,
      ) => call(() => runtimeIamClient.send(new GetRolePolicyCommand(input))),
      deleteRolePolicy: (
        /** @type {import('@aws-sdk/client-iam').DeleteRolePolicyCommandInput} */ input,
      ) =>
        call(() => runtimeIamClient.send(new DeleteRolePolicyCommand(input))),
      createInstanceProfile: (
        /** @type {import('@aws-sdk/client-iam').CreateInstanceProfileCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(new CreateInstanceProfileCommand(input)),
        ),
      getInstanceProfile: (
        /** @type {import('@aws-sdk/client-iam').GetInstanceProfileCommandInput} */ input,
      ) =>
        call(() => runtimeIamClient.send(new GetInstanceProfileCommand(input))),
      deleteInstanceProfile: (
        /** @type {import('@aws-sdk/client-iam').DeleteInstanceProfileCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(new DeleteInstanceProfileCommand(input)),
        ),
      listInstanceProfileTags: (
        /** @type {import('@aws-sdk/client-iam').ListInstanceProfileTagsCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(new ListInstanceProfileTagsCommand(input)),
        ),
      addRoleToInstanceProfile: (
        /** @type {import('@aws-sdk/client-iam').AddRoleToInstanceProfileCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(new AddRoleToInstanceProfileCommand(input)),
        ),
      removeRoleFromInstanceProfile: (
        /** @type {import('@aws-sdk/client-iam').RemoveRoleFromInstanceProfileCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(
            new RemoveRoleFromInstanceProfileCommand(input),
          ),
        ),
      listInstanceProfilesForRole: (
        /** @type {import('@aws-sdk/client-iam').ListInstanceProfilesForRoleCommandInput} */ input,
      ) =>
        call(() =>
          runtimeIamClient.send(new ListInstanceProfilesForRoleCommand(input)),
        ),
      describeInstances: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstancesCommandInput} */ input,
      ) =>
        call(() => runtimeEc2Client.send(new DescribeInstancesCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Promise<void>} */
  async function close() {
    if (closed) return;
    closed = true;
    try {
      sts.destroy();
    } catch {
      throw new Error(CLOSE_ERROR);
    }
  }

  return Object.freeze({
    providerScope,
    resolveScope,
    createDynamoDB,
    createDynamoDBControlClient,
    createS3ControlClient,
    createManagedArtifactResourceClient,
    createProviderSpecReadClient,
    createVolumeResourceClient,
    createNodeResourceClient,
    createVolumeAttachmentResourceClient,
    createNetworkResourceClient,
    createRuntimeIdentityResourceClient,
    close,
  });
}

export default { createAwsDeploymentAuthority };
