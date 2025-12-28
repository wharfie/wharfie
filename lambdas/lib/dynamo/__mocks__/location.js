/** @type {Object.<string, Object<string, import('../../../typedefs.js').LocationRecord>>} */
let __state = {};

/**
 * @param {Object.<string, Object<string, import('../../../typedefs.js').LocationRecord>>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, Object<string, import('../../../typedefs.js').LocationRecord>>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {import('../../../typedefs.js').LocationRecord} location -
 */
async function putLocation(location) {
  if (!__state[location.location]) __state[location.location] = {};
  __state[location.location][location.resource_id] = location;
}

/**
 * @param {string} location -
 * @returns {Promise<Array<import('../../../typedefs.js').LocationRecord>?>} - event
 */
async function findLocations(location) {
  if (!location || location === 's3://') return [];
  const items = Object.values(__state[location] || {});
  if (items.length === 0)
    return findLocations(
      location.slice(-1) === '/'
        ? location.substring(
            0,
            location.lastIndexOf('/', location.lastIndexOf('/') - 1) + 1,
          )
        : location.substring(0, location.lastIndexOf('/') + 1),
    );
  return items;
}

/**
 * @param {import('../../../typedefs.js').LocationRecord} location -
 */
async function deleteLocation(location) {
  if (
    !__state[location.location] ||
    !__state[location.location][location.resource_id]
  )
    return;
  delete __state[location.location][location.resource_id];
}

export {
  putLocation,
  findLocations,
  deleteLocation,
  __setMockState,
  __getMockState,
};
