'use strict';

const { parse } = require('@sandfox/arn');
const logging = require('../../lib/logging');
const { createId } = require('../../lib/id');

const daemon_log = logging.getDaemonLogger();

const resource_db = require('../../lib/dynamo/resource');
const semaphore_db = require('../../lib/dynamo/semaphore');
const { getResource } = require('../../migrations/');
const Athena = require('../../lib/athena/');
const STS = require('../../lib/sts');
const SQS = require('../../lib/sqs');

const sqs = new SQS({ region: process.env.AWS_REGION });

const GLOBAL_QUERY_CONCURRENCY = Number(
  process.env.GLOBAL_QUERY_CONCURRENCY || 10
);
const RESOURCE_QUERY_CONCURRENCY = Number(
  process.env.RESOURCE_QUERY_CONCURRENCY || 5
);
const QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').QueryEnqueueInput[]} queries -
 */
async function enqueue(event, context, queries) {
  if (!event.action_id || !event.operation_id)
    throw new Error('enqueue requires event with action_id and operation_id');
  const event_log = logging.getEventLogger(event, context);
  const query_records = queries.map((query) => ({
    query_id: createId(),
    query_status: 'WAITING',
    query_string: query.query_string,
    query_data: query.query_data || {},
  }));
  event_log.debug(`writing ${query_records.length} query records`);
  await resource_db.putQueries(
    event.resource_id,
    event.operation_id,
    event.action_id,
    query_records
  );
  event_log.debug(`enqueuing ${query_records.length} query events`);
  await sqs.enqueueBatch(
    query_records.map((query_record) => ({
      resource_id: event.resource_id,
      operation_id: event.operation_id,
      operation_type: event.operation_type,
      action_id: event.action_id,
      action_type: event.action_type,
      query_id: query_record.query_id,
      retries: 0,
      action_inputs: {
        query_string: query_record.query_string,
      },
    })),
    QUEUE_URL
  );
  event_log.info(`finished enqueuing ${queries.length} query events`);
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 */
async function _run(event, context, resource) {
  if (!event.operation_id || !event.action_id || !event.query_id)
    throw new Error('Wharfie event missing fields');
  const event_log = logging.getEventLogger(event, context);
  event_log.debug(`Running Query: ${event.query_id}`);
  const { region } = parse(resource.resource_arn);
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const athena = new Athena({ region, credentials });

  const query = await resource_db.getQuery(
    event.resource_id,
    event.operation_id,
    event.action_id,
    event.query_id
  );
  if (!query) throw new Error('Invalid or missing query');
  const query_string = event.action_inputs.query_string;

  const QueryString = [
    query_string,
    `-- ${JSON.stringify({
      resource_id: event.resource_id,
      operation_id: event.operation_id,
      operation_type: event.operation_type,
      action_id: event.action_id,
      action_type: event.action_type,
      query_id: event.query_id,
      retries: event.retries || 0,
    })}`,
  ].join('\n');

  event_log.debug(`Query String: ${QueryString}`);
  const { QueryExecutionId } = await athena.startQueryExecution({
    WorkGroup: resource.athena_workgroup,
    QueryString,
  });
  if (!QueryExecutionId) throw new Error('Failed to start query');

  await resource_db.putQuery(
    resource.resource_id,
    event.operation_id,
    event.action_id,
    {
      query_id: query.query_id,
      query_status: 'RUNNING',
      query_execution_id: QueryExecutionId,
      query_data: query.query_data,
    }
  );
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
async function run(event, context) {
  if (!event.operation_id || !event.action_id || !event.query_id)
    throw new Error('Wharfie event missing fields');
  const operation = await resource_db.getOperation(
    event.resource_id,
    event.operation_id
  );
  if (!operation) {
    daemon_log.warn('operation unexpectedly missing, maybe it was cancelled?');
    return;
  }
  const event_log = logging.getEventLogger(event, context);

  const isResourceLocked = await semaphore_db.increase(
    `wharfie:${event.operation_type}:${event.resource_id}`,
    RESOURCE_QUERY_CONCURRENCY
  );
  if (!isResourceLocked) {
    event_log.debug(`Too many running queries running for resource`);
    const run_query_retries = event.run_query_retries || 0;
    await sqs.enqueue(
      Object.assign(event, {
        run_query_retries: run_query_retries + 1,
      }),
      QUEUE_URL,
      Math.floor(
        Math.random() * Math.min(60, 1 * Math.pow(2, run_query_retries))
      ) + 5
    );
    return;
  }
  const isGlobalLocked = await semaphore_db.increase(
    'wharfie',
    GLOBAL_QUERY_CONCURRENCY
  );
  if (!isGlobalLocked) {
    event_log.debug(
      `Too many running queries running for all wharfie resources`
    );
    await semaphore_db.release(
      `wharfie:${event.operation_type}:${event.resource_id}`
    );
    const run_query_retries = event.run_query_retries || 0;
    await sqs.enqueue(
      Object.assign(event, {
        run_query_retries: run_query_retries + 1,
      }),
      QUEUE_URL,
      Math.floor(
        Math.random() * Math.min(60, 1 * Math.pow(2, run_query_retries))
      ) + 5
    );
    return;
  }

  const resource = await getResource(event, context);
  if (!resource) {
    daemon_log.warn('resource unexpectedly missing, maybe it was deleted?');
    return;
  }

  try {
    await _run(event, context, resource);
  } catch (err) {
    await semaphore_db.release('wharfie');
    await semaphore_db.release(
      `wharfie:${event.operation_type}:${event.resource_id}`
    );
    throw err;
  }
}

module.exports = {
  run,
  enqueue,
};
