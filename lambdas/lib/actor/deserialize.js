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
 * @typedef {new (options: any) => import('./resources/base-resource')} ResourceConstructor
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
 * @param {import('./typedefs').SerializedResource} serialized -
 * @param {Object<string, import('./typedefs').SerializedResource>} serializedResourceMap -
 * @param {Object<string, import('./resources/base-resource')>} resourceMap -
 * @returns {import('./resources/base-resource')} -
 */
function _deserialize(serialized, serializedResourceMap, resourceMap) {
  if (
    !serialized ||
    typeof serialized !== 'object' ||
    !serialized.resourceType
  ) {
    throw new Error('Invalid serialized resource');
  }
  const ClassDefinition = classes[serialized.resourceType];
  /** @type {Object<string, import('./resources/base-resource')>} */
  const deserializedResources = {};

  (serialized?.resources || []).forEach((resourceName) => {
    const deserdResource = _deserialize(
      serializedResourceMap[resourceName],
      serializedResourceMap,
      resourceMap
    );
    deserializedResources[deserdResource.name] = deserdResource;
    resourceMap[deserdResource.name] = deserdResource;
  });
  const resource = new ClassDefinition({
    name: serialized.name,
    parent: serialized.parent,
    dependsOn: serialized.dependsOn,
    status: serialized.status,
    resources: deserializedResources,
    properties: serialized.properties,
  });
  resourceMap[resource.name] = resource;
  return resource;
}

/**
 * @param {import('./typedefs').SerializedResource} serialized -
 * @param {Object<string, import('./typedefs').SerializedResource>} serializedResourceMap -
 * @returns {import('./resources/base-resource')} -
 */
function deserialize(serialized, serializedResourceMap) {
  if (
    !serialized ||
    typeof serialized !== 'object' ||
    !serialized.resourceType
  ) {
    throw new Error('Invalid serialized resource');
  }
  /** @type {Object<string, import('./resources/base-resource')>} */
  const resourceMap = {};
  const deserializedResource = _deserialize(
    serialized,
    serializedResourceMap,
    resourceMap
  );
  setDependsOn(deserializedResource, resourceMap);
  return deserializedResource;
}

/**
 *
 * @param {import('./resources/base-resource') | import('./resources/base-resource-group')} resource -
 * @param {Object<string, import('./resources/base-resource')>} resourceMap -
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
 * @typedef WharfieDeploymentLoadOptions
 * @property {string} deploymentName -
 * @property {string} [resourceName] -
 * @property {string} [sortKey] -
 */
/**
 * @param {WharfieDeploymentLoadOptions} options -
 * @returns {Promise<WharfieDeployment | WharfieProject>} -
 */
async function load({ deploymentName, resourceName, sortKey }) {
  if (!resourceName) {
    resourceName = deploymentName;
  }
  const { Items } = await query({
    TableName: `${deploymentName}-state`,
    ConsistentRead: true,
    KeyConditionExpression:
      '#name = :name AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':name': resourceName,
      ':sort_key': sortKey,
    },
    ExpressionAttributeNames: {
      '#name': 'name',
      '#sort_key': 'sort_key',
    },
  });
  if (!Items || Items.length === 0) throw new Error('No resources found');
  const processedItems = Items.sort((a, b) =>
    a.sort_key.localeCompare(b.sort_key)
  );
  const resourceMap = processedItems.slice(1).reduce((acc, item) => {
    acc[item.name] = item.serialized;
    return acc;
  }, {});

  // @ts-ignore
  return deserialize(processedItems[0].serialized, resourceMap);
}

module.exports = {
  load,
  deserialize,
};
