'use strict';
const BaseResource = require('../../actor/resources/base-resource');

/** @type {Object.<string, Object<string, import("../../actor/typedefs").SerializedBaseResource>>} */
let __state = {};

/**
 * @param {Object.<string, Object<string,  import("../../actor/typedefs").SerializedBaseResource>>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, Object<string,  import("../../actor/typedefs").SerializedBaseResource>>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {BaseResource} resource -
 * @returns {Promise<import("../../actor/typedefs").SerializedBaseResource?>} -
 */
async function putResource(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot save resource without deployment');
  const { name } = resource.get('deployment');
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;
  if (!__state[name]) __state[name] = {};
  const oldValue = __state[name][resource_key] || null;
  __state[name][resource_key] = resource.serialize();
  return oldValue;
}

/**
 * @param {BaseResource} resource -
 */
async function putResourceStatus(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot save resource without deployment');
  const { name } = resource.get('deployment');

  // const resource_key = resource.parent
  //   ? `${resource.parent}#${resource.name}`
  //   : resource.name;

  if (!__state[name]) __state[name] = {};
  // __state[name][resource_key] = resource.serialize();
}

/**
 * @param {BaseResource} resource -
 * @returns {Promise<import("../../actor/typedefs").SerializedBaseResource>} -
 */
async function getResource(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot save resource without deployment');
  const { name } = resource.get('deployment');
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  return __state[name][resource_key] || null;
}

/**
 * @param {string} deploymentName -
 * @param {string} resourceKey -
 * @returns {Promise<import("../../actor/typedefs").SerializedBaseResource[]>} -
 */
async function getResources(deploymentName, resourceKey) {
  return Object.keys(__state[deploymentName])
    .filter((key) => key.startsWith(resourceKey))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => __state[deploymentName][key]);
}

/**
 * @param {BaseResource} resource -
 */
async function deleteResource(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot delete resource without deployment');
  const { name } = resource.get('deployment');

  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  delete __state[name][resource_key];
}

module.exports = {
  putResource,
  putResourceStatus,
  getResource,
  getResources,
  deleteResource,
  __setMockState,
  __getMockState,
};
