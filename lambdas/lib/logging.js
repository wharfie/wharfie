'use strict';
const winston = require('winston');
// eslint-disable-next-line node/no-extraneous-require
const { format } = require('logform');
// const S3LogTransport = require('./s3-log-transport');
const FirehoseLogTransport = require('./firehose-log-transport');

const { name, version } = require('../../package.json');

/** @type {Object.<string, Object.<string,import('winston').Logger>>} */
const loggers = {};

const firehoseTransportOptions = {
  logDeliveryStreamName: process.env.WHARFIE_LOGGING_FIREHOSE,
  // don't use flush intervals when running in jest
  flushInterval: process.env.JEST_WORKER_ID ? -1 : 5000,
};

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
      log_type: 'event',
    },
    transports:
      process.env.LOGGING_FORMAT === 'cli'
        ? [
            new winston.transports.Console({
              level: process.env.RESOURCE_LOGGING_LEVEL,
            }),
          ]
        : [
            new FirehoseLogTransport(
              {
                level: process.env.RESOURCE_LOGGING_LEVEL,
              },
              firehoseTransportOptions
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

  winston.loggers.add(key, {
    level: process.env.DAEMON_LOGGING_LEVEL,
    format: winston.format.combine(..._loggerFormat()),
    defaultMeta: {
      service: name,
      version,
      log_type: 'daemon',
    },
    transports:
      process.env.LOGGING_FORMAT === 'cli'
        ? [
            new winston.transports.Console({
              level: process.env.DAEMON_LOGGING_LEVEL,
            }),
          ]
        : [
            new FirehoseLogTransport(
              {
                level: process.env.DAEMON_LOGGING_LEVEL,
              },
              firehoseTransportOptions
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
 * @returns {import('winston').Logform.Format} -
 * @param {import('winston').Logform.Format} info -
 * @param {{}} opts -
 */
const sdkLogFormatter = format((info, opts = {}) => {
  if (info.message && info.message.error) {
    if (info.message.error.$fault) {
      info.message.error.fault = info.message.error.$fault;
      delete info.message.error.$fault;
    }
    if (info.message.error.$metadata) {
      info.message.error.metadata = info.message.error.$metadata;
      delete info.message.error.$metadata;
    }
  }
  return info;
});

/**
 * @returns {import('winston').Logger} -
 */
function getAWSSDKLogger() {
  const key = `aws`;
  if (loggers[key] && loggers[key][key]) return loggers[key][key];

  winston.loggers.add(key, {
    level: process.env.AWS_SDK_LOGGING_LEVEL,
    format: winston.format.combine(..._loggerFormat(), sdkLogFormatter()),
    defaultMeta: {
      service: name,
      version,
      log_type: 'aws_sdk',
    },
    transports:
      process.env.LOGGING_FORMAT === 'cli'
        ? [
            new winston.transports.Console({
              level: process.env.AWS_SDK_LOGGING_LEVEL,
            }),
          ]
        : [
            new FirehoseLogTransport(
              {
                level: process.env.AWS_SDK_LOGGING_LEVEL,
              },
              firehoseTransportOptions
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
