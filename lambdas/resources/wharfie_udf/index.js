'use strict';

const update_resource = require('./update');
const create_resource = require('./create');
const delete_resource = require('./delete');

/**
 * @param {import('../../typedefs').CloudformationEvent & import('../../typedefs').CloudformationUpdateEvent} event -
 */
async function handler(event) {
  const { RequestType } = event;

  switch (RequestType.toLowerCase()) {
    case 'delete':
      await delete_resource(event);
      break;
    case 'create':
      await create_resource(event);
      break;
    case 'update':
      await update_resource(event);
      break;
    default:
      throw new Error(
        "Invalid Operation, must be one of ['delete', 'create', 'update']"
      );
  }
}

module.exports = {
  handler,
};
