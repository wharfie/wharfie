/**
 * Compare canonical ASCII strings by code unit. The supported manifest names
 * and logical IDs are ASCII, so this ordering is deterministic across hosts
 * and does not depend on the process locale.
 * @param {string} left - Left value.
 * @param {string} right - Right value.
 * @returns {number} - Sort order.
 */
export function compareCanonicalStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Recursively order the keys of an already validated JSON value. Arrays retain
 * their semantic order.
 * @param {any} value - Validated JSON value.
 * @returns {any} - Independently ordered JSON value.
 */
export function sortCanonicalJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortCanonicalJsonValue(item));
  }
  if (value === null || typeof value !== 'object') return value;

  /** @type {Record<string, any>} */
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort(compareCanonicalStrings)) {
    sorted[key] = sortCanonicalJsonValue(value[key]);
  }
  return sorted;
}

export default {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
};
