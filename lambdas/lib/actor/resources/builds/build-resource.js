import BaseResource from '../base-resource.js';

/**
 * @typedef BuildResourceOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {any} [stateDB] - Scoped state store.
 * @property {import('node:events').EventEmitter} [emitter] - Scoped telemetry emitter.
 */

class BuildResource extends BaseResource {
  /**
   * @param {BuildResourceOptions} options - options.
   */
  constructor({
    name,
    parent,
    status,
    dependsOn,
    properties,
    stateDB,
    emitter,
  }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
      stateDB,
      emitter,
    });
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
    return await super.reconcile();
  }
}

export default BuildResource;
