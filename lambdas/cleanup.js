import './config.js';

import { map } from 'bluebird';

import SQS from './lib/sqs.js';
import { getResource } from './lib/dynamo/operations.js';
import Glue from './lib/glue.js';
import S3 from './lib/s3.js';
import STS from './lib/sts.js';
import Clean from './operations/actions/lib/clean.js';
import * as logging from './lib/logging/index.js';

const sqs = new SQS({ region: process.env.AWS_REGION });

const daemon_log = logging.getDaemonLogger();

const QUEUE_URL = process.env.CLEANUP_QUEUE_URL || '';
const DLQ_URL = process.env.DLQ_URL || '';
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 7);
/**
 * @param {import('./typedefs.js').CleanupEvent} cleanupEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function run(cleanupEvent, context) {
  if (!cleanupEvent.resource_id || !cleanupEvent.manifest_uri) {
    daemon_log.info(
      `invalid cleanup event ${JSON.stringify(cleanupEvent)}, ${JSON.stringify(
        context,
      )}`,
    );
    return;
  } else {
    daemon_log.debug(
      `cleanup event ${JSON.stringify(cleanupEvent)}, ${JSON.stringify(
        context,
      )}`,
    );
  }
  const resource = await getResource(cleanupEvent.resource_id);
  if (!resource) {
    daemon_log.warn('resource unexpectedly missing, maybe it was deleted?');
    return;
  }
  const region = resource.region;
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const s3 = new S3({ region, credentials });
  const glue = new Glue({ region });
  const clean = new Clean({
    glue,
    s3,
  });
  await clean.cleanupManifest(resource, cleanupEvent.manifest_uri);
}

/**
 * @param {import('./typedefs.js').CleanupEvent} event -
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
 * @param {import('./typedefs.js').CleanupEvent} event -
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
      }),
    ),
    // full-jitter exp backoff (0 - 180 seconds)
    DelaySeconds: Math.floor(
      Math.random() * Math.min(180, 1 * Math.pow(2, event.retries || 0)),
    ),
    QueueUrl: QUEUE_URL,
  });
}

/**
 * @param {import('aws-lambda').SQSRecord} record -
 * @param {import('aws-lambda').Context} context -
 */
async function processRecord(record, context) {
  /** @type {import('./typedefs.js').CleanupEvent} */
  const event = JSON.parse(record.body);
  try {
    if (!event.delays || event.delays < 3) {
      // reenqueue until cleanup has a 1 hour delay
      event.delays = (event.delays || 0) + 1;
      await sqs.sendMessage({
        MessageBody: JSON.stringify(event),
        DelaySeconds: 15 * 60,
        QueueUrl: QUEUE_URL,
      });
    } else {
      await run(event, context);
    }
  } catch (err) {
    daemon_log.error(
      // @ts-ignore
      `caught error ${err.stack || err}, retrying Record: ${JSON.stringify(
        event,
      )}`,
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
  await map(
    event.Records,
    (/** @type {import('aws-lambda').SQSRecord} */ record) => {
      return processRecord(record, context);
    },
    { concurrency: 4 },
  );
  daemon_log.info(process.memoryUsage());
  await logging.flush();
};

export default {
  handler,
  run,
};
