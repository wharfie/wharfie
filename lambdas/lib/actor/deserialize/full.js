const AWSResources = require('../resources/aws');
const RecordResources = require('../resources/records');
const WharfieActors = require('../wharfie-actors');
const WharfieDeploymentResources = require('../resources/wharfie-deployment-resources');
const WharfieProject = require('../resources/wharfie-project');
const WharfieResource = require('../resources/wharfie-resource');
const WharfieDeployment = require('../wharfie-deployment');
const WharfieActor = require('../wharfie-actor');
const { getResources } = require('../../db/state/aws');
const { deserialize } = require('./shared');

/**
 * @typedef {new (options: any) => import('../resources/base-resource')} ResourceConstructor
 */
/**
 * @type {Object<string, ResourceConstructor>}
 */
const FULL_CLASS_MAP = Object.assign(
  {},
  AWSResources,
  RecordResources,
  WharfieActors,
  {
    WharfieDeploymentResources,
    WharfieProject,
    WharfieResource,
    WharfieDeployment,
    WharfieActor,
  }
);

/**
 * @typedef WharfieDeploymentLoadOptions
 * @property {string} deploymentName -
 * @property {string} [resourceKey] -
 */
/**
 * @param {WharfieDeploymentLoadOptions} options -
 * @returns {Promise<WharfieDeployment | WharfieProject>} -
 */
async function load({ deploymentName, resourceKey }) {
  if (!resourceKey) {
    resourceKey = deploymentName;
  }
  const serializedResources = await getResources(deploymentName, resourceKey);
  if (!serializedResources || serializedResources.length === 0) {
    throw new Error('No resource found');
  }

  const resourceMap = serializedResources.slice(1).reduce((acc, item) => {
    if (!item.name) {
      console.log(item);
      throw new Error('No name found on resource');
    }
    // @ts-ignore
    acc[item.name] = item;
    return acc;
  }, {});
  // @ts-ignore
  return deserialize(serializedResources[0], resourceMap, FULL_CLASS_MAP);
}

module.exports = {
  load,
};
