const WharfieActor = require('../wharfie-actor');

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
        handler: './lambdas/events.handler',
      },
    });
  }
}

module.exports = Events;
