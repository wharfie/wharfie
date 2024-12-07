const WharfieActor = require('../wharfie-actor');

class Daemon extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
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

module.exports = Daemon;
