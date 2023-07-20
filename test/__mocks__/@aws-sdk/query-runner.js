/* eslint-disable new-cap */
'use strict';
const S3 = require('./s3');
const Glue = require('./glue');
const SQS = require('./sqs');
jest.mock('../../../lambdas/lib/dynamo/resource');

/** @type {any} */
const antlr4 = require('antlr4');
const dynamo_resource = require('../../../lambdas/lib/dynamo/resource');

// @ts-ignore
/** @type {any} */
const athenasqlLexer = require('../../../lambdas/lib/athena/antlr-lib/athenasqlLexer.js');
// @ts-ignore
/** @type {any} */
const athenasqlParser = require('../../../lambdas/lib/athena/antlr-lib/athenasqlParser.js');
// @ts-ignore
/** @type {any} */
const athenasqlListener = require('../../../lambdas/lib/athena/antlr-lib/athenasqlListener.js');

class QueryRunner {
  constructor() {
    this.s3 = new S3();
    this.glue = new Glue();
    this.sqs = new SQS();
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
      const resources_state = dynamo_resource.__getMockState();
      const action =
        resources_state[query_event.resource_id][
          `${query_event.resource_id}#${query_event.operation_id}#${query_event.action_id}`
        ];
      const query =
        resources_state[query_event.resource_id][
          `${query_event.resource_id}#${query_event.operation_id}#${query_event.action_id}#${query_event.query_id}`
        ];
      const operation =
        resources_state[query_event.resource_id][
          `${query_event.resource_id}#${query_event.operation_id}`
        ];
      const resource =
        resources_state[query_event.resource_id][`${query_event.resource_id}`];

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
   * @param {import('../../../lambdas/typedefs').ResourceRecord} resource -
   * @param {import('../../../lambdas/typedefs').OperationRecord} operation -
   * @param {import('../../../lambdas/typedefs').ActionRecord} _action -
   * @param {import('../../../lambdas/typedefs').QueryRecord} _query -
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
    if (operation.operation_inputs?.partition) {
      const { bucket, prefix } = this.s3._parseS3Uri(
        resource.destination_properties.TableInput.StorageDescriptor.Location
      );
      const location_segments =
        resource.destination_properties.TableInput.StorageDescriptor.Location.split(
          '/'
        );
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
    const stream = new antlr4.CharStreams.fromString(query);
    const lexer = new athenasqlLexer(stream);
    const tokens = new antlr4.CommonTokenStream(lexer);
    /** @type {any} */
    const parser = new athenasqlParser(tokens);
    parser.buildParseTrees = true;
    const tree = parser.program();
    const printer = new athenasqlListener();
    antlr4.tree.ParseTreeWalker.DEFAULT.walk(printer, tree);

    return {
      sources: [
        ...[...printer.tables].reduce((acc, t) => {
          const [database, table] = t.split('.');
          if (!table) {
            acc.add({
              DatabaseName: '',
              TableName: database.replace(/['"]+/g, ''),
            });
          } else if (table && database) {
            acc.add({
              DatabaseName: database.replace(/['"]+/g, ''),
              TableName: table.replace(/['"]+/g, ''),
            });
          }
          return acc;
        }, new Set()),
      ],
      columns: [...printer.columns],
      selectAsColumns: printer.selectedAsColumns,
    };
  }
}

module.exports = QueryRunner;
