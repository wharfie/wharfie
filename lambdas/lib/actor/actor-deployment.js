const BaseResourceGroup = require('./resources/base-resource-group');

/**
 * @typedef ActorDeploymentOptions
 * @property {string} name -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {any} [properties] -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

class ActorDeployment extends BaseResourceGroup {
  /**
   * @param {ActorDeploymentOptions} options -
   */
  constructor({ name, status, properties, dependsOn, resources }) {
    super({ name, status, properties, dependsOn, resources });
  }

  /**
   * @typedef ActorOptions
   * @property {string} name -
   * @property {import("./actor-deployment")} deployment -
   * @property {Actor} [parent] -
   * @property {any} [properties] -
   * @property {import('./resources/reconcilable')[]} [dependsOn] -
   * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
   * @typedef {import("./actor")} Actor
   * @typedef {new (options: ActorOptions) => Actor} ActorConstructor
   */
  /**
   * @param {string} name -
   * @param {ActorConstructor} ActorClass -
   * @param {any} [actorOptions] -
   * @returns {import("./actor")} -
   */
  createActor(name, ActorClass, actorOptions = {}) {
    const actor = new ActorClass({
      ...actorOptions,
      deployment: this,
      name,
    });
    this.addResource(actor);
    return actor;
  }

  /**
   * @param {string} target -
   * @param {any} message -
   */
  async send(target, message) {
    // @ts-ignore
    await this.getResource(target).send(message);
  }
}

module.exports = ActorDeployment;
