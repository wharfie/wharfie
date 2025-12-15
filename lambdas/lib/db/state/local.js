import BaseResource from '../../actor/resources/base-resource.js';
import LocalDB from '../vanilla.js';

const stateDB = LocalDB.open('state');

/**
 * @param {BaseResource} resource -
 */
async function putResource(resource) {
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;
  await stateDB.put(resource_key, resource.serialize());
}

/**
 * @param {BaseResource} resource -
 */
async function putResourceStatus(resource) {
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;
  await stateDB.update(resource_key, { status: resource.status });
}

/**
 * @param {BaseResource} resource -
 * @returns {Promise<import("../../actor/resources/reconcilable.js").StatusEnum?>} -
 */
async function getResourceStatus(resource) {
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  const storedResource = stateDB.get(resource_key);
  if (!storedResource) return null;
  return storedResource.status;
}

/**
 * @param {BaseResource} resource -
 * @returns {Promise<import("../../actor/typedefs.js").SerializedBaseResource?>} -
 */
async function getResource(resource) {
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  const storedResource = stateDB.get(resource_key);
  return storedResource || null;
}
/**
 * @param {string} resourceKey -
 * @returns {Promise<import("../../actor/typedefs.js").SerializedBaseResource[]>} -
 */
async function getResources(resourceKey) {
  const resources = await stateDB.getBeginsWith(resourceKey);
  return resources
    .sort((a, b) => a.key.toString().localeCompare(b.key.toString()))
    .map(({ key, value }) => value);
}

/**
 * @param {BaseResource} resource -
 */
async function deleteResource(resource) {
  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;
  await stateDB.delete(resource_key);
}

export {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};
