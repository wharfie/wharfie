/* eslint-disable new-cap */
import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S3 = require('./s3');
const Glue = require('./glue');
const SQS = require('./sqs');
jest.mock('../../../lambdas/lib/dynamo/operations');
const QueryParser = jest.requireActual(
  '../../../lambdas/lib/athena/query-parser'
);
const dynamo_resource = require('../../../lambdas/lib/dynamo/operations');

class QueryRunner {
  constructor() {
    this.s3 = new S3();
    this.glue = new Glue();
    this.sqs = new SQS();
    this.parser = new QueryParser();
  }

  /**
   * @param {string} query_execution_id -
   * @param {string} query_string -
   */
  async runQuery(query_execution_id, query_string) {
    try {
      // wharfie query
      const query_event = JSON.parse(
        query_string.split('\n').slice(-1)[0].substring(3)
      );
      const action = await dynamo_resource.getAction(
        query_event.resource_id,
        query_event.operation_id,
        query_event.action_id
      );
      const query = await dynamo_resource.getQuery(
        query_event.resource_id,
        query_event.operation_id,
        query_event.action_id,
        query_event.query_id
      );
      const operation = await dynamo_resource.getOperation(
        query_event.resource_id,
        query_event.operation_id
      );
      const resource = await dynamo_resource.getResource(
        query_event.resource_id
      );
      switch (query_event.action_type) {
        case 'RUN_SINGLE_COMPACTION':
          this._run_single_compaction_side_effects(
            query_execution_id,
            query_string,
            resource,
            operation,
            action,
            query
          );
          break;
        default:
          throw new Error(`No query for type ${query_event.action_type}`);
      }
    } catch (e) {
      // not a wharfie query
    }
  }

  /**
   * @param {string} query_execution_id -
   * @param {string} query_string -
   * @param {import('../../../lambdas/lib/graph/').Resource} resource -
   * @param {import('../../../lambdas/lib/graph/').Operation} operation -
   * @param {import('../../../lambdas/lib/graph/').Action} _action -
   * @param {import('../../../lambdas/lib/graph/').Query} _query -
   */
  async _run_single_compaction_side_effects(
    query_execution_id,
    query_string,
    resource,
    operation,
    // eslint-disable-next-line no-unused-vars
    _action,
    // eslint-disable-next-line no-unused-vars
    _query
  ) {
    if (operation?.operation_inputs?.partition) {
      const { bucket, prefix } = this.s3._parseS3Uri(
        resource.destination_properties.location
      );
      const location_segments = (
        resource?.destination_properties?.location || ''
      ).split('/');
      const base_location = location_segments
        .slice(0, location_segments.length - 2)
        .join('/');

      // eslint-disable-next-line no-unused-vars
      const { bucket: _bucket, prefix: manifest_key } = this.s3._parseS3Uri(
        `${base_location}/query_metadata/${query_execution_id}-manifest.csv`
      );
      const partition_path = Object.keys(
        operation.operation_inputs?.partition.partitionValues
      )
        .map(
          (key) =>
            `${key}=${operation.operation_inputs?.partition.partitionValues[key]}`
        )
        .join('/');

      // TODO: this is very britle, need to get the table name from the query
      const temp_table_name = query_string
        .split(' ')[4]
        .split('.')[1]
        .trim()
        .replace(/"/g, '');

      const output_params = {
        Bucket: bucket,
        Key: `${prefix}${partition_path}/${query_execution_id}-data`,
        Body: JSON.stringify({ foo: 'bar' }),
      };
      // output datafile
      await this.s3.putObject(output_params);
      // output manifest
      await this.s3.putObject({
        Bucket: bucket,
        Key: manifest_key,
        Body: `s3://${output_params.Bucket}/${output_params.Key}`,
      });
      const { Partitions: existing_partitions } = await this.glue.getPartitions(
        {
          DatabaseName: process.env.TEMPORARY_GLUE_DATABASE,
          TableName: temp_table_name,
        }
      );
      const partitionExists = existing_partitions.find((partition) => {
        return Object.keys(partition.Values).every((key) => {
          return (
            partition.Values[key] ===
            operation.operation_inputs?.partition.partitionValues[key]
          );
        });
      });
      if (partitionExists) {
        await this.glue.updatePartition({
          DatabaseName: process.env.TEMPORARY_GLUE_DATABASE,
          TableName: temp_table_name,
          PartitionInput: {
            Values: Object.values(
              operation.operation_inputs?.partition.partitionValues
            ),
            StorageDescriptor: {
              Location: `s3://${bucket}/${prefix}${partition_path}/`,
            },
          },
        });
      } else {
        await this.glue.createPartition({
          DatabaseName: process.env.TEMPORARY_GLUE_DATABASE,
          TableName: temp_table_name,
          PartitionInput: {
            Values: Object.values(
              operation.operation_inputs?.partition.partitionValues
            ),
            StorageDescriptor: {
              Location: `s3://${bucket}/${prefix}${partition_path}/`,
            },
          },
        });
      }
    }
  }

  /**
   * @typedef ColumnSelection
   * @property {string} identifier -
   * @property {Set<string>} columns -
   */

  /**
   * @typedef ExtractSourcesReturn
   * @property {Array<{DatabaseName: string, TableName: string}>} sources -
   * @property {Array<string>} columns -
   * @property {Array<ColumnSelection>} selectAsColumns -
   */

  /**
   * @param {string} query - query to evaluate
   * @returns {ExtractSourcesReturn} -
   */
  extractSources(query) {
    return this.parser.extractSources(query);
  }
}

module.exports = QueryRunner;
