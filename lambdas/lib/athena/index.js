import {
  Athena as _Athena,
  GetWorkGroupCommand,
  CreateWorkGroupCommand,
  UpdateWorkGroupCommand,
  DeleteWorkGroupCommand,
  StartQueryExecutionCommand,
  BatchGetQueryExecutionCommand,
  GetQueryExecutionCommand,
  paginateGetQueryResults,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
} from '@aws-sdk/client-athena';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import Glue from '../glue.js';
import BaseAWS from '../base.js';
import QueryParser from './query-parser.js';

class Athena {
  /**
   * @param {import("@aws-sdk/client-athena").AthenaClientConfig | import("@aws-sdk/client-glue").GlueClientConfig} options - Athena|Glue SDK options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.athena = new _Athena({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
    this.glue = new Glue(options);
    this.parser = new QueryParser();
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

  /**
   * @param {import("@aws-sdk/client-athena").GetWorkGroupInput} params -
   * @returns {Promise<import("@aws-sdk/client-athena").GetWorkGroupOutput>} -
   */
  async getWorkGroup(params) {
    return await this.athena.send(new GetWorkGroupCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").CreateWorkGroupCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-athena").CreateWorkGroupCommandOutput>} -
   */
  async createWorkGroup(params) {
    return await this.athena.send(new CreateWorkGroupCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").UpdateWorkGroupCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-athena").UpdateWorkGroupCommandOutput>} -
   */
  async updateWorkGroup(params) {
    return await this.athena.send(new UpdateWorkGroupCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").DeleteWorkGroupCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-athena").DeleteWorkGroupCommandOutput>} -
   */
  async deleteWorkGroup(params) {
    return await this.athena.send(new DeleteWorkGroupCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").StartQueryExecutionInput} params - Athena StartQueryExecution parameters
   * @returns {Promise<import("@aws-sdk/client-athena").StartQueryExecutionOutput>} - Athena StartQueryExecution result
   */
  async startQueryExecution(params) {
    return await this.athena.send(new StartQueryExecutionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").BatchGetQueryExecutionInput} params - Athena BatchGetQueryExecution parameters
   * @returns {Promise<import("@aws-sdk/client-athena").BatchGetQueryExecutionOutput>} - Athena BatchGetQueryExecution result
   */
  async batchGetQueryExecution(params) {
    return await this.athena.send(new BatchGetQueryExecutionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").GetQueryExecutionInput} params - Athena GetQueryExecution parameters
   * @returns {Promise<import("@aws-sdk/client-athena").GetQueryExecutionOutput>} - Athena GetQueryExecution result
   */
  async getQueryExecution(params) {
    return await this.athena.send(new GetQueryExecutionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").GetQueryResultsInput} params - Athena GetQueryResults parameters
   * @returns {Promise<Object<string, any>[]>} -
   */
  async getQueryResults(params) {
    const paginator = paginateGetQueryResults(
      {
        client: this.athena,
      },
      params,
    );
    /** @type {Object<string, any>[]} */
    const results = [];
    for await (const page of paginator) {
      // page contains a single paginated output.
      Athena.repackQueryResult(page).forEach(
        (/** @type {Object<string, any>} */ record) => results.push(record),
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
        'missing required fields for repacking athena query result',
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
            `no TableList for Database: ${QueryExecution.QueryExecutionContext.Database}`,
          );
        TableList.map(({ Name }) =>
          validTopLevelTableNames.add((Name || '').replace(/['"]+/g, '')),
        );
      } catch (err) {
        console.error(
          `Ignoring references to relative tables because of the following error ${
            // @ts-ignore
            err.stack || err
          }`,
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
              '',
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

  /**
   * @param {import("@aws-sdk/client-athena").ListTagsForResourceCommandInput} params - Athena ListTagsForResource parameters
   * @returns {Promise<import("@aws-sdk/client-athena").ListTagsForResourceCommandOutput>} - Athena ListTagsForResource result
   */
  async listTagsForResource(params) {
    const returnTags = [];
    let { Tags, NextToken, $metadata } = await this.athena.send(
      new ListTagsForResourceCommand(params),
    );
    if (Tags) returnTags.push(...Tags);

    while (NextToken) {
      const { Tags: nextTags, NextToken: nextNextToken } =
        await this.athena.send(
          new ListTagsForResourceCommand({ ...params, NextToken }),
        );
      if (nextTags) returnTags.push(...nextTags);
      NextToken = nextNextToken;
    }
    return { Tags: returnTags, $metadata };
  }

  /**
   * @param {import("@aws-sdk/client-athena").TagResourceCommandInput} params - Athena tagResource parameters
   * @returns {Promise<import("@aws-sdk/client-athena").TagResourceCommandOutput>} - Athena tagResource result
   */
  async tagResource(params) {
    return await this.athena.send(new TagResourceCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-athena").UntagResourceCommandInput} params - Athena tagResource parameters
   * @returns {Promise<import("@aws-sdk/client-athena").UntagResourceCommandOutput>} - Athena tagResource result
   */
  async untagResource(params) {
    return await this.athena.send(new UntagResourceCommand(params));
  }
}

export default Athena;
