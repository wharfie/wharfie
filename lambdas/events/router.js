'use strict';
const processor = require('./s3/processor');
const scheduler = require('./s3/scheduler');

/**
 * @param {import('../typedefs').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  if (event.resource_id) {
    // handle starting scheduled operations
    await processor.run(event, context);
  } else if (event.Records) {
    await Promise.all(
      event.Records.map((record) => {
        if (record.eventSource === 'aws:s3') {
          // handle s3 events
          return scheduler.run(record, context);
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
