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
 * @returns {Promise<any>} - Result.
 */
async function load({ deploymentName, resourceKey }) {
  if (!resourceKey) {
    resourceKey = deploymentName;
  }
  /** @type {import('../typedefs.js').SerializedResource[]} */
  const serializedResources = await getResources(deploymentName, resourceKey);
  if (!serializedResources || serializedResources.length === 0) {
    throw new Error('No resource found');
  }

  const resourceMap = serializedResources.slice(1).reduce((acc, item) => {
    if (!item.name) {
      console.log(item);
      throw new Error('No name found on resource');
    }
    acc[item.name] = item;
    return acc;
  }, /** @type {Record<string, import('../typedefs.js').SerializedResource>} */ ({}));

  return deserialize(serializedResources[0], resourceMap, FULL_CLASS_MAP);
}

export { load };
