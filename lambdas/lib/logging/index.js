import Logger from './logger.js';
import ConsoleLogTransport from './console-log-transport.js';
import FirehoseLogTransport from './firehose-log-transport.js';
import { hostname as _hostname } from 'os';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { version } = require('../../../package.json');

const ROOT_LOGGER = new Logger({
  level: process.env.LOGGING_LEVEL || 'info',
  jsonFormat: true,
  base: {
    pid: process.pid,
    hostname: _hostname,
    wharfie_version: version,
  },
  transports: [
    ...(process.env.WHARFIE_LOGGING_FIREHOSE
      ? [
          new FirehoseLogTransport({
            flushInterval:
              Number(process.env.WHARFIE_LOGGING_FLUSH_INTERVAL) || 5000,
            logDeliveryStreamName: process.env.WHARFIE_LOGGING_FIREHOSE,
          }),
        ]
      : []),
    ...(process.env.LOGGING_LEVEL === 'debug'
      ? [new ConsoleLogTransport()]
      : []),
  ],
});

const AWS_SDK_LOGGER = ROOT_LOGGER.child({
  metadata: {
    log_type: 'aws_sdk',
  },
});

const WHARFIE_DB_LOGGER = ROOT_LOGGER.child({
  level: 'info',
  metadata: { log_type: 'wharfie_db' },
});

/**
 * @param {import('../../typedefs.js').WharfieEvent} event - event.
 * @param {import('aws-lambda').Context} context - context.
 * @returns {Logger} - Result.
 */
function getEventLogger(event, context) {
  return ROOT_LOGGER.child({
    metadata: {
      resource_id: event.resource_id,
      operation_id: event.operation_id,
      operation_type: event.operation_type,
      action_id: event.action_id,
      action_type: event.action_type,
      query_id: event.query_id,
      request_id: context.awsRequestId,
      log_type: 'event',
    },
  });
}

/**
 * @returns {Logger} - Result.
 */
function getDaemonLogger() {
  return ROOT_LOGGER;
}

/**
 * @returns {Logger} - Result.
 */
function getAWSSDKLogger() {
  return AWS_SDK_LOGGER;
}

/**
 * @returns {Logger} - Result.
 */
function getWharfieDBLogger() {
  return WHARFIE_DB_LOGGER;
}

/**
 *
 */
async function flush() {
  await ROOT_LOGGER.flush();
}

export {
  getEventLogger,
  getDaemonLogger,
  getAWSSDKLogger,
  getWharfieDBLogger,
  flush,
};
