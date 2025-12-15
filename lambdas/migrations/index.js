import v0_0_0 from './versions/0.0.0.js';

import * as resource_db from '../lib/dynamo/operations.js';

/**
 * @param {string} versionA -
 * @param {string} versionB -
 * @returns {boolean} -
 */
const isVersionLessThan = (versionA, versionB) => {
  if (!versionA) return true;
  const [majorA, minorA, patchA] = versionA.split('.');
  const [majorB, minorB, patchB] = versionB.split('.');
  if (majorA < majorB) return true;
  if (majorA > majorB) return false;
  if (majorA === majorB) {
    if (minorA < minorB) return true;
    if (minorA > minorB) return false;
    if (minorA === minorB) {
      if (patchA < patchB) return true;
      if (patchA > patchB) return false;
      if (patchA === patchB) return false;
    }
  }
  throw new Error(`Invalid wharfie versions ${versionA} ${versionB}`);
};

/**
 * @param {import('../lib/graph/index.js').Resource} resource -
 * @param {import('../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
async function run(resource, event, context) {
  if (isVersionLessThan(resource.wharfie_version, '0.0.0')) {
    await v0_0_0.up(resource, event, context);
  }
}

/**
 * @param {import('../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<import('../lib/graph/index.js').Resource?>} -
 */
async function getResource(event, context) {
  const resource = await resource_db.getResource(event.resource_id);
  if (!resource) return null;
  await run(resource, event, context);
  return resource;
}

export { getResource, run };
