/**
 * @typedef OperationRecordData
 * @property {string} resource_id - Id of the app resource.
 * @property {number} resource_version - Version of the app resource.
 * @property {string} id - Id of the operation.
 * @property {import('./operation.js').WharfieOperationTypeEnum} type - Type of operation.
 * @property {import('./operation.js').WharfieOperationStatusEnum} status - Status of operation.
 * @property {string} serialized_action_graph - Serialized action dependency graph.
 * @property {any} [operation_config] - Configuration for the operation.
 * @property {any} [operation_inputs] - Inputs for the operation.
 * @property {number} started_at - Start timestamp.
 * @property {number} last_updated_at - Last update timestamp.
 * @property {string} wharfie_version - Version of Wharfie.
 * @property {'OPERATION'} record_type - Record type.
 */

/**
 * @typedef OperationRecord
 * @property {string} resource_id - Id of the app resource.
 * @property {string} sort_key - Sort key for the operation.
 * @property {OperationRecordData} data - Persisted operation data.
 */

/**
 * @typedef ActionRecordData
 * @property {string} resource_id - Id of the app resource.
 * @property {string} operation_id - Id of the operation.
 * @property {string} id - Id of the action.
 * @property {import('./action.js').WharfieActionTypeEnum} type - Type of action.
 * @property {import('./action.js').WharfieActionStatusEnum} status - Status of the action.
 * @property {string} [function_name] - Function invoked by the action.
 * @property {any} [inputs] - Invocation inputs.
 * @property {Record<string, any>} [placement] - Placement hints.
 * @property {Record<string, any>} [retry] - Retry metadata.
 * @property {any} [error] - Persisted execution error.
 * @property {number} [attempt_count] - Number of execution attempts.
 * @property {any} [outputs] - Persisted execution outputs.
 * @property {number} started_at - Start timestamp.
 * @property {number} last_updated_at - Last update timestamp.
 * @property {string} wharfie_version - Version of Wharfie.
 * @property {'ACTION'} record_type - Record type.
 */

/**
 * @typedef ActionRecord
 * @property {string} resource_id - Id of the app resource.
 * @property {string} sort_key - Sort key for the action.
 * @property {ActionRecordData} data - Persisted action data.
 */

export {};
