'use strict';

/**
 * @typedef ScheduledEventRecord
 * @property {string} resource_id -
 * @property {string} sort_key -
 * @property {number} started_at -
 * @property {number} updated_at -
 * @property {string} status -
 * @property {any?} [partition] -
 * @property {number} [retries] -
 * @property {number} [ttl] -
 */

/**
 * @typedef WharfieEventRecord
 * @property {string} resource_id -
 * @property {string} operation_id -
 * @property {string} type -
 * @property {string} version -
 * @property {number} retries -
 */
/**
 * @typedef S3EventUserIdentity
 * @property {string} principalId -
 */

/**
 * @typedef S3EventRequestParameters
 * @property {string} sourceIPAddress -
 */

/**
 * @typedef S3EventResponseElements
 * @property {string} x-amz-request-id -
 * @property {string} x-amz-id-2 -
 */

/**
 * @typedef S3EventS3Bucket
 * @property {string} name -
 * @property {string} configurationId -
 * @property {S3EventUserIdentity} ownerIdentity -
 * @property {string} arn -
 */

/**
 * @typedef S3EventS3Object
 * @property {string} key -
 * @property {string} size -
 * @property {string} eTag -
 * @property {string} versionId -
 * @property {string} sequencer -
 */

/**
 * @typedef S3EventS3
 * @property {string} s3SchemaVersion -
 * @property {string} configurationId -
 * @property {S3EventS3Bucket} bucket -
 * @property {S3EventS3Object} object -
 */

/**
 * @typedef S3EventServiceRecord
 * @property {string} eventVersion -
 * @property {string} eventSource -
 * @property {string} awsRegion -
 * @property {string} eventTime -
 * @property {string} eventName -
 * @property {S3EventUserIdentity} userIdentity -
 * @property {S3EventRequestParameters} requestParameters -
 * @property {S3EventResponseElements} responseElements -
 * @property {S3EventS3} s3 -
 * @property {string} glacierEventData -
 */

/**
 * @typedef S3EventBridgeDetailBucket
 * @property {string} name -
 */

/**
 * @typedef S3EventBridgeDetailObject
 * @property {string} key -
 * @property {number} size -
 * @property {string} etag -
 * @property {string} version-id -
 * @property {string} sequencer -
 */

/**
 * @typedef S3EventBridgeDetail
 * @property {string} version -
 * @property {S3EventBridgeDetailBucket} bucket -
 * @property {S3EventBridgeDetailObject} object -
 * @property {string} account -
 * @property {string} request-id -
 * @property {string} requester -
 * @property {string} source-ip-address -
 * @property {string} reason -
 */

/**
 * @typedef S3EventBridgeRecord
 * @property {string} version -
 * @property {string} id -
 * @property {string} source -
 * @property {string} account -
 * @property {string} time -
 * @property {string} region -
 * @property {string[]} resources -
 * @property {S3EventUserIdentity} userIdentity -
 * @property {S3EventRequestParameters} requestParameters -
 * @property {S3EventResponseElements} responseElements -
 * @property {S3EventBridgeDetail} detail -
 * @property {string} glacierEventData -
 */

/**
 * @typedef {S3EventServiceRecord & S3EventBridgeRecord} S3EventRecord
 */

/**
 * @typedef S3Event
 * @property {number} [retries] -
 * @property {S3EventServiceRecord[]} Records -
 * @property {string} Event -
 */

/**
 * @typedef {S3Event & S3EventBridgeRecord & ScheduledEventRecord & WharfieEventRecord} InputEvent
 */

/**
 * @typedef {S3Event & S3EventBridgeRecord & ScheduledEventRecord & WharfieEventRecord} NormalizedEvent
 */

exports.unused = {};
