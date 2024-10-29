/**
 * @typedef ResourceRecordData
 * @property {string} id - Id of the resource
 * @property {import('./resource').WharfieResourceStatusEnum} status - status of the resource
 * @property {string} region - aws region of the resource
 * @property {string} [source_region] - aws region of the source data, not set for models
 * @property {string} athena_workgroup - name of the stack's athena workgroup
 * @property {import('../../typedefs').DaemonConfig} daemon_config -
 * @property {import('../actor/resources/wharfie-resource').WharfieResourceProperties & import('../actor/typedefs').SharedProperties} resource_properties -
 * @property {import('../../typedefs').TableProperties} source_properties -
 * @property {import('../../typedefs').TableProperties} destination_properties -
 * @property {number} created_at - created timestamp
 * @property {number} last_updated_at - update_at_timestamp
 * @property {string} wharfie_version - version of wharfie
 * @property {'RESOURCE'} record_type -
 */

/**
 * @typedef ResourceRecord
 * @property {string} resource_id - Id of the resource
 * @property {string} sort_key - sort key for the query
 * @property {ResourceRecordData} data -
 */

/**
 * @typedef OperationRecordData
 * @property {string} resource_id - Id of the resource
 * @property {string} id - Id of the operation
 * @property {import('./operation').WharfieOperationTypeEnum} type - type of operation
 * @property {import('./operation').WharfieOperationStatusEnum} status - status of operation
 * @property {string} serialized_action_graph - serialized action dependency graph
 * @property {any} [operation_config] - configuration Blob for the operation
 * @property {any} [operation_inputs] - Input Blob for the operation
 * @property {number} started_at - started_at
 * @property {number} last_updated_at - update_at_timestamp
 * @property {string} wharfie_version - version of wharfie
 * @property {'OPERATION'} record_type -
 */

/**
 * @typedef OperationRecord
 * @property {string} resource_id - Id of the resource
 * @property {string} sort_key - sort key for the query
 * @property {OperationRecordData} data -
 */

/**
 * @typedef ActionRecordData
 * @property {string} resource_id - Id of the resource
 * @property {string} operation_id - Id of the operation
 * @property {string} id - Id of the action
 * @property {import('./action').WharfieActionTypeEnum} type - type of action
 * @property {import('./action').WharfieActionStatusEnum} status - status of the action
 * @property {number} started_at - started_at
 * @property {number} last_updated_at - update_at_timestamp
 * @property {string} wharfie_version - version of wharfie
 * @property {'ACTION'} record_type -
 */

/**
 * @typedef ActionRecord
 * @property {string} resource_id - Id of the resource
 * @property {string} sort_key - sort key for the action
 * @property {ActionRecordData} data -
 */

/**
 * @typedef QueryRecordData
 * @property {string} resource_id - Id of the resource
 * @property {string} operation_id - Id of the operation
 * @property {string} action_id - Id of the action
 * @property {string} id - Id of the query
 * @property {string} [execution_id] - Athena execution id
 * @property {import('./query').QueryStatusEnum} status - status of the query
 * @property {any} query_data - query metadata, used by actions
 * @property {string} [query_string] - query string used by query
 * @property {number} started_at - started_at
 * @property {number} last_updated_at - update_at_timestamp
 * @property {string} wharfie_version - version of wharfie
 * @property {'QUERY'} record_type -
 */

/**
 * @typedef QueryRecord
 * @property {string} resource_id - Id of the resource
 * @property {string} sort_key - sort key for the query
 * @property {QueryRecordData} data -
 */

exports.unused = {};
