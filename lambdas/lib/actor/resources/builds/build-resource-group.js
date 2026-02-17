import BaseResourceGroup from '../base-resource-group.js';

/**
 * @typedef BuildResourceOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {Object<string, import('../base-resource.js').default | BaseResourceGroup>} [resources] - resources.
 */

class BuildResource extends BaseResourceGroup {
  /**
   * @param {BuildResourceOptions} options - options.
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

export default BuildResource;
