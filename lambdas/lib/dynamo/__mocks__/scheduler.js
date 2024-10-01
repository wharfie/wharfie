'use strict';

const SchedulerEntry = require('../../../scheduler/scheduler-entry');

/** @type {Object.<string, Object<string, SchedulerEntry>>} */
let __state = {};

/**
 * @param {Object.<string, Object<string, SchedulerEntry>>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, Object<string, SchedulerEntry>>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {string} resource_id -
 * @param {string} partition -
 * @param {Array<number>} window -
 * @returns {Promise<SchedulerEntry[]>} -
 */
async function query(resource_id, partition, window) {
  const [start_by, end_by] = window;
  if (!__state[resource_id]) return [];
  const _return = Object.keys(__state[resource_id])
    .filter((sortKey) => {
      return (
        sortKey >= `${partition}:${start_by}` &&
        sortKey <= `${partition}:${end_by}`
      );
    })
    .map((sortKey) => __state[resource_id][sortKey]);
  return Promise.resolve(_return);
}

/**
 * @param {SchedulerEntry} schedulerEvent -
 */
async function schedule(schedulerEvent) {
  if (!__state[schedulerEvent.resource_id])
    __state[schedulerEvent.resource_id] = {};
  if (__state[schedulerEvent.resource_id][schedulerEvent.sort_key]) return;
  __state[schedulerEvent.resource_id][schedulerEvent.sort_key] = schedulerEvent;
}

/**
 * @param {SchedulerEntry} item -
 * @param {SchedulerEntry.SchedulerEntryStatusEnum} status -
 */
async function update(item, status) {
  if (!__state[item.resource_id]) __state[item.resource_id] = {};
  item.status = status;
  __state[item.resource_id][item.sort_key] = item;
}

/**
 * @param {string} resource_id -
 */
async function delete_records(resource_id) {
  delete __state[resource_id];
}

module.exports = {
  schedule,
  update,
  query,
  delete_records,
  __setMockState,
  __getMockState,
};
