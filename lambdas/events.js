'use strict';
require('./config');

const router = require('./events/router');

const SQS = require('./lib/sqs');

const sqs = new SQS({ region: process.env.AWS_REGION });

const logging = require('./lib/logging');
const daemon_log = logging.getDaemonLogger();

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';
const DLQ_URL = process.env.DLQ_URL || '';
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 7);

/**
 * @param {import('./typedefs').InputEvent} event -
 */
async function DLQ(event) {
  daemon_log.error(`Record has expended its retries, sending to DLQ`, {
    ...event,
  });
  await sqs.sendMessage({
    MessageBody: JSON.stringify(event),
    QueueUrl: DLQ_URL,
  });
}

/**
 * @param {import('./typedefs').InputEvent} event -
 */
async function retry(event) {
  if ((event.retries || 0) >= MAX_RETRIES) {
    try {
      await DLQ(event);
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
  /** @type {import('./typedefs').InputEvent & import('aws-lambda').SNSMessage} */
  const event = JSON.parse(record.body);

  try {
    if (event.Type === 'Notification') {
      // handle S3 -> SNS -> SQS
      /** @type {import('./typedefs').InputEvent} */
      const SnsEvent = JSON.parse(event.Message);
      await router(SnsEvent, context);
    } else if (event.Records) {
      // handle S3 -> SQS
      await router(event, context);
    } else {
      // handle regular SQS
      await router(event, context);
    }
  } catch (err) {
    daemon_log.error(
      `events caught error ${
        // @ts-ignore
        err.stack || err
      }, retrying Record: ${JSON.stringify(event)}`
    );
    await retry(event);
  }
}

/**
 * @param {import('aws-lambda').SQSEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
const handler = async (event, context) => {
  daemon_log.debug(JSON.stringify(event));
  daemon_log.debug(`processing ${event.Records.length} records....`);
  await Promise.all(
    event.Records.map((record) => processRecord(record, context))
  );
  await logging.flush(context);
};

module.exports = {
  handler,
};
