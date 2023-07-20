'use strict';

/** @type {Object.<string, Object<string, any>>} */
let __state = {};

/**
 * @param {Object.<string, Object<string, any>>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, Object<string, any>>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {string} resource_id -
 * @param {string} partition -
 * @param {Array<number>} window -
 * @returns {Promise<any>} -
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
 * @param {import('../../../typedefs').ScheduledEventRecord} item -
 */
async function schedule(item) {
  if (!__state[item.resource_id]) __state[item.resource_id] = {};
  if (__state[item.resource_id][item.sort_key]) return;
  __state[item.resource_id][item.sort_key] = item;
}

/**
 * @param {import('../../../typedefs').ScheduledEventRecord} item -
 * @param {string} status -
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
