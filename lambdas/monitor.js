'use strict';
require('./config');
const { parse } = require('@sandfox/arn');
const bluebirdPromise = require('bluebird');

const semaphore_db = require('./lib/dynamo/semaphore');
const resource_db = require('./lib/dynamo/resource');
const { getResource } = require('./migrations/');
const Athena = require('./lib/athena');
const SQS = require('./lib/sqs');
const SNS = require('./lib/sns');
const STS = require('./lib/sts');
const S3 = require('./lib/s3');
const Glue = require('./lib/glue');
const CloudWatch = require('./lib/cloudwatch');
const Clean = require('./operations/actions/lib/clean');
const logging = require('./lib/logging/');
const daemon_log = logging.getDaemonLogger();
const CloudwatchClient = require('@aws-sdk/client-cloudwatch');

const sqs = new SQS({ region: process.env.AWS_REGION });
const athena = new Athena({ region: process.env.AWS_REGION });
const cloudwatch = new CloudWatch({
  region: process.env.AWS_REGION,
});

const TERMINAL_STATE = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

const STACK_NAME = process.env.STACK_NAME || '';
const DAEMON_QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';
const QUEUE_URL = process.env.MONITOR_QUEUE_URL || '';
const DLQ_URL = process.env.DLQ_URL || '';
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 7);

/**
 * @param {string} queryExecutionId -
 * @returns {Promise<import('./typedefs').WharfieEvent?>} -
 */
async function getEventFromQueryExecution(queryExecutionId) {
  const queryEvent = await getWharfieQueryMetadata(queryExecutionId);
  if (!queryEvent || !queryEvent.operation_id) return null;
  return queryEvent;
}

/**
 * @param {string} queryExecutionId -
 * @returns {Promise<import('./typedefs').WharfieEvent?>} -
 */
async function getWharfieQueryMetadata(queryExecutionId) {
  const { QueryExecution } = await athena.getQueryExecution({
    QueryExecutionId: queryExecutionId,
  });
  if (!QueryExecution || !QueryExecution.Query) return null;
  /** @type {import('./typedefs').WharfieEvent} */
  let queryEvent;

  try {
    queryEvent = JSON.parse(
      QueryExecution.Query.split('\n').slice(-1)[0].substring(3)
    );
  } catch (e) {
    daemon_log.warn(
      `failed to parse query event, this could be caused by users using Wharfie workgroups for ad hoc querying: ${e}, ${JSON.stringify(
        QueryExecution
      )}`
    );
    return null;
  }
  if (
    !queryEvent.resource_id ||
    !queryEvent.operation_id ||
    !queryEvent.action_id ||
    !queryEvent.query_id
  ) {
    daemon_log.warn(
      `query event missing fields: ${JSON.stringify(queryEvent)}`
    );
    return null;
  }
  return {
    ...queryEvent,
    action_inputs: {
      query_string: QueryExecution.Query.split('\n').slice(0, -1).join('\n'),
    },
  };
}

/**
 * @param {import('./typedefs').ResourceRecord} resource -
 * @param {import('./typedefs').QueryRecord} query -
 */
async function _cleanupFailedOrCancelledQuery(resource, query) {
  const { region } = parse(resource.resource_arn);
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const s3 = new S3({ region, credentials });
  const glue = new Glue({ region });

  const clean = new Clean({
    glue,
    s3,
  });
  await clean.cleanupQueryOutput(resource, query);
}

