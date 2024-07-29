const WharfieActor = require('../wharfie-actor');

class Daemon extends WharfieActor {
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
        handler: './lambdas/daemon.handler',
      },
    });
  }
}

module.exports = Daemon;
