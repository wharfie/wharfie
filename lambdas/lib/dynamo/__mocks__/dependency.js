/** @type {Object.<string, Object<string, import('../../../typedefs.js').DependencyRecord>>} */
let __state = {};

/**
 * @param {Object.<string, Object<string, import('../../../typedefs.js').DependencyRecord>>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, Object<string, import('../../../typedefs.js').DependencyRecord>>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {import('../../../typedefs.js').DependencyRecord} dependency -
 */
async function putDependency(dependency) {
  if (!__state[dependency.dependency]) __state[dependency.dependency] = {};
  __state[dependency.dependency][dependency.resource_id] = dependency;
}

/**
 * @param {string} dependency -
 * @returns {Promise<Array<import('../../../typedefs.js').DependencyRecord>?>} - event
 */
async function findDependencies(dependency) {
  if (!dependency || dependency === 's3://') return [];
  const items = Object.values(__state[dependency] || {});
  return items;
}

/**
 * @param {import('../../../typedefs.js').DependencyRecord} dependency -
 */
async function deleteDependency(dependency) {
  if (
    !__state[dependency.dependency] ||
    !__state[dependency.dependency][dependency.resource_id]
  )
    return;
  delete __state[dependency.dependency][dependency.resource_id];
}

export {
  putDependency,
  findDependencies,
  deleteDependency,
  __setMockState,
  __getMockState,
};
