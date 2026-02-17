/**
 * @typedef WharfieMessage
 * @property {string} type - type.
 * @property {string} name - name.
 */

/**
 * @typedef WharfieTableColumn
 * @property {string} name - name.
 * @property {string} type - type.
 */

/**
 * @typedef DeploymentEnvironmentProperties
 * @property {import('../env-paths.js').EnvPaths} envPaths - envPaths.
 * @property {string} version - version.
 * @property {string} stateTable - stateTable.
 * @property {string} name - name.
 */
/**
 * @typedef ProjectEnvironmentProperties
 * @property {string} name - name.
 */

/**
 * @typedef SharedProperties
 * @property {DeploymentEnvironmentProperties| function(): DeploymentEnvironmentProperties} [deployment] - deployment.
 * @property {ProjectEnvironmentProperties| function(): ProjectEnvironmentProperties} [project] - project.
 * @property {boolean} [_INTERNAL_STATE_RESOURCE] - _INTERNAL_STATE_RESOURCE.
 */

/**
 * @typedef SerializedBaseResource
 * @property {string} name - name.
 * @property {string} parent - parent.
 * @property {import('./resources/reconcilable.js').StatusEnum} [status] - status.
 * @property {string[]} dependsOn - dependsOn.
 * @property {Object<string,any>} properties - properties.
 * @property {string} resourceType - resourceType.
 */

/**
 * @typedef SerializedBaseResourceGroup
 * @property {string} name - name.
 * @property {string} parent - parent.
 * @property {import('./resources/reconcilable.js').StatusEnum} [status] - status.
 * @property {string[]} dependsOn - dependsOn.
 * @property {Object<string,any>} properties - properties.
 * @property {string} resourceType - resourceType.
 * @property {string[]} resources - resources.
 */

/**
 * @typedef {import('./typedefs.js').SerializedBaseResource & import('./typedefs.js').SerializedBaseResourceGroup} SerializedResource
 */

export default {};
