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
 * @property {string} stateTableArn -
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
 * @property {DeploymentEnvironmentProperties| function(): DeploymentEnvironmentProperties} [deployment] -
 * @property {ProjectEnvironmentProperties| function(): ProjectEnvironmentProperties} [project] -
 * @property {boolean} [_INTERNAL_STATE_RESOURCE] -
 */

/**
 * @typedef SerializedBaseResource
 * @property {string} name -
 * @property {string} parent -
 * @property {import('./resources/reconcilable').StatusEnum} [status] -
 * @property {string[]} dependsOn -
 * @property {Object<string,any>} properties -
 * @property {string} resourceType -
 */

/**
 * @typedef SerializedBaseResourceGroup
 * @property {string} name -
 * @property {string} parent -
 * @property {import('./resources/reconcilable').StatusEnum} [status] -
 * @property {string[]} dependsOn -
 * @property {Object<string,any>} properties -
 * @property {string} resourceType -
 * @property {string[]} resources -
 */

/**
 * @typedef {import('./typedefs').SerializedBaseResource & import('./typedefs').SerializedBaseResourceGroup} SerializedResource
 */

module.exports = {};
