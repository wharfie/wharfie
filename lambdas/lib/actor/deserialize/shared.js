/**
 * @typedef {new (options: any) => import('../resources/base-resource.js').default} ResourceConstructor
 */

/**
 * @typedef RawUnserializedResourceData
 * @property {string} name -
 * @property {string} class -
 * @property {string} dependsOn -
 * @property {Object<string, string>} resources -
 * @property {Object<string, any>} properties -
 */

/**
 * @param {import('../typedefs.js').SerializedResource} serialized -
 * @param {Object<string, import('../typedefs.js').SerializedResource>} serializedResourceMap -
 * @param {Object<string, import('../resources/base-resource.js').default>} resourceMap -
 * @param {Object<string, ResourceConstructor>} classMap -
 * @returns {import('../resources/base-resource.js').default} -
 */
function _deserialize(
  serialized,
  serializedResourceMap,
  resourceMap,
  classMap,
) {
  if (
    !serialized ||
    typeof serialized !== 'object' ||
    !serialized.resourceType
  ) {
    throw new Error('Invalid serialized resource');
  }
  const ClassDefinition = classMap[serialized.resourceType];
  if (!ClassDefinition || typeof ClassDefinition !== 'function') {
    throw new Error(`Unknown resource type: ${serialized.resourceType}`);
  }
  /** @type {Object<string, import('../resources/base-resource.js').default>} */
  const deserializedResources = {};

  (serialized?.resources || []).forEach((resourceName) => {
    if (!serializedResourceMap[resourceName]) return;
    const deserdResource = _deserialize(
      serializedResourceMap[resourceName],
      serializedResourceMap,
      resourceMap,
      classMap,
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
 * @param {import('../typedefs.js').SerializedResource} serialized -
 * @param {Object<string, import('../typedefs.js').SerializedResource>} serializedResourceMap -
 * @param {Object<string, ResourceConstructor>} classMap -
 * @returns {import('../resources/base-resource.js').default} -
 */
function deserialize(serialized, serializedResourceMap, classMap) {
  if (
    !serialized ||
    typeof serialized !== 'object' ||
    !serialized.resourceType
  ) {
    throw new Error('Invalid serialized resource');
  }
  /** @type {Object<string, import('../resources/base-resource.js').default>} */
  const resourceMap = {};
  const deserializedResource = _deserialize(
    serialized,
    serializedResourceMap,
    resourceMap,
    classMap,
  );
  setDependsOn(deserializedResource, resourceMap);
  return deserializedResource;
}

/**
 *
 * @param {import('../resources/base-resource.js').default | import('../resources/base-resource-group.js').default} resource -
 * @param {Object<string, import('../resources/base-resource.js').default>} resourceMap -
 */
function setDependsOn(resource, resourceMap) {
  // while deserializing, we don't have access to the resourceMap
  // so we need to set the dependsOn property after deserialization
  // the type hack is that in serialization dependsOn is switched to the resource name instead of instance, this is reversed here
  if (resource.dependsOn) {
    // @ts-ignore
    resource.dependsOn = resource.dependsOn.map((name) => resourceMap[name]);
    // not all dependendents will be in the returned resourceMap, ie if we are selecting a subset of a resource within a large group
    // so we filter out the ones that are not in the map
    resource.dependsOn = resource.dependsOn.filter((resource) => !!resource);
  }
  // @ts-ignore
  if (resource.resources) {
    // @ts-ignore
    Object.values(resource.resources).forEach((resource) => {
      setDependsOn(resource, resourceMap);
    });
  }
}

export { deserialize };
