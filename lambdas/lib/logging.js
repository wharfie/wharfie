'use strict';
const winston = require('winston');
const S3LogTransport = require('./s3-log-transport');
const cuid = require('cuid');

const { name, version } = require('../../package.json');

/** @type {Object.<string, Object.<string,import('winston').Logger>>} */
const loggers = {};

const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME;
const BUCKET = process.env.WHARFIE_SERVICE_BUCKET || '';
const DEPLOYMENT_NAME = process.env.STACK_NAME;

/**
 * @returns {import('winston').Logform.Format[]} -
 */
function _loggerFormat() {
  switch (process.env.LOGGING_FORMAT) {
    case 'json':
      return [winston.format.timestamp(), winston.format.json()];
    case 'cli':
      return [winston.format.cli()];
    default:
      return [winston.format.timestamp(), winston.format.json()];
  }
}

/**
 * @param {import('../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {import('winston').Logger} -
 */
function getEventLogger(event, context) {
  const key = `${context.awsRequestId}${event.resource_id}${event.operation_id}${event.action_id}${event.query_id}`;
  if (loggers[context.awsRequestId] && loggers[context.awsRequestId][key])
    return loggers[context.awsRequestId][key];

  const currentDateTime = new Date();
  const year = currentDateTime.getUTCFullYear();
  const month = String(currentDateTime.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(currentDateTime.getUTCDate()).padStart(2, '0');
  const currentHourUTC = currentDateTime.getUTCHours();
  const formattedDate = `${year}-${month}-${day}`;
  const logObjectKey = `${DEPLOYMENT_NAME}/event_logs/dt=${formattedDate}/hr=${currentHourUTC}/${event.resource_id}.log`;

  winston.loggers.add(key, {
    level: process.env.RESOURCE_LOGGING_LEVEL,
    format: winston.format.combine(..._loggerFormat()),
    defaultMeta: {
      service: name,
      version,
      resource_id: event.resource_id,
      operation_id: event.operation_id,
      operation_type: event.operation_type,
      action_id: event.action_id,
      action_type: event.action_type,
      query_id: event.query_id,
      request_id: context.awsRequestId,
    },
    transports:
      process.env.LOGGING_FORMAT === 'cli'
        ? [
            new winston.transports.Console({
              level: process.env.RESOURCE_LOGGING_LEVEL,
            }),
          ]
        : [
            new S3LogTransport(
              {
                level: process.env.RESOURCE_LOGGING_LEVEL,
              },
              {
                logBucket: BUCKET,
                logObjectKey,
                // don't use flush intervals when running in jest
                flushInterval: process.env.JEST_WORKER_ID ? -1 : 5000,
              }
            ),
          ],
  });
  const logger = winston.loggers.get(key);
  loggers[context.awsRequestId] = {
    ...loggers[context.awsRequestId],
    [key]: logger,
  };
  return logger;
}

/**
 * @returns {import('winston').Logger} -
 */
function getDaemonLogger() {
  const key = `daemon`;
  if (loggers[key] && loggers[key][key]) return loggers[key][key];

  const currentDateTime = new Date();
  const year = currentDateTime.getUTCFullYear();
  const month = String(currentDateTime.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(currentDateTime.getUTCDate()).padStart(2, '0');
  const currentHourUTC = currentDateTime.getUTCHours();
  const formattedDate = `${year}-${month}-${day}`;
  const LOG_NAME = `${
    process.env.AWS_LAMBDA_LOG_STREAM_NAME || cuid()
  }.log`.replace(/\//g, '_');
  const logObjectKey = `${DEPLOYMENT_NAME}/daemon_logs/dt=${formattedDate}/hr=${currentHourUTC}/lambda=${FUNCTION_NAME}/${LOG_NAME}`;

  winston.loggers.add(key, {
    level: process.env.DAEMON_LOGGING_LEVEL,
    format: winston.format.combine(..._loggerFormat()),
    defaultMeta: {
      service: name,
      version,
    },
    transports:
      process.env.LOGGING_FORMAT === 'cli'
        ? [
            new winston.transports.Console({
              level: process.env.DAEMON_LOGGING_LEVEL,
            }),
          ]
        : [
            ...(process.env.DAEMON_LOGGING_LEVEL === 'debug'
              ? [
                  new winston.transports.Console({
                    level: process.env.DAEMON_LOGGING_LEVEL,
                  }),
                ]
              : []),
            new S3LogTransport(
              {
                level: process.env.DAEMON_LOGGING_LEVEL,
              },
              {
                logBucket: BUCKET,
                logObjectKey,
                // don't use flush intervals when running in jest
                flushInterval: process.env.JEST_WORKER_ID ? -1 : 5000,
              }
            ),
          ],
  });
  const logger = winston.loggers.get(key);
  loggers[key] = {
    ...loggers[key],
    [key]: logger,
  };
  return logger;
}

/**
 * @returns {import('winston').Logger} -
 */
function getAWSSDKLogger() {
  const key = `aws`;
  if (loggers[key] && loggers[key][key]) return loggers[key][key];

  const currentDateTime = new Date();
  const year = currentDateTime.getUTCFullYear();
  const month = String(currentDateTime.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(currentDateTime.getUTCDate()).padStart(2, '0');
  const currentHourUTC = currentDateTime.getUTCHours();
  const formattedDate = `${year}-${month}-${day}`;
  const LOG_NAME = `${
    process.env.AWS_LAMBDA_LOG_STREAM_NAME || cuid()
  }.log`.replace(/\//g, '_');
  const logObjectKey = `${DEPLOYMENT_NAME}/aws_sdk_logs/dt=${formattedDate}/hr=${currentHourUTC}/lambda=${FUNCTION_NAME}/${LOG_NAME}`;

  winston.loggers.add(key, {
    level: process.env.AWS_SDK_LOGGING_LEVEL,
    format: winston.format.combine(..._loggerFormat()),
    defaultMeta: {
      service: name,
      version,
    },
    transports:
      process.env.LOGGING_FORMAT === 'cli'
        ? [
            new winston.transports.Console({
              level: process.env.AWS_SDK_LOGGING_LEVEL,
            }),
          ]
        : [
            ...(process.env.AWS_SDK_LOGGING_LEVEL === 'debug'
              ? [
                  new winston.transports.Console({
                    level: process.env.AWS_SDK_LOGGING_LEVEL,
                  }),
                ]
              : []),
            new S3LogTransport(
              {
                level: process.env.AWS_SDK_LOGGING_LEVEL,
              },
              {
                logBucket: BUCKET,
                logObjectKey,
                // don't use flush intervals when running in jest
                flushInterval: process.env.JEST_WORKER_ID ? -1 : 5000,
              }
            ),
          ],
  });
  const logger = winston.loggers.get(key);
  loggers[key] = {
    ...loggers[key],
    [key]: logger,
  };
  return logger;
}

/**
 * @param {import('aws-lambda').Context} context -
 */
async function flush(context) {
  if (!loggers[context.awsRequestId]) return;
  const flushRequests = Object.keys(loggers[context.awsRequestId]).map(
    (key) => {
      return /** @type {Promise<void>} */ (
        new Promise((resolve) => {
          loggers[context.awsRequestId][key].on('finish', () => {
            delete loggers[context.awsRequestId][key];
            resolve();
          });
          loggers[context.awsRequestId][key].end();
        })
      );
    }
  );
  await Promise.all(flushRequests);
  // await Promise.all([...flushRequests, flushDaemon(), flushAWSSDK()]);
  delete loggers[context.awsRequestId];
}

/**
 *
 */
async function flushDaemon() {
  const key = `daemon`;
  if (!loggers[key] || !loggers[key][key]) return;
  await new Promise((resolve) => {
    loggers[key][key].on('finish', () => {
      delete loggers[key][key];
      resolve('done');
    });
    loggers[key][key].end();
  });
  delete loggers[key];
}

/**
 *
 */
async function flushAWSSDK() {
  const key = `aws`;
  if (!loggers[key] || !loggers[key][key]) return;
  await new Promise((resolve) => {
    loggers[key][key].on('finish', () => {
      delete loggers[key][key];
      resolve('done');
    });
    loggers[key][key].end();
  });
  delete loggers[key];
}

module.exports = {
  getEventLogger,
  getDaemonLogger,
  getAWSSDKLogger,
  flush,
  flushDaemon,
  flushAWSSDK,
};
