const WharfieActor = require('../wharfie-actor');

class Events extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, resources, properties }) {
    super({
      name: 'events',
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
