/**
 * @typedef WharfieMessage
 * @property {string} type -
 * @property {string} name -
 */

/**
 * @typedef WharfieTableColumn
 * @property {string} name -
 * @property {string} type -
 */

/**
 * @typedef DeploymentEnvironmentProperties
 * @property {import('../env-paths').EnvPaths} envPaths -
 * @property {string} version -
 * @property {string} stateTable -
 * @property {string} accountId -
 * @property {string} region -
 * @property {string} name -
 */
/**
 * @typedef ProjectEnvironmentProperties
 * @property {string} name -
 */

/**
 * @typedef SharedProperties
 * @property {DeploymentEnvironmentProperties| function(): DeploymentEnvironmentProperties} deployment -
 * @property {ProjectEnvironmentProperties| function(): ProjectEnvironmentProperties} [project] -
 * @property {boolean} [_INTERNAL_STATE_RESOURCE] -
 */

module.exports = {};