/**
 * @param {import('./typedefs').AthenaEvent} cloudwatchEvent -
 * @param {import('./typedefs').WharfieEvent} queryEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function _monitorWharfie(cloudwatchEvent, queryEvent, context) {
  const resource = await getResource(queryEvent, context);
  // a missing resource record means the wharfie resource was deleted
  if (!resource) {
    await semaphore_db.release('wharfie');
    return;
  }
  if (
    !queryEvent.operation_id ||
    !queryEvent.action_id ||
    !queryEvent.query_id
  ) {
    throw new Error('missing required properties');
  }
  const event_log = logging.getEventLogger(queryEvent, context);
  const query = await resource_db.getQuery(
    queryEvent.resource_id,
    queryEvent.operation_id,
    queryEvent.action_id,
    queryEvent.query_id
  );
  // dynamo interruption could cause a race condition with getting query records, throw an error and retry
  if (!query) throw new Error('Could not find query record');
  const operation = await resource_db.getOperation(
    queryEvent.resource_id,
    queryEvent.operation_id
  );
  if (!operation) {
    await semaphore_db.release('wharfie');
    return;
  }
  const action = await resource_db.getAction(
    queryEvent.resource_id,
    queryEvent.operation_id,
    queryEvent.action_id
  );
  if (!action) {
    await semaphore_db.release('wharfie');
    await semaphore_db.release(
      `wharfie:${operation.operation_type}:${operation.resource_id}`
    );
    return;
  }

  await semaphore_db.release('wharfie');
  await semaphore_db.release(
    `wharfie:${operation.operation_type}:${operation.resource_id}`
  );
  if (cloudwatchEvent.detail.currentState === 'SUCCEEDED') {
    event_log.info(
      `Wharfie query succeeded with id ${query.query_id} and execution id: ${query.query_execution_id}`
    );
    await resource_db.putQuery(
      operation.resource_id,
      operation.operation_id,
      action.action_id,
      {
        query_id: query.query_id,
        query_status: 'COMPLETED',
        query_execution_id: query.query_execution_id,
        query_data: query.query_data,
      }
    );
  } else if (
    query.query_status === 'RUNNING' &&
    (cloudwatchEvent.detail.currentState === 'FAILED' ||
      cloudwatchEvent.detail.currentState === 'CANCELLED')
  ) {
    await _cleanupFailedOrCancelledQuery(resource, query);
    const retries = queryEvent.retries || 0;
    if (retries < 3) {
      event_log.warn(
        `wharfie query failed with state: ${cloudwatchEvent.detail.currentState}, retrying...`,
        { cloudwatchEvent }
      );
      await sqs.enqueue(
        Object.assign(queryEvent, {
          retries: retries + 1,
        }),
        DAEMON_QUEUE_URL,
        Math.pow(2, retries) + Math.floor(Math.random() * 5)
      );
      await resource_db.putQuery(
        operation.resource_id,
        operation.operation_id,
        action.action_id,
        {
          query_id: query.query_id,
          query_status: 'RETRYING',
          query_execution_id: cloudwatchEvent.detail.queryExecutionId,
          query_data: query.query_data,
        }
      );
      return;
    }
    event_log.error(
      `wharfie query failed terminally with state: ${cloudwatchEvent.detail.currentState}`,
      { cloudwatchEvent }
    );
    await resource_db.putQuery(
      operation.resource_id,
      operation.operation_id,
      action.action_id,
      {
        query_id: query.query_id,
        query_status: cloudwatchEvent.detail.currentState,
        query_execution_id: cloudwatchEvent.detail.queryExecutionId,
        query_data: query.query_data,
      }
    );
  } else if (
    query.query_status === 'RETRYING' &&
    (cloudwatchEvent.detail.currentState === 'FAILED' ||
      cloudwatchEvent.detail.currentState === 'CANCELLED')
  ) {
    event_log.warn(
      `DUPLICATE_QUERY_EVENTS: stale query detection and athena produced events for same state change on query_id: ${query.query_id}, this could be caused by athena being slow to publish events`,
      { cloudwatchEvent }
    );
  }
}

/**
 * @param {import('./typedefs').AthenaEvent} cloudwatchEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function monitorWharfie(cloudwatchEvent, context) {
  if (!cloudwatchEvent.detail.workgroupName.startsWith('Wharfie')) return;
  if (!TERMINAL_STATE.has(cloudwatchEvent.detail.currentState)) return;
  const { QueryExecution } = await athena.getQueryExecution({
    QueryExecutionId: cloudwatchEvent.detail.queryExecutionId,
  });
  if (!QueryExecution || !QueryExecution.Query) return;
  const queryEvent = await getWharfieQueryMetadata(
    cloudwatchEvent.detail.queryExecutionId
  );
  if (
    !queryEvent ||
    !queryEvent.operation_id ||
    !queryEvent.action_id ||
    !queryEvent.query_id
  )
    return;
  const event_log = logging.getEventLogger(queryEvent, context);

  try {
    await _monitorWharfie(cloudwatchEvent, queryEvent, context);
  } catch (err) {
    event_log.error(
      `monitor caught error ${
        // @ts-ignore
        err.stack || err
      }, for query event: ${JSON.stringify(queryEvent)}`
    );
    throw err;
  }
}

/**
 * @param {import('./typedefs').AthenaEvent} cloudwatchEvent -
 */
