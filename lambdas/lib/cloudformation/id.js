'use strict';

const { createHash } = require('crypto');

/**
 * @param {import('../../typedefs').CloudformationEvent} event - event to generate ImmutableID from
 * @returns {string} - hash of event
 */
const getImmutableID = (event) => {
  const hash = createHash('md5');
  hash.update(event.StackId);
  hash.update(event.LogicalResourceId);
  return hash.digest('hex');
};

module.exports = {
  getImmutableID,
};
