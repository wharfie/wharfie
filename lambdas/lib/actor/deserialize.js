const AWSResources = require('./resources/aws');
const WharfieActors = require('./wharfie-actors');
const WharfieActorResources = require('./resources/wharfie-actor-resources');
const WharfieDeploymentResources = require('./resources/wharfie-deployment-resources');
const WharfieProject = require('./resources/wharfie-project');
const WharfieResource = require('./resources/wharfie-resource');
const WharfieDeployment = require('./wharfie-deployment');
const WharfieActor = require('./wharfie-actor');

const { query } = require('../dynamo/');

/**
 * @typedef {new (options: any) => import('./resources/reconcilable')} ResourceConstructor
 */

/**
 * @type {Object<string, ResourceConstructor>}
 */
const classes = Object.assign({}, AWSResources, WharfieActors, {
  WharfieDeploymentResources,
  WharfieActorResources,
  WharfieProject,
  WharfieResource,
  WharfieDeployment,
  WharfieActor,
});

/**
 * @typedef RawUnserializedResourceData
 * @property {string} name -
 * @property {string} class -
 * @property {string} dependsOn -
 * @property {Object<string, string>} resources -
 * @property {Object<string, any>} properties -
 */

/**
 * @param {any} json -
 * @param {Object<string, import('./resources/reconcilable')>} resourceMap -
 * @returns {import('./resources/reconcilable')} -
 */
function _deserialize(json, resourceMap) {
  if (!json || typeof json !== 'object' || !json.resourceType) {
    throw new Error('Invalid serialized resource');
  }
  const ClassDefinition = classes[json.resourceType];
  /** @type {Object<string, import('./resources/reconcilable')>} */
  const deserializedResources = {};

  Object.values(json.resources || {}).forEach((resource) => {
    const deserdResource = _deserialize(resource, resourceMap);
    deserializedResources[deserdResource.name] = deserdResource;
    resourceMap[deserdResource.name] = deserdResource;
  });
  const resource = new ClassDefinition({
    name: json.name,
    dependsOn: json.dependsOn,
    status: json.status,
    resources: deserializedResources,
    properties: json.properties,
  });
  resourceMap[resource.name] = resource;
  return resource;
}

/**
 * @param {any} json -
 * @param {Object<string, import('./resources/reconcilable')>} [resourceMap] -
 * @returns {import('./resources/reconcilable')} -
 */
function deserialize(json, resourceMap = {}) {
  if (!json || typeof json !== 'object' || !json.resourceType) {
    throw new Error('Invalid serialized resource');
  }
  const deserializedResource = _deserialize(json, resourceMap);
  setDependsOn(deserializedResource, resourceMap);
  setParent(deserializedResource, resourceMap);
  if (deserializedResource instanceof WharfieDeployment) {
    setDeployment(deserializedResource, resourceMap);
  }
  return deserializedResource;
}

/**
 *
 * @param {import('./resources/reconcilable') | import('./resources/base-resource-group')} resource -
 * @param {Object<string, import('./resources/reconcilable')>} resourceMap -
 */
function setDependsOn(resource, resourceMap) {
  // while deserializing, we don't have access to the resourceMap
  // so we need to set the dependsOn property after deserialization
  // the type hack is that in serialization dependsOn is switched to the resource name instead of instance, this is reversed here
  if (resource.dependsOn) {
    // @ts-ignore
    resource.dependsOn = resource.dependsOn.map((name) => resourceMap[name]);
  }
  // @ts-ignore
  if (resource.resources) {
    // @ts-ignore
    Object.values(resource.resources).forEach((resource) => {
      setDependsOn(resource, resourceMap);
    });
  }
}

/**
 *
 * @param {import('./resources/reconcilable') | import('./resources/base-resource-group')} resource -
 * @param {Object<string, import('./resources/reconcilable')>} resourceMap -
 */
function setParent(resource, resourceMap) {
  // @ts-ignore
  if (resource.resources) {
    // @ts-ignore
    Object.values(resource.resources).forEach((resource) => {
      setParent(resource, resourceMap);
    });
  }
}

/**
 *
 * @param {import('./resources/reconcilable') | import('./resources/base-resource-group')} resource -
 * @param {Object<string, import('./resources/reconcilable')>} resourceMap -
 */
function setDeployment(resource, resourceMap) {
  if (resource instanceof WharfieActor && resource.deployment) {
    // @ts-ignore
    resource.parent = resourceMap[resource.parent];
  }
  // @ts-ignore
  if (resource.resources) {
    // @ts-ignore
    Object.values(resource.resources).forEach((resource) => {
      setDeployment(resource, resourceMap);
    });
  }
}

/**
 * @typedef WharfieDeploymentLoadOptions
 * @property {string} deploymentName -
 * @property {string} [resourceName] -
 */
/**
 * @param {WharfieDeploymentLoadOptions} options -
 * @returns {Promise<WharfieDeployment | WharfieProject>} -
 */
async function load({ deploymentName, resourceName }) {
  if (!resourceName) {
    resourceName = deploymentName;
  }
  const { Items } = await query({
    TableName: `${deploymentName}-state`,
    ConsistentRead: true,
    KeyConditionExpression: '#name = :name AND #sort_key = :name',
    ExpressionAttributeValues: {
      // @ts-ignore
      ':name': resourceName,
    },
    ExpressionAttributeNames: {
      '#name': 'name',
      '#sort_key': 'sort_key',
    },
  });
  if (!Items || Items.length === 0) throw new Error('No resource found');
  const storedData = Items[0];
  if (!storedData.serialized) throw new Error('Resource was not stored');
  // @ts-ignore
  return deserialize(storedData?.serialized, {});
}

module.exports = {
  load,
  deserialize,
};
