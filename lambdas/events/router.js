'use strict';
const s3Events = require('./s3');
const wharfieEvents = require('./wharfie');

/**
 * @param {import('../typedefs').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  if (event.resource_id && event.type !== 'WHARFIE:OPERATION:COMPLETED') {
    // handle starting scheduled operations
    await s3Events.processor(event, context);
  } else if (
    event.resource_id &&
    event.type === 'WHARFIE:OPERATION:COMPLETED'
  ) {
    // handle finishing scheduled operations
    await wharfieEvents.scheduler(event, context);
  } else if (event.Records) {
    await Promise.all(
      event.Records.map((record) => {
        if (record.eventSource === 'aws:s3') {
          // handle s3 events from s3 service
          return s3Events.scheduler(record, context);
        } else if (record.source === 'aws.s3') {
          // handle s3 events from eventbridge
          return s3Events.scheduler(record, context);
        } else {
          throw new Error('Event not recognized');
        }
      })
    );
  } else if (event.Event !== 's3:TestEvent') {
    throw new Error('Event not recognized');
  }
}

module.exports = router;
