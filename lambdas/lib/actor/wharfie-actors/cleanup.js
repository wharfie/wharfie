const WharfieActor = require('../wharfie-actor');

class Cleanup extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, resources, properties }) {
    super({
      name: 'cleanup',
      status,
      resources,
      properties: {
        ...properties,
        handler: './lambdas/cleanup.handler',
      },
    });
  }
}

module.exports = Cleanup;
