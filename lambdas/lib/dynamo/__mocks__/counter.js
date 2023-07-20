'use strict';

/** @type {Object.<string, number>} */
let __state = {};

/**
 * @param {Object.<string, number>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, number>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {string} counter - name of dynamo counter record
 * @param {number} value - value to increment counter by
 */
async function increment(counter, value) {
  if (!__state[counter]) __state[counter] = 0;
  __state[counter] += value;
}

/**
 * @param {string} counter - name of dynamo counter record
 * @param {number} value - value to increment counter by
 * @returns {Promise<number>} - updated counter value
 */
async function incrementReturnUpdated(counter, value) {
  if (!__state[counter]) __state[counter] = 0;
  __state[counter] += value;
  return Promise.resolve(__state[counter]);
}

/**
 * @param {string} prefix - prefix of dynamo counter record
 */
async function deleteCountersByPrefix(prefix) {
  Object.keys(__state)
    .filter((counterKey) => counterKey.startsWith(prefix))
    .forEach((counterKey) => {
      delete __state[counterKey];
    });
}

module.exports = {
  increment,
  incrementReturnUpdated,
  deleteCountersByPrefix,
  __setMockState,
  __getMockState,
};
