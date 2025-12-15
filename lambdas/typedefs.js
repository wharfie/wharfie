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
 * @typedef {('MIGRATE'|'LOAD'|'BACKFILL')} WharfieOperationTypeEnum
 */
/**
 * @typedef {('COMPLETED'|'RUNNING')} WharfieOperationStatusEnum
 */

/**
 * @typedef WharfieEvent
 * @property {string} [operation_started_at] - Timestamp when operation was started
 * @property {string} [operation_id] - Id of the operation being performed
 * @property {WharfieOperationTypeEnum} operation_type - Type of the operation being performed
 * @property {string} [action_id] - Id of the action being performed
 * @property {import('./lib/graph/action.js').WharfieActionTypeEnum} action_type - Type of the action being performed
 * @property {string} resource_id - Id of the Wharfie resource
 * @property {number} [resource_version] - version of the Wharfie resource
 * @property {string} [query_id] - Id of the query being run
 * @property {number} [retries] - number of attempts
 * @property {number} [run_query_retries] - number of attempts at starting a query
 * @property {string} [source] - where the wharfie event originated from
 * @property {any} [operation_inputs] - Input Blob for the operation
 * @property {any} [action_inputs] - Input Blob for the operation
 */

/**
 * @typedef ActionProcessingOutput
 * @property {import('./lib/graph/action.js').WharfieActionStatusEnum} status -
 * @property {any} [outputs] -
 * @property {boolean} [inflightQuery] -
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
 * @property {string} Role -
 * @property {string} [Schedule] -
 * @property {DaemonConfigSLA} [SLA] -
 * @property {string[]} [AlarmActions] -
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
 * @typedef Column
 * @property {string} name -
 * @property {string} type -
 * @property {string} [comment] -
 */

/**
 * @typedef SerdeInfo
 * @property {string} SerializationLibrary -
 * @property {Object<string,string>} Parameters -
 */

/**
 * @typedef TableProperties
 * @property {string} catalogId -
 * @property {Column[]} columns -
 * @property {boolean} compressed -
 * @property {string} databaseName -
 * @property {string} [description] -
 * @property {string} name -
 * @property {number} numberOfBuckets -
 * @property {Object<string,string>} parameters -
 * @property {string} region -
 * @property {boolean} storedAsSubDirectories -
 * @property {string} tableType -
 * @property {Object<string,string>} tags -
 * @property {string} [location] -
 * @property {Column[]} [partitionKeys] -
 * @property {string} [viewExpandedText] -
 * @property {string} [viewOriginalText] -
 * @property {string} [inputFormat] -
 * @property {string} [outputFormat] -
 * @property {SerdeInfo} [serdeInfo] -
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
 * @property {string} arn - S3 arn
 */

/**
 * @typedef LocationRecord
 * @property {string} location - location of the wharfie input
 * @property {string} resource_id -
 * @property {string} interval - interval to deduplicate and process s3 events
 */

/**
 * @typedef DependencyRecord
 * @property {string} dependency - upstream dependency db name + table name
 * @property {string} resource_id - id of the wharfie resource that has the associated dependency
 * @property {string} interval - interval to deduplicate and process wharfie events
 */

/**
 * @typedef Definition
 * @property {string} sort_key -
 * @property {string} queue_arn -
 * @property {string} queue_url -
 * @property {string} dlq_arn -
 * @property {string} dlq_url -
 * @property {string} lambda_arn -
 * @property {string} code_hash -
 */

/**
 * @typedef ActionDefinitionRecord
 * @property {string} action_type -
 * @property {string} queue_arn -
 * @property {string} queue_url -
 * @property {string} dlq_arn -
 * @property {string} dlq_url -
 * @property {string} lambda_arn -
 * @property {string} code_hash -
 */

/**
 * @typedef QueryDefinitionRecord
 * @property {string} query_type -
 * @property {string} queue_arn -
 * @property {string} queue_url -
 * @property {string} dlq_arn -
 * @property {string} dlq_url -
 * @property {string} lambda_arn -
 * @property {string} code_hash -
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
 * @typedef SideEffect
 * @property {string} type -
 * @property {('onChange')} trigger -
 * @property {Object<string,any>} config -
 */

export default () => {};
