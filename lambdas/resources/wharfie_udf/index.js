'use strict';

const update_resource = require('./update');
const create_resource = require('./create');
const delete_resource = require('./delete');

/**
 * @param {import('../../typedefs').CloudformationEvent & import('../../typedefs').CloudformationUpdateEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function handler(event) {
  const { RequestType } = event;

  switch (RequestType.toLowerCase()) {
    case 'delete':
      return await delete_resource(event);
    case 'create':
      return await create_resource(event);
    case 'update':
      return await update_resource(event);
    default:
      throw new Error(
        "Invalid Operation, must be one of ['delete', 'create', 'update']"
      );
  }
}

module.exports = {
  handler,
};
