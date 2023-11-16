'use strict';

const Logger = require('./logger');
const ConsoleLogTransport = require('./console-log-transport');
const FirehoseLogTransport = require('./firehose-log-transport');
const os = require('os');

const { version } = require('../../../package.json');

const ROOT_LOGGER = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  jsonFormat: true,
  base: {
    pid: process.pid,
    hostname: os.hostname,
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
    ...(process.env.LOG_LEVEL === 'debug' ? [new ConsoleLogTransport()] : []),
  ],
});

const AWS_SDK_LOGGER = ROOT_LOGGER.child({
  log_type: 'aws_sdk',
});

/** @type {Object.<string, Object.<string,Logger>>} */
const loggers = {};

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Logger} -
 */
function getEventLogger(event, context) {
  const key = `${context.awsRequestId}${event.resource_id}${event.operation_id}${event.action_id}${event.query_id}`;
  if (loggers[context.awsRequestId] && loggers[context.awsRequestId][key])
    return loggers[context.awsRequestId][key];
  if (!loggers[context.awsRequestId]) loggers[context.awsRequestId] = {};
  loggers[context.awsRequestId][key] = ROOT_LOGGER.child({
    resource_id: event.resource_id,
    operation_id: event.operation_id,
    operation_type: event.operation_type,
    action_id: event.action_id,
    action_type: event.action_type,
    query_id: event.query_id,
    request_id: context.awsRequestId,
    log_type: 'event',
  });
  return loggers[context.awsRequestId][key];
}

/**
 * @returns {Logger} -
 */
function getDaemonLogger() {
  return ROOT_LOGGER;
}

/**
 * @returns {Logger} -
 */
function getAWSSDKLogger() {
  return AWS_SDK_LOGGER;
}

/**
 *
 */
async function flush() {
  await ROOT_LOGGER.flush();
}

module.exports = {
  getEventLogger,
  getDaemonLogger,
  getAWSSDKLogger,
  flush,
};
