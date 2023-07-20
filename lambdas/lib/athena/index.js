/* eslint-disable new-cap */
'use strict';
const AWS = require('@aws-sdk/client-athena');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
/** @type {any} */
const antlr4 = require('antlr4');
const Glue = require('../glue');
const BaseAWS = require('../base');

// @ts-ignore
/** @type {any} */
const athenasqlLexer = require('./antlr-lib/athenasqlLexer.js');
// @ts-ignore
/** @type {any} */
const athenasqlParser = require('./antlr-lib/athenasqlParser.js');
// @ts-ignore
/** @type {any} */
const athenasqlListener = require('./antlr-lib/athenasqlListener.js');

class Athena {
  /**
   * @param {import("@aws-sdk/client-athena").AthenaClientConfig | import("@aws-sdk/client-glue").GlueClientConfig} options - Athena|Glue SDK options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.athena = new AWS.Athena({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
    this.glue = new Glue(options);
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

  /**
   * @param {import("@aws-sdk/client-athena").GetWorkGroupInput} params -
   * @returns {Promise<import("@aws-sdk/client-athena").GetWorkGroupOutput>} -
   */
  async getWorkGroup(params) {
    return await this.athena.send(new AWS.GetWorkGroupCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").StartQueryExecutionInput} params - Athena StartQueryExecution parameters
   * @returns {Promise<import("@aws-sdk/client-athena").StartQueryExecutionOutput>} - Athena StartQueryExecution result
   */
  async startQueryExecution(params) {
    return await this.athena.send(new AWS.StartQueryExecutionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").BatchGetQueryExecutionInput} params - Athena BatchGetQueryExecution parameters
   * @returns {Promise<import("@aws-sdk/client-athena").BatchGetQueryExecutionOutput>} - Athena BatchGetQueryExecution result
   */
  async batchGetQueryExecution(params) {
    return await this.athena.send(
      new AWS.BatchGetQueryExecutionCommand(params)
    );
  }

  /**
   * @param {import("@aws-sdk/client-athena").GetQueryExecutionInput} params - Athena GetQueryExecution parameters
   * @returns {Promise<import("@aws-sdk/client-athena").GetQueryExecutionOutput>} - Athena GetQueryExecution result
   */
  async getQueryExecution(params) {
    return await this.athena.send(new AWS.GetQueryExecutionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").GetQueryResultsInput} params - Athena GetQueryResults parameters
   * @returns {Promise<Object<string, any>[]>} -
   */
  async getQueryResults(params) {
    const paginator = AWS.paginateGetQueryResults(
      {
        client: this.athena,
      },
      params
    );
    /** @type {Object<string, any>[]} */
    const results = [];
    for await (const page of paginator) {
      // page contains a single paginated output.
      Athena.repackQueryResult(page).forEach(
        (/** @type {Object<string, any>} */ record) => results.push(record)
      );
    }
    return results;
  }

  /**
   * @param {import("@aws-sdk/client-athena").GetQueryResultsOutput} data -
   * @returns {Object<string, any>} - query result
   */
  static repackQueryResult(data) {
    if (
      !data.ResultSet ||
      !data.ResultSet.ResultSetMetadata ||
      !data.ResultSet.ResultSetMetadata.ColumnInfo ||
      !data.ResultSet.Rows
    )
      throw new Error(
        'missing required fields for repacking athena query result'
      );
    const columns = data.ResultSet.ResultSetMetadata.ColumnInfo;
    const hasColumns = columns.length > 0;
    const keys = columns.map((c) => c.Name);
    const types = columns.map((c) => c.Type);

    const rows = hasColumns
      ? data.ResultSet.Rows.slice(1)
      : data.ResultSet.Rows;

    return rows.map((row) => {
      if (!hasColumns) return (row.Data || [])[0].VarCharValue;

      const values = (row.Data || []).map((v) => v.VarCharValue);
      /** @type {Object<string, any>} */
      const record = {};

      values.forEach((value, i) => {
        if (typeof value === 'undefined') return (record[keys[i] || 0] = null);

        record[keys[i] || 0] = (() => {
          switch (types[i]) {
            case 'varchar':
              return value;
            case 'bigint':
            case 'smallint':
            case 'float':
            case 'double':
            case 'integer':
              return Number(value);
            case 'array':
              return value.slice(1, -1).split(/, ?/);
            case 'timestamp':
              return new Date(`${value}Z`);
            case 'boolean':
              return value === 'true';
            case 'map':
              return value
                .slice(1, -1)
                .split(/, ?/)
                .reduce((/** @type {Object<string, any>} */ final, val) => {
                  const [key, value] = val.split('=');
                  final[key] = value;
                  return final;
                }, {});
            default:
              return value;
          }
        })();
      });

      return record;
    });
  }

  /**
   * @typedef reference
   * @property {string} DatabaseName - database name
   * @property {string} TableName - table name
   * @typedef queryMetrics
   * @property {Array<reference>} References -
   * @property {import("@aws-sdk/client-athena").QueryExecutionStatistics | undefined} Statistics -
   * @param {string} queryExecutionId -
   * @returns {Promise<queryMetrics>} -
   */
  async getQueryMetrics(queryExecutionId) {
    const { QueryExecution } = await this.getQueryExecution({
      QueryExecutionId: queryExecutionId,
    });

    const validTopLevelTableNames = new Set();
    if (
      QueryExecution &&
      QueryExecution.QueryExecutionContext &&
      QueryExecution.QueryExecutionContext.Database
    ) {
      try {
        const { TableList } = await this.glue.getTables({
          DatabaseName: QueryExecution.QueryExecutionContext.Database,
        });
        if (!TableList)
          throw new Error(
            `no TableList for Database: ${QueryExecution.QueryExecutionContext.Database}`
          );
        TableList.map(({ Name }) =>
          validTopLevelTableNames.add((Name || '').replace(/['"]+/g, ''))
        );
      } catch (err) {
        console.error(
          `Ignoring references to relative tables because of the following error ${
            // @ts-ignore
            err.stack || err
          }`
        );
      }
    }

    const queryTableReferences =
      QueryExecution &&
      QueryExecution.Query &&
      QueryExecution.Query.length <= 3000 &&
      this.extractSources(QueryExecution.Query).sources;

    const references =
      queryTableReferences &&
      queryTableReferences.map(({ TableName, DatabaseName }) => {
        if (
          !DatabaseName &&
          validTopLevelTableNames.has(TableName) &&
          QueryExecution &&
          QueryExecution.QueryExecutionContext &&
          QueryExecution.QueryExecutionContext.Database
        ) {
          return {
            TableName,
            DatabaseName: QueryExecution.QueryExecutionContext.Database.replace(
              /['"]+/g,
              ''
            ),
          };
        }
        return { TableName, DatabaseName };
      });

    return {
      References: [...(references || [])],
      Statistics: QueryExecution && QueryExecution.Statistics,
    };
  }
}

module.exports = Athena;
