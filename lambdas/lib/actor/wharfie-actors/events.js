import WharfieActor from '../wharfie-actor.js';

class Events extends WharfieActor {
  /**
   * @param {import('../wharfie-actor.js').ExtendedWharfieActorOptions} options - options.
   */
  constructor({ status, parent, resources, properties }) {
    super({
      name: 'events',
      parent,
      status,
      resources,
      properties: {
        ...properties,
        handler: '<WHARFIE_BUILT_IN>/events.handler',
      },
    });
  }
}

export default Events;
