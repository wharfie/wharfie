import WharfieActor from '../wharfie-actor.js';

class Cleanup extends WharfieActor {
  /**
   * @param {import('../wharfie-actor.js').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, parent, resources, properties }) {
    super({
      name: 'cleanup',
      parent,
      status,
      resources,
      properties: {
        ...properties,
        handler: '<WHARFIE_BUILT_IN>/cleanup.handler',
      },
    });
  }
}

export default Cleanup;
