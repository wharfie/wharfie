import s3Events from './events/s3/index.js';
import {
  WharfieOperationCompleted,
  WharfieScheduleOperation,
} from './events/index.js';
import SchedulerEntry from './scheduler-entry.js';
import { run } from './scheduler.js';
import * as logging from '../lib/logging/index.js';

const daemon_log = logging.getDaemonLogger();

/**
 * @param {import('./typedefs.js').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  daemon_log.info(`Event received ${JSON.stringify({ event, context })}`);
  if (SchedulerEntry.is(event)) {
    await run(SchedulerEntry.fromEvent(event), context);
  } else if (WharfieOperationCompleted.is(event)) {
    await WharfieOperationCompleted.fromEvent(event).process();
  } else if (WharfieScheduleOperation.is(event)) {
    await WharfieScheduleOperation.fromEvent(event).process();
  } else {
    await s3Events.router(event, context);
  }
}

export default router;
