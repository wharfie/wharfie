const WharfieActor = require('../wharfie-actor');

class Cleanup extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
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

module.exports = Cleanup;
