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
 * @property {import('../env-paths.js').EnvPaths} envPaths -
 * @property {string} version -
 * @property {string} stateTable -
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
 * @property {import('./resources/reconcilable.js').StatusEnum} [status] -
 * @property {string[]} dependsOn -
 * @property {Object<string,any>} properties -
 * @property {string} resourceType -
 */

/**
 * @typedef SerializedBaseResourceGroup
 * @property {string} name -
 * @property {string} parent -
 * @property {import('./resources/reconcilable.js').StatusEnum} [status] -
 * @property {string[]} dependsOn -
 * @property {Object<string,any>} properties -
 * @property {string} resourceType -
 * @property {string[]} resources -
 */

/**
 * @typedef {import('./typedefs.js').SerializedBaseResource & import('./typedefs.js').SerializedBaseResourceGroup} SerializedResource
 */

export default {};
