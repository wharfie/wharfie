import AWSResources from '../resources/aws/index.js';
import RecordResources from '../resources/records/index.js';
import { getResources } from '../../db/state/store.js';
import { deserialize } from './shared.js';

/**
 * @typedef {new (options: any) => import('../resources/base-resource.js').default} ResourceConstructor
 */
/**
 * @type {Object<string, ResourceConstructor>}
 */
const FULL_CLASS_MAP = Object.assign({}, AWSResources, RecordResources);

/**
 * @typedef WharfieDeploymentLoadOptions
 * @property {string} deploymentName - deploymentName.
 * @property {string} [resourceKey] - resourceKey.
 */
/**
 * @param {WharfieDeploymentLoadOptions} options - options.
 * @returns {Promise<WharfieDeployment | WharfieProject>} - Result.
 */
async function load({ deploymentName, resourceKey }) {
  if (!resourceKey) {
    resourceKey = deploymentName;
  }
  const serializedResources = await getResources(deploymentName, resourceKey);
  if (!serializedResources || serializedResources.length === 0) {
    throw new Error('No resource found');
  }

  // @ts-ignore
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

export { load };
