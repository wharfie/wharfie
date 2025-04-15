const BaseResource = require('../base-resource');

/**
 * @typedef BuildResourceOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {import('../../typedefs').SharedProperties} properties -
 */

class BuildResource extends BaseResource {
  /**
   * @param {BuildResourceOptions} options -
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    super({ name, parent, status, dependsOn, properties });
  }

  async initializeEnvironment() {}
}

module.exports = BuildResource;
