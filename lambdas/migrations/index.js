'use strict';

const v0_0_0 = require('./versions/0.0.0');

const resource_db = require('../lib/dynamo/resource');

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
 * @param {import('../typedefs').ResourceRecord} resource -
 * @param {import('../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
async function run(resource, event, context) {
  if (isVersionLessThan(resource.wharfie_version, '0.0.0')) {
    await v0_0_0.up(resource, event, context);
  }
}

/**
 * @param {import('../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<import('../typedefs').ResourceRecord?>} -
 */
async function getResource(event, context) {
  const resource = await resource_db.getResource(event.resource_id);
  if (!resource) return null;
  await run(resource, event, context);
  return resource;
}

module.exports = {
  getResource,
  run,
};
