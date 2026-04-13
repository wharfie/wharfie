import BaseResourceGroup from '../base-resource-group.js';

/**
 * @typedef BuildResourceOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {import('../../actors/typedefs.js').SharedProperties} properties - properties.
 * @property {Object<string, import('../base-resource.js').default | BaseResourceGroup>} [resources] - resources.
 * @property {any} [stateDB] - Scoped state store.
 * @property {import('node:events').EventEmitter} [emitter] - Scoped telemetry emitter.
 * @property {import('../runtime-config.js').WharfieRuntimeConfig} [runtime] - Structured runtime configuration.
 */

class BuildResource extends BaseResourceGroup {
  /**
   * @param {BuildResourceOptions} options - options.
   */
  constructor({
    name,
    parent,
    status,
    dependsOn,
    properties,
    resources,
    stateDB,
    emitter,
    runtime,
  }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
      resources,
      stateDB,
      emitter,
      runtime,
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
