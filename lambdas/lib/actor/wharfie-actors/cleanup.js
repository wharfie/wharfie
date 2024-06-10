const WharfieActor = require('../wharfie-actor');

const path = require('path');

class Cleanup extends WharfieActor {
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
        handler: path.join(__dirname, '../../../cleanup.handler'),
      },
    });
  }
}

module.exports = Cleanup;
