'use strict';
const crypto = require('crypto');

const { InvalidRequestException } = jest.requireActual(
  '@aws-sdk/client-athena'
);
const { createId } = require('../../../lambdas/lib/id');
const SQS = require('./sqs');
const QueryRunner = require('./query-runner');

const ATHENA_EVENT_TEMPLATE = {
  version: '1.0',
  id: 'athenaNotification',
  'detail-type': 'athena:queryExecution',
  source: 'aws.athena',
  account: '123456789012',
  time: '2018-01-01T00:00:00Z',
  region: 'us-east-1',
  resources: [],
  detail: {},
};

class AthenaMock {
  constructor() {
    this.__sqs = new SQS();
    this.__queryRunner = new QueryRunner();
    AthenaMock.__state.queryMockSideEffects = {};
  }

  __setMockState(
    athenaState = {
      workgroups: {},
      notificationQueue: new SQS(),
      queryMocks: {},
      queryMockSideEffects: {},
      tags: {},
    }
  ) {
    AthenaMock.__state = athenaState;
  }

  __getMockState() {
    return AthenaMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'GetWorkGroupCommand':
        return await this.getWorkGroup(command.input);
      case 'CreateWorkGroupCommand':
        return await this.createWorkGroup(command.input);
      case 'UpdateWorkGroupCommand':
        return await this.updateWorkGroup(command.input);
      case 'DeleteWorkGroupCommand':
        return await this.deleteWorkGroup(command.input);
      case 'StartQueryExecutionCommand':
        return await this.startQueryExecution(command.input);
      case 'GetQueryExecutionCommand':
        return await this.getQueryExecution(command.input);
      case 'BatchGetQueryExecutionCommand':
        return await this.batchGetQueryExecution(command.input);
      case 'GetQueryResultsCommand':
        return await this.getQueryResults(command.input);
      case 'ListTagsForResourceCommand':
        return await this.ListTagsForResource(command.input);
      case 'TagResourceCommand':
        return await this.TagResource(command.input);
      case 'UntagResourceCommand':
        return await this.UntagResource(command.input);
    }
  }

  async UntagResource(params) {
    if (!AthenaMock.__state.tags[params.ResourceARN]) return;
    const keySet = new Set(params.TagKeys);
    AthenaMock.__state.tags[params.ResourceARN] = AthenaMock.__state.tags[
      params.ResourceARN
    ].filter((tag) => !keySet.has(tag.Key));
  }

  async TagResource(params) {
    if (!AthenaMock.__state.tags[params.ResourceARN])
      AthenaMock.__state.tags[params.ResourceARN] = {};
    params.Tags.forEach((tag) => {
      AthenaMock.__state.tags[params.ResourceARN][tag.Key] = tag.Value;
    });
  }

  async ListTagsForResource(params) {
    if (!AthenaMock.__state.tags[params.ResourceARN]) return [];

    return Object.keys(AthenaMock.__state.tags[params.ResourceARN]).map(
      (tagKey) => {
        return {
          Key: tagKey,
          Value: AthenaMock.__state.tags[params.ResourceARN][tagKey],
        };
      }
    );
  }

  async getWorkGroup(params) {
    if (!AthenaMock.__state.workgroups[params.WorkGroup])
      throw new InvalidRequestException({
        message: `workgroup: ${params.WorkGroup} does not exist`,
      });
    return AthenaMock.__state.workgroups[params.WorkGroup];
  }

  async deleteWorkGroup(params) {
    if (!AthenaMock.__state.workgroups[params.WorkGroup])
      throw new InvalidRequestException({
        message: `workgroup: ${params.WorkGroup} does not exist`,
      });

    delete AthenaMock.__state.workgroups[params.WorkGroup];
  }

  async createWorkGroup(params) {
    if (AthenaMock.__state.workgroups[params.Name])
      throw new InvalidRequestException({
        message: `workgroup: ${params.WorkGroup} already exists`,
      });

    AthenaMock.__state.workgroups[params.Name] = {
      ...params,
      queries: {},
    };
    return AthenaMock.__state.workgroups[params.WorkGroup];
  }

  async updateWorkGroup(params) {
    if (!AthenaMock.__state.workgroups[params.WorkGroup])
      throw new InvalidRequestException({
        message: `workgroup: ${params.WorkGroup} does not exist`,
      });

    if (params.ConfigurationUpdates?.ResultConfigurationUpdates) {
      AthenaMock.__state.workgroups[
        params.WorkGroup
      ].Configuration.ResultConfiguration = {
        ...AthenaMock.__state.workgroups[params.WorkGroup].Configuration
          .ResultConfiguration,
        ...params.ConfigurationUpdates.ResultConfigurationUpdates,
      };
    }
    if (params?.Description) {
      AthenaMock.__state.workgroups[params.WorkGroup].Description =
        params.Description;
    }
    if (params?.State) {
      AthenaMock.__state.workgroups[params.WorkGroup].State = params.State;
    }
  }

  // EXPERIMENTAL
  _addQueryMockSideEffect(queryString, sideEffect, output) {
    if (!AthenaMock.__state.queryMockSideEffects)
      AthenaMock.__state.queryMockSideEffects = {};
    const SQLHash = crypto
      .createHash('md5')
      .update(queryString.replace(/\s/g, ''))
      .digest('hex');
    AthenaMock.__state.queryMockSideEffects[SQLHash] = {
      sideEffect,
      output,
    };
  }

  async startQueryExecution(params) {
    const workgroup = params.WorkGroup || 'default';
    if (!AthenaMock.__state.workgroups[workgroup])
      throw new InvalidRequestException({
        message: `workgroup: ${params.WorkGroup} does not exist`,
      });

    const QueryExecutionId = createId();
    AthenaMock.__state.workgroups[workgroup].queries[QueryExecutionId] = {
      Status: {
        State: 'QUEUED',
      },
      ...params,
    };

    await new Promise((resolve) => setTimeout(resolve, 5));

    this.__sqs.sendMessage({
      QueueUrl: process.env.MONITOR_QUEUE_URL,
      MessageBody: JSON.stringify({
        ...ATHENA_EVENT_TEMPLATE,
        detail: {
          queryExecutionId: QueryExecutionId,
          currentState: 'RUNNING',
          previousState: 'QUEUED',
          workgroupName: workgroup,
          statementType: 'MockedQuery',
        },
      }),
    });
    AthenaMock.__state.workgroups[workgroup].queries[
      QueryExecutionId
    ].Status.State = 'RUNNING';

    await new Promise((resolve) => setTimeout(resolve, 5));
    const SQLHash = crypto
      .createHash('md5')
      .update(params.QueryString.replace(/\s/g, ''))
      .digest('hex');
    try {
      await this.__queryRunner.runQuery(QueryExecutionId, params.QueryString);
      if (AthenaMock.__state.queryMockSideEffects[SQLHash]) {
        await AthenaMock.__state.queryMockSideEffects[SQLHash].sideEffect();
      }
      this.__sqs.sendMessage({
        QueueUrl: process.env.MONITOR_QUEUE_URL,
        MessageBody: JSON.stringify({
          ...ATHENA_EVENT_TEMPLATE,
          detail: {
            queryExecutionId: QueryExecutionId,
            currentState: 'SUCCEEDED',
            previousState: 'RUNNING',
            workgroupName: workgroup,
            statementType: 'MockedQuery',
          },
        }),
      });
      AthenaMock.__state.workgroups[workgroup].queries[
        QueryExecutionId
      ].Status.State = 'SUCCEEDED';
    } catch (err) {
      this.__sqs.sendMessage({
        QueueUrl: process.env.MONITOR_QUEUE_URL,
        MessageBody: JSON.stringify({
          ...ATHENA_EVENT_TEMPLATE,
          detail: {
            queryExecutionId: QueryExecutionId,
            currentState: 'FAILED',
            previousState: 'RUNNING',
            workgroupName: workgroup,
            statementType: 'MockedQuery',
          },
        }),
      });
      AthenaMock.__state.workgroups[workgroup].queries[
        QueryExecutionId
      ].Status.State = 'FAILED';
    }

    return {
      QueryExecutionId,
    };
  }

  async getQueryExecution(params) {
    let _return = null;
    Object.keys(AthenaMock.__state.workgroups).map(async (workgroupKeys) => {
      if (
        AthenaMock.__state.workgroups[workgroupKeys].queries[
          params.QueryExecutionId
        ]
      )
        _return = {
          QueryExecution: {
            QueryExecutionId: params.QueryExecutionId,
            Query:
              AthenaMock.__state.workgroups[workgroupKeys].queries[
                params.QueryExecutionId
              ].QueryString,
            Status:
              AthenaMock.__state.workgroups[workgroupKeys].queries[
                params.QueryExecutionId
              ].Status,
            WorkGroup: workgroupKeys,
          },
        };
    });
    if (!_return) throw new Error('query does not exist');
    return _return;
  }

  async batchGetQueryExecution(params) {
    const QueryExecutions = await Promise.all(
      params.QueryExecutionIds.map(
        async (QueryExecutionId) =>
          await this.getQueryExecution({
            QueryExecutionId,
          })
      )
    );
    return {
      QueryExecutions,
    };
  }

  static async *paginateGetQueryResults(paginateConfig, params) {
    const {
      QueryExecution: { Query, Status },
    } = await paginateConfig.client.getQueryExecution({
      QueryExecutionId: params.QueryExecutionId,
    });
    if (Status.State !== 'SUCCEEDED') throw new Error("query isn't done");

    const SQLHash = crypto
      .createHash('md5')
      .update(Query.replace(/\s/g, ''))
      .digest('hex');

    const output = (
      AthenaMock.__state.queryMockSideEffects?.[SQLHash]?.output || ''
    ).split('\n');

    const columnInfo = (output[0] || '').split(',').map((columnName) => ({
      Name: columnName,
      Type: 'varchar',
    }));

    const rows = output.map((row) => ({
      Data: row.split(',').map((cell) => ({ VarCharValue: cell })),
    }));

    yield {
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: columnInfo,
        },
        Rows: rows,
      },
    };
  }

  async getQueryResults(params) {
    const {
      QueryExecution: { Query, Status },
    } = await this.getQueryExecution({
      QueryExecutionId: params.QueryExecutionId,
    });
    if (Status.State !== 'SUCCEEDED') throw new Error("query isn't done");

    const SQLHash = crypto
      .createHash('md5')
      .update(Query.replace(/\s/g, ''))
      .digest('hex');

    const output = (
      AthenaMock.__state.queryMockSideEffects?.[SQLHash]?.output || ''
    ).split('\n');

    const columnInfo = (output[0] || '').split(',').map((columnName) => ({
      Name: columnName,
      Type: 'varchar',
    }));

    const rows = output.map((row) => ({
      Data: row.split(',').map((cell) => ({ VarCharValue: cell })),
    }));

    let pageCalls = 0;
    const pages = [
      {
        ResultSet: {
          ResultSetMetadata: {
            ColumnInfo: columnInfo,
          },
          Rows: rows,
        },
      },
    ];
    return {
      eachPage: function eachPage(callback) {
        pageCalls++;
        if (pageCalls - 1 < pages.length) {
          callback(null, pages[pageCalls - 1], () => {
            eachPage(callback);
          });
        } else {
          callback(null, null, () => {
            eachPage(callback);
          });
        }
      },
    };
  }
}

AthenaMock.__state = {
  workgroups: {},
  notificationQueue: new SQS(),
  queryMocks: {},
  queryMockSideEffects: {},
  tags: {},
};

module.exports = AthenaMock;
