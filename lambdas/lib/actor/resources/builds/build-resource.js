import BaseResource from '../base-resource.js';

/**
 * @typedef BuildResourceOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 * @property {import('../../typedefs.js').SharedProperties} properties -
 */

class BuildResource extends BaseResource {
  /**
   * @param {BuildResourceOptions} options -
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    super({ name, parent, status, dependsOn, properties });
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

export default BuildResource;
