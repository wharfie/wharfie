import { run } from './processor.js';
import * as logging from '../../../lib/logging/index.js';
const daemon_log = logging.getDaemonLogger();

/**
 * @param {import('../../typedefs.js').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  daemon_log.info(`Event received ${JSON.stringify({ event, context })}`);
  if (event.Records) {
    await Promise.all(
      event.Records.map((record) => {
        if (record.eventSource === 'aws:s3') {
          // handle s3 events from s3 service
          return run(
            {
              bucket: record.s3.bucket.name,
              key: record.s3.object.key,
            },
            context,
          );
        } else {
          throw new Error('Event not recognized');
        }
      }),
    );
  } else if (event.source === 'aws.s3') {
    await run(
      {
        bucket: event.detail.bucket.name,
        key: event.detail.object.key,
      },
      context,
    );
  } else if (event.Event !== 's3:TestEvent') {
    throw new Error(`Unknown event type ${JSON.stringify(event)}`);
  }
}

export default router;
