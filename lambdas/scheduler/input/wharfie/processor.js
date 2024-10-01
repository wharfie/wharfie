'use strict';

const dependency_db = require('../../../lib/dynamo/dependency');
const resource_db = require('../../../lib/dynamo/operations');
const { schedule } = require('../util');

const logging = require('../../../lib/logging');
const daemon_log = logging.getDaemonLogger();

/**
 * @param {import('../../typedefs').InputEvent} wharfieEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function run(wharfieEvent, context) {
  if (!wharfieEvent) {
    daemon_log.warn(
      `invalid wharfie status event ${JSON.stringify(
        wharfieEvent
      )}, ${JSON.stringify(context)}`
    );
    return;
  } else {
    daemon_log.debug(
      `wharfie status event ${JSON.stringify(wharfieEvent)}, ${JSON.stringify(
        context
      )}`
    );
  }

  // Find downstream resources
  const dependencies = await dependency_db.findDependencies(
    `${wharfieEvent.database_name}.${wharfieEvent.table_name}`
  );
  if (!dependencies) {
    daemon_log.debug(
      `no dependencies found for ${wharfieEvent.database_name}.${wharfieEvent.table_name}`
    );
    return;
  }
  while (dependencies.length > 0) {
    const dependency = dependencies.pop();
    if (!dependency) continue;
    const now = Date.now();
    const interval = parseInt(dependency.interval);
    const ms = 1000 * interval; // convert s to ms
    const nowInterval = Math.round(now / ms) * ms;
    const before = nowInterval - 1000 * interval;

    const resource = await resource_db.getResource(dependency.resource_id);
    // For each resource schedule an update
    if (!resource) {
      daemon_log.debug(
        `no resource found for ${wharfieEvent.database_name}.${wharfieEvent.table_name}`
      );
      continue;
    }
    await schedule({
      resource_id: dependency.resource_id,
      interval,
      window: [before, nowInterval],
    });
  }
}

module.exports = {
  run,
};
