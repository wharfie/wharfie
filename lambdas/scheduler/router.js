'use strict';
const s3Events = require('./events/s3');
const {
  WharfieOperationCompleted,
  WharfieScheduleOperation,
} = require('./events/');
const SchedulerEntry = require('./scheduler-entry');
const scheduler = require('./scheduler');
const logging = require('../lib/logging');
const daemon_log = logging.getDaemonLogger();

/**
 * @param {import('./typedefs').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  daemon_log.info(`Event received ${JSON.stringify({ event, context })}`);
  if (SchedulerEntry.is(event)) {
    await scheduler.run(SchedulerEntry.fromEvent(event), context);
  } else if (WharfieOperationCompleted.is(event)) {
    await WharfieOperationCompleted.fromEvent(event).process();
  } else if (WharfieScheduleOperation.is(event)) {
    await WharfieScheduleOperation.fromEvent(event).process();
  } else {
    await s3Events.router(event, context);
  }
}

module.exports = router;
