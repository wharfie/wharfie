'use strict';

/**
 * @typedef {object} SemaphoreRecord
 * @property {number} value -
 * @property {number} limit -
 */

const GLOBAL_LIMIT = Infinity;

/** @type {Object.<string, SemaphoreRecord>} */
let __state = {};

/**
 * @param {Object.<string, SemaphoreRecord>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, SemaphoreRecord>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {string} semaphore - name of semaphore record
 * @param {number} threshold - threshold that the counter needs to be <= in order to increment
 * @returns {Promise<boolean>} - if the semaphore was successfully entered
 */
async function increase(semaphore, threshold) {
  if (!__state[semaphore]) {
    __state[semaphore] = {
      value: 0,
      limit: GLOBAL_LIMIT,
    };
  }
  if (__state[semaphore].value + 1 >= threshold) {
    return false;
  } else if (
    __state[semaphore].limit &&
    __state[semaphore].value + 1 >= __state[semaphore].limit
  ) {
    return false;
  } else {
    __state[semaphore].value += 1;
    return true;
  }
}

/**
 * @param {string} semaphore - name of semaphore record
 */
async function release(semaphore) {
  if (!__state[semaphore]) {
    __state[semaphore] = {
      value: 0,
      limit: GLOBAL_LIMIT,
    };
  }
  if (__state[semaphore].value > 0) {
    __state[semaphore].value -= 1;
  } else {
    __state[semaphore].value = 0;
  }
}

/**
 * @param {string} semaphore - name of semaphore record
 */
async function deleteSemaphore(semaphore) {
  // remove value from top-level `wharfie` semaphore
  let value = await __state[semaphore].value;
  while (value > 0) {
    await release(`wharfie`);
    value = value - 1;
  }
  delete __state[semaphore];
}

module.exports = {
  increase,
  release,
  deleteSemaphore,
  __setMockState,
  __getMockState,
};
