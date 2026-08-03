/**
 * Reject the removed per-activity environment-variable contract.
 *
 * Empty objects are tolerated as a migration convenience, but are discarded by
 * callers. Runtime configuration belongs to the process environment until
 * Wharfie has a first-class portable configuration/secret reference.
 * @param {unknown} value - Declared activity environment variables.
 * @param {string} activityName - Activity name used in the error message.
 * @returns {void}
 */
export function assertNoActivityEnvironmentVariables(value, activityName) {
  const prototype =
    value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  const isEmptyPlainObject =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === 0;

  if (value === undefined || value === null || isEmptyPlainObject) {
    return;
  }

  throw new Error(
    `Activity '${activityName}' cannot declare environmentVariables: activity-level environment variables are not supported. Supply runtime configuration to the process environment instead.`,
  );
}

export default assertNoActivityEnvironmentVariables;
