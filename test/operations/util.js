'use strict';
process.env.STACK_NAME = 'test-stack';
process.env.TEMPORARY_GLUE_DATABASE = 'temp-glue-database';
process.env.OPERATIONS_TABLE = 'operations-table';
process.env.SEMAPHORE_TABLE = 'semaphore-table';
process.env.MONITOR_QUEUE_URL = 'monitor-queue';
process.env.CLEANUP_QUEUE_URL = 'cleanup-queue';
process.env.DAEMON_QUEUE_URL = 'daemon-queue';
process.env.EVENTS_QUEUE_URL = 'events-queue';
process.env.DLQ_URL = 'deadletter-queue';
process.env.GLOBAL_QUERY_CONCURRENCY = 3;
process.env.RESOURCE_QUERY_CONCURRENCY = 2;
process.env.MAX_QUERIES_PER_ACTION = 100;

const daemon_lambda = require('../../lambdas/daemon');
const monitor_lambda = require('../../lambdas/monitor');
const cleanup_lambda = require('../../lambdas/cleanup');
const events_lambda = require('../../lambdas/events');

jest.mock('../../lambdas/lib/dynamo/operations');
jest.mock('../../lambdas/lib/dynamo/scheduler');
jest.mock('../../lambdas/lib/dynamo/location');
jest.mock('../../lambdas/lib/dynamo/semaphore');
jest.mock('../../lambdas/lib/logging');

const { SQS } = require('@aws-sdk/client-sqs');

const sqs = new SQS();

let daemon, monitor, cleanup, events;

/**
 *
 */
async function createLambdaQueues() {
  await sqs.createQueue({
    QueueName: process.env.EVENTS_QUEUE_URL,
  });
  await sqs.createQueue({
    QueueName: process.env.DAEMON_QUEUE_URL,
  });
  await sqs.createQueue({
    QueueName: process.env.MONITOR_QUEUE_URL,
  });
  await sqs.createQueue({
    QueueName: process.env.CLEANUP_QUEUE_URL,
  });
}

/**
 * @param {import('aws-lambda').Context} context -
 */
function setLambdaTriggers(context) {
  events = setInterval(async () => {
    const { Messages } = await sqs.receiveMessage({
      QueueUrl: process.env.EVENTS_QUEUE_URL,
    });
    await events_lambda.handler(
      {
        Records: Messages.map((m) => ({
          body: m.Body,
        })),
      },
      context
    );
  }, 5);

  daemon = setInterval(async () => {
    const { Messages } = await sqs.receiveMessage({
      QueueUrl: process.env.DAEMON_QUEUE_URL,
    });
    await daemon_lambda.handler(
      {
        Records: Messages.map((m) => ({
          body: m.Body,
        })),
      },
      context
    );
  }, 5);

  monitor = setInterval(async () => {
    const { Messages } = await sqs.receiveMessage({
      QueueUrl: process.env.MONITOR_QUEUE_URL,
    });
    await monitor_lambda.handler(
      {
        Records: Messages.map((m) => ({
          body: m.Body,
        })),
      },
      context
    );
  }, 5);

  cleanup = setInterval(async () => {
    const { Messages } = await sqs.receiveMessage({
      QueueUrl: process.env.CLEANUP_QUEUE_URL,
    });
    await cleanup_lambda.handler(
      {
        Records: Messages.map((m) => ({
          body: m.Body,
        })),
      },
      context
    );
  }, 5);
}

/**
 *
 */
function clearLambdaTriggers() {
  clearInterval(daemon);
  clearInterval(monitor);
  clearInterval(cleanup);
  clearInterval(events);
}

module.exports = {
  createLambdaQueues,
  setLambdaTriggers,
  clearLambdaTriggers,
};
