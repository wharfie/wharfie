'use strict';
const winston = require('winston');
const S3LogTransport = require('./s3-log-transport');

const { name, version } = require('../../package.json');

/** @type {Object.<string, Object.<string,import('winston').Logger>>} */
const loggers = {};

/**
 * @returns {import('winston').Logform.Format} -
 */
function _loggerFormat() {
  switch (process.env.LOGGING_FORMAT) {
    case 'json':
      return winston.format.json();
    case 'cli':
      return winston.format.cli();
    default:
      return winston.format.json();
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
    format: _loggerFormat(),
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
    transports: [
      new S3LogTransport({
        level: process.env.RESOURCE_LOGGING_LEVEL,
      }),
      new winston.transports.Console({
        level: process.env.RESOURCE_LOGGING_LEVEL,
      }),
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
    format: _loggerFormat(),
    defaultMeta: {
      service: name,
      version,
    },
    transports: [
      new S3LogTransport({
        level: process.env.RESOURCE_LOGGING_LEVEL,
      }),
      // new winston.transports.Console({
      //   level: process.env.DAEMON_LOGGING_LEVEL,
      // }),
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
  delete loggers[context.awsRequestId];
}

module.exports = {
  getEventLogger,
  getDaemonLogger,
  flush,
};
