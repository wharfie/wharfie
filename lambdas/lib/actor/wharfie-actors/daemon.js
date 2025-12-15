import WharfieActor from '../wharfie-actor.js';

class Daemon extends WharfieActor {
  /**
   * @param {import('../wharfie-actor.js').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, parent, resources, properties }) {
    super({
      name: 'daemon',
      parent,
      status,
      resources,
      properties: {
        ...properties,
        handler: '<WHARFIE_BUILT_IN>/daemon.handler',
      },
    });
  }
}

export default Daemon;
