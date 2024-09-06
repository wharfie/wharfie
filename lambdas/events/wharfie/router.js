'use strict';
const scheduler = require('./scheduler');

const logging = require('../../lib/logging/');
const daemon_log = logging.getDaemonLogger();

/**
 * @typedef {('WHARFIE:OPERATION:COMPLETED'|'WHARFIE:OPERATION:COMPLETED')} WharfieEventTypeEnum
 */

/**
 * @type {Object<WharfieEventTypeEnum,WharfieEventTypeEnum>}
 */
const EventTypes = {
  'WHARFIE:OPERATION:COMPLETED': 'WHARFIE:OPERATION:COMPLETED',
  DESTROYING: 'DESTROYING',
  STABLE: 'STABLE',
  RECONCILING: 'RECONCILING',
  UNPROVISIONED: 'UNPROVISIONED',
  DRIFTED: 'DRIFTED',
};

/**
 * @param {import('../../typedefs').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  daemon_log.info('Received event', { event, context });
  const [wharfiePrefix, eventType, status] = event.type.split(':');
  if (wharfiePrefix !== 'WHARFIE') {
    throw new Error(`Invalid event type: ${event.type}`);
  }
}

module.exports = {
  run: router,
};
