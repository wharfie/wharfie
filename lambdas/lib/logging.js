'use strict';

const pino = require('pino');
const path = require('path');
const os = require('os');

const { version } = require('../../package.json');

const ROOT_LOGGER = pino.pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    pid: process.pid,
    hostname: os.hostname,
    wharfie_version: version,
  },
  transport: {
    targets: [
      ...(process.env.WHARFIE_LOGGING_FIREHOSE
        ? [
            {
              target: path.join(__dirname, `./pino-firehose-log-transport.js`),
              options: {
                flushInterval: 5000,
                logDeliveryStreamName: process.env.WHARFIE_LOGGING_FIREHOSE,
              },
              level: process.env.LOG_LEVEL || 'info',
            },
          ]
        : []),
      ...(process.env.LOG_LEVEL === 'debug'
        ? [
            {
              level: 'info',
              target: 'pino-pretty',
              options: {},
            },
          ]
        : []),
    ],
  },
});

const AWS_SDK_LOGGER = ROOT_LOGGER.child({
  log_type: 'aws_sdk',
});

/** @type {Object.<string, Object.<string,import('pino').Logger>>} */
const loggers = {};

/**
 * @param {import('../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {import('pino').Logger} -
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
 * @returns {import('pino').Logger} -
 */
function getDaemonLogger() {
  return ROOT_LOGGER;
}

/**
 * @returns {import('pino').Logger} -
 */
function getAWSSDKLogger() {
  return AWS_SDK_LOGGER;
}

/**
 *
 */
async function flush() {
  await new Promise((resolve) => ROOT_LOGGER.flush(resolve));
}

module.exports = {
  getEventLogger,
  getDaemonLogger,
  getAWSSDKLogger,
  flush,
};
