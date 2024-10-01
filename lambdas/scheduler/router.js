'use strict';
const s3Events = require('./input/s3/');
const wharfieEvents = require('./input/wharfie/');
const WharfieEvent = require('../events/wharfie');
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
  } else if (WharfieEvent.is(event)) {
    await wharfieEvents.router(event, context);
  } else {
    await s3Events.router(event, context);
  }
}

module.exports = router;
