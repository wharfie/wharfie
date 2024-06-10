const WharfieActor = require('../wharfie-actor');

const path = require('path');

class Events extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').WharfieActorOptions} options -
   */
  constructor({ deployment, name, status, resources, properties }) {
    super({
      deployment,
      name,
      status,
      resources,
      properties: {
        ...properties,
        handler: path.join(__dirname, '../../../events.handler'),
      },
    });
  }
}

module.exports = Events;
