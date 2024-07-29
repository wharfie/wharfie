const WharfieActor = require('../wharfie-actor');

class Cleanup extends WharfieActor {
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
        handler: './lambdas/cleanup.handler',
      },
    });
  }
}

module.exports = Cleanup;
