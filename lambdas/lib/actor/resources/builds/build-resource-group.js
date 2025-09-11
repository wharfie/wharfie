const BaseResourceGroup = require('../base-resource-group');

/**
 * @typedef BuildResourceOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {import('../../typedefs').SharedProperties} properties -
 * @property {Object<string, import('../base-resource') | BaseResourceGroup>} [resources] -
 */

class BuildResource extends BaseResourceGroup {
  /**
   * @param {BuildResourceOptions} options -
   */
  constructor({ name, parent, status, dependsOn, properties, resources }) {
    super({ name, parent, status, dependsOn, properties, resources });
  }

  async initializeEnvironment() {}
  async reconcile() {
    if (
      // @ts-ignore
      typeof __WILLEM_BUILD_RECONCILE_TERMINATOR !== 'undefined' &&
      /* eslint-disable no-undef */
      // @ts-ignore
      __WILLEM_BUILD_RECONCILE_TERMINATOR
      /* eslint-enable no-undef */
    ) {
      return;
    }
    super.reconcile();
  }
}

module.exports = BuildResource;