// TODO: switch to using something other than cloudwatch
// eslint-disable-next-line no-unused-vars
async function createMetrics(cloudwatchEvent) {
  const query = cloudwatchEvent.detail;
  const metricData = [];

  // handle terminal current state
  if (TERMINAL_STATE.has(query.currentState)) {
    const athenaMetrics = await athena.getQueryMetrics(
      cloudwatchEvent.detail.queryExecutionId
    );

    metricData.push({
      MetricName: `${query.currentState}-queries`,
      Dimensions: [
        {
          Name: 'Stack',
          Value: STACK_NAME,
        },
        {
          Name: 'WorkGroup',
          Value: query.workgroupName,
        },
        {
          Name: 'StatementType',
          Value: query.statementType,
        },
      ],
      Unit: CloudwatchClient.StandardUnit.Bytes,
      Value: (athenaMetrics.Statistics || {}).DataScannedInBytes || 0,
    });

    const { databases, tables } = athenaMetrics.References.reduce(
      (acc, reference) => {
        if (reference.DatabaseName) acc.databases.add(reference.DatabaseName);
        if (reference.DatabaseName && reference.TableName)
          acc.tables.add(`${reference.DatabaseName}.${reference.TableName}`);
        return acc;
      },
      {
        databases: new Set(),
        tables: new Set(),
      }
    );

    [...databases].forEach((database) => {
      metricData.push({
        MetricName: `${query.currentState}-queries`,
        Dimensions: [
          {
            Name: 'Stack',
            Value: STACK_NAME,
          },
          {
            Name: 'WorkGroup',
            Value: query.workgroupName,
          },
          {
            Name: 'StatementType',
            Value: query.statementType,
          },
          {
            Name: 'Database',
            Value: database,
          },
        ],
        Unit: CloudwatchClient.StandardUnit.Bytes,
        Value: (athenaMetrics.Statistics || {}).DataScannedInBytes || 0,
      });
    });

    [...tables].forEach((table) => {
      metricData.push({
        MetricName: `${query.currentState}-queries`,
        Dimensions: [
          {
            Name: 'Stack',
            Value: STACK_NAME,
          },
          {
            Name: 'WorkGroup',
            Value: query.workgroupName,
          },
          {
            Name: 'StatementType',
            Value: query.statementType,
          },
          {
            Name: 'Table',
            Value: table,
          },
        ],
        Unit: CloudwatchClient.StandardUnit.Bytes,
        Value: (athenaMetrics.Statistics || {}).DataScannedInBytes || 0,
      });
    });
  }

  const cwPromises = [];
  // chunk messages to avoid exceeding cloudwatch putMetricData 20 message limit
  while (metricData.length > 0)
    cwPromises.push(
      cloudwatch.putMetricData({
        MetricData: metricData.splice(0, 20),
        Namespace: 'DataPlatform/Athena',
      })
    );
  await Promise.all(cwPromises);
}

