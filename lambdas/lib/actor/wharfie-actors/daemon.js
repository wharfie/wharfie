const WharfieActor = require('../wharfie-actor');

class Daemon extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, resources, properties }) {
    super({
      name: 'daemon',
      status,
      resources,
      properties: {
        ...properties,
        handler: './lambdas/daemon.handler',
      },
    });
  }
}

module.exports = Daemon;
