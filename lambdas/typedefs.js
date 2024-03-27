'use strict';

/**
 * @typedef AthenaUDFPingInputEvent
 * @property {AthenaUDFInputEventIdentity} identity -
 * @property {string} catalogName -
 * @property {string} queryId -
 *
 * This object also includes an '@type' property that is used to determine the type of the event.
 */

/**
 * @typedef AthenaUDFPingOutputEvent
 * @property {string} catalogName -
 * @property {string} queryId -
 * @property {string} sourceType -
 * @property {number} capabilities -
 * @property {number} serDeVersion -
 *
 * This object also includes an '@type' property that is used to determine the type of the event.
 */

/**
 * @typedef AthenaUDFRecordsInputEvent
 * @property {AthenaUDFInputEventIdentity} identity -
 * @property {AthenaUDFRecords} inputRecords -
 * @property {string} outputSchema -
 * @property {string} methodName -
 * @property {string} functionType -
 *
 * This object also includes an '@type' property that is used to determine the type of the event.
 */

/**
 * @typedef AthenaUDFRecordsOutputEvent
 * @property {AthenaUDFRecords} records -
 * @property {string} methodName -
 *
 * This object also includes an '@type' property that is used to determine the type of the event.
 */

/**
 * @typedef AthenaUDFRecords
 * @property {string} aid -
 * @property {string} schema -
 * @property {string} records -
 */

/**
 * @typedef AthenaUDFInputEventIdentity
 * @property {string} id -
 * @property {string} principal -
 * @property {string} account -
 * @property {string} arn -
 * @property {Object<string,string>} tags -
 * @property {string[]} groups -
 */

/**
 * @typedef WharfieEvent
 * @property {string} [operation_started_at] - Timestamp when operation was started
 * @property {string} [operation_id] - Id of the operation being performed
 * @property {string} operation_type - Type of the operation being performed
 * @property {string} [action_id] - Id of the action being performed
 * @property {string} action_type - Type of the action being performed
 * @property {string} resource_id - Id of the Wharfie resource
 * @property {string} [query_id] - Id of the query being run
 * @property {number} [retries] - number of attempts
 * @property {number} [run_query_retries] - number of attempts at starting a query
 * @property {string} [source] - where the wharfie event originated from
 * @property {any} [operation_inputs] - Input Blob for the operation
 * @property {any} [action_inputs] - Input Blob for the operation
 */

/**
 * @typedef ActionProcessingOutput
 * @property {string} status -
 * @property {any} [nextActionInputs] -
 */

/**
 * @typedef AthenaEventDetail
 * @property {string} versionId -
 * @property {string} currentState -
 * @property {string} previousState -
 * @property {string} statementType -
 * @property {string} queryExecutionId -
 * @property {string} workgroupName -
 * @property {string} sequenceNumber -
 */

/**
 * @typedef AthenaEvent
 * @property {string} version -
 * @property {string} id -
 * @property {string} detail-type -
 * @property {string} source -
 * @property {string} account -
 * @property {string} time -
 * @property {string} region -
 * @property {number} retries - number of attempts
 * @property {Array<any>} resources -
 * @property {AthenaEventDetail} detail -
 */

/**
 * @typedef DaemonConfigSLA
 * @property {number} MaxDelay -
 * @property {string} ColumnExpression -
 */

/**
 * @typedef DaemonConfig
 * @property {string} MaterializationPartitionQuery -
 * @property {string} Mode -
 * @property {string} Role -
 * @property {string} PrimaryKey -
 * @property {string} Schedule -
 * @property {string} Interval -
 * @property {DaemonConfigSLA} SLA -
 * @property {string[]} AlarmActions -
 */

/**
 * @typedef DeduplicationRecord
 * @property {string} message_deduplication_id -
 * @property {string} message_group_id -
 * @property {number} consumption_count -
 * @property {string} [message_status] -
 * @property {number} [updated_at] -
 */

/**
 * @typedef ResourceRecord
 * @property {string} resource_id - name of the wharfie cloudformation stack
 * @property {string} resource_status -
 * @property {string} resource_arn - arn of the wharfie cloudformation stack
 * @property {string} athena_workgroup - name of the stack's athena workgroup
 * @property {DaemonConfig} daemon_config -
 * @property {any} source_properties -
 * @property {any} destination_properties -
 * @property {string} wharfie_version -
 */

/**
 * @typedef OperationRecord
 * @property {string} resource_id - Id of the resource
 * @property {string} operation_id - Id of the operation
 * @property {string} operation_type - type of operation
 * @property {string} operation_status - status of operation
 * @property {number} started_at - start timestamp
 * @property {number} last_updated_at - update_at_timestamp
 * @property {import('./lib/graph/').OperationActionGraph} action_graph - action dependency graph
 * @property {any} [operation_config] - configuration Blob for the operation
 * @property {ActionRecord[]} [actions] -
 * @property {any} [operation_inputs] - Input Blob for the operation
 */

/**
 * @typedef ActionRecord
 * @property {string} action_id - Id of the action associated with that query
 * @property {string} action_type - type of action
 * @property {string} action_status - status of the action
 * @property {QueryRecord[]} [queries] -
 */

/**
 * @typedef QueryRecord
 * @property {string} query_id - Id of the query
 * @property {string} [query_execution_id] - Athena execution id
 * @property {string} query_status - status of the query
 * @property {number} [last_updated_at] - update_at_timestamp
 * @property {any} query_data - query metadata, used by actions
 */

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
 * @property {string} database_name -
 * @property {string} table_name -
 * @property {string} version -
 * @property {string} type -
 * @property {number} [retries] -
 */

/**
 * @typedef QueryEnqueueInput
 * @property {string} query_string -
 * @property {any} [query_data] -
 */

/**
 * @typedef {Object.<string, string | number>} PartitionValues
 * @typedef Partition
 * @property {string} location - S3 Location of the partition
 * @property {PartitionValues} partitionValues - Partition key values
 */

/**
 * @typedef CloudformationUpdateRequest
 * @property {any} OldResourceProperties -
 * @typedef {CloudformationEvent & CloudformationUpdateRequest} CloudformationUpdateEvent
 */

/**
 * @typedef CloudformationRequestType
 * @property {string} RequestType - Type of Cloudformation update
 * @typedef {import('aws-lambda').CloudFormationCustomResourceEventCommon & CloudformationRequestType} CloudformationEvent
 */

/**
 * @typedef S3Location
 * @property {string} bucket - S3 bucket name
 * @property {string} prefix - S3 prefix
 */

/**
 * @typedef LocationRecord
 * @property {string} location - location of the wharfie input
 * @property {string} resource_id - name of the wharfie cloudformation stack
 * @property {string} interval - interval to deduplicate and process s3 events
 */

/**
 * @typedef DependencyRecord
 * @property {string} dependency - upstream dependency db name + table name
 * @property {string} resource_id - id of the wharfie resource that has the associated dependency
 * @property {string} interval - interval to deduplicate and process wharfie events
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
 * @typedef CleanupEvent
 * @property {string} operation_id - Id of the operation being performed
 * @property {string} action_id -
 * @property {string} resource_id - Id of the Wharfie resource
 * @property {number} [retries] -
 * @property {number} [delays] -
 * @property {string} manifest_uri -
 */

/**
 * @typedef ResourceRouterResponse
 * @property {boolean} respond - whether the router should respond to the cloudformation api, defaults to true
 */

exports.unused = {};