/**
 * @param {import('./typedefs').AthenaEvent} athenaEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function run(athenaEvent, context) {
  await monitorWharfie(athenaEvent, context);
  // await createMetrics(athenaEvent);
}

/**
 * @param {import('./typedefs').AthenaEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {any} err -
 */
async function DLQ(event, context, err) {
  const wharfieEvent = await getEventFromQueryExecution(
    event.detail.queryExecutionId
  );
  if (!wharfieEvent) return;
  const event_log = logging.getEventLogger(wharfieEvent, context);
  event_log.error(`Record has expended its retries, sending to DLQ`, {
    ...event,
  });

  const resource = await getResource(wharfieEvent, context);
  if (!resource || !wharfieEvent.action_id || !wharfieEvent.operation_id) {
    daemon_log.warn(
      'properties unexpectedly missing, maybe the resource was deleted?'
    );
    return;
  }
  const operation = await resource_db.getOperation(
    wharfieEvent.resource_id,
    wharfieEvent.operation_id
  );
  if (!operation) {
    daemon_log.warn(
      'properties unexpectedly missing, maybe the resource was deleted?'
    );
    return;
  }

  await sqs.sendMessage({
    MessageBody: JSON.stringify(event),
    QueueUrl: DLQ_URL,
  });
  await resource_db.putAction(resource.resource_id, operation.operation_id, {
    action_id: wharfieEvent.action_id,
    action_type: wharfieEvent.action_type,
    action_status: 'FAILED',
  });

  if (
    !resource.daemon_config.AlarmActions ||
    resource.daemon_config.AlarmActions.length === 0
  )
    return;

  const { region } = parse(resource.resource_arn);
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const sns = new SNS({ region, credentials });
  await Promise.all(
    resource.daemon_config.AlarmActions.map((action) =>
      sns.publish({
        TopicArn: action,
        Message: JSON.stringify({
          AlarmName: 'Wharfie Failure',
          AlarmDescription: `Processing Failed with error: ${err}`,
        }),
      })
    )
  );
}

/**
 * @param {import('./typedefs').AthenaEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {any} err -
 */
async function retry(event, context, err) {
  if ((event.retries || 0) >= MAX_RETRIES) {
    try {
      await DLQ(event, context, err);
    } catch (err) {
      // @ts-ignore
      daemon_log.error(`Failed to DLQ event ${err.stack || err}`, { ...event });
    }
    return;
  }
  await sqs.sendMessage({
    MessageBody: JSON.stringify(
      Object.assign(event, {
        retries: (event.retries || 0) + 1,
      })
    ),
    // full-jitter exp backoff (0 - 180 seconds)
    DelaySeconds: Math.floor(
      Math.random() * Math.min(180, 1 * Math.pow(2, event.retries || 0))
    ),
    QueueUrl: QUEUE_URL,
  });
}

/**
 * @param {import('aws-lambda').SQSRecord} record -
 * @param {import('aws-lambda').Context} context -
 */
async function processRecord(record, context) {
  /** @type {import('./typedefs').AthenaEvent} */
  const event = JSON.parse(record.body);

  try {
    await run(event, context);
  } catch (err) {
    daemon_log.error(
      `monitor caught error ${
        // @ts-ignore
        err.stack || err
      }, retrying Record: ${JSON.stringify(event)}`
    );
    await retry(event, context, err);
  }
}

/**
 * @param {import('aws-lambda').SQSEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
module.exports.handler = async (event, context) => {
  daemon_log.debug(`processing ${event.Records.length} records....`);
  await bluebirdPromise.map(
    event.Records,
    (/** @type {import('aws-lambda').SQSRecord} */ record) => {
      return processRecord(record, context);
    },
    { concurrency: 4 }
  );
  daemon_log.info(process.memoryUsage());
  await logging.flush();
};
