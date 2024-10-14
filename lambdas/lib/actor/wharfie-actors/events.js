const WharfieActor = require('../wharfie-actor');

class Events extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, parent, resources, properties }) {
    super({
      name: 'events',
      parent,
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
